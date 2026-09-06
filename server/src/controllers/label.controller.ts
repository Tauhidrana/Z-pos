import prisma from "@/lib/prisma";
import { generateEAN13 } from "@/lib/barcode";
import { sendError, sendSuccess } from "@/utils/response";
import { BarcodeStatus, Prisma } from "generated/prisma";
import type { Context } from "hono";

/**
 * Backing API for the barcode-label generator.
 *
 * A barcode in this system is not free-form text: it identifies a
 * variant + purchase batch, and the sell price printed on a label comes from
 * that batch (`purchase_items.sell_price`). A code invented client-side would
 * render fine and then fail at the till with "Barcode not found", so the label
 * data and the code itself are both resolved here.
 */

/** Shape the label form renders and prefills from. */
type LabelSource = {
    variantId: string;
    productName: string;
    variantName: string | null;
    brand: string | null;
    size: string | null;
    color: string | null;
    price: number | null;
    barcode: string | null;
    stock: number;
};

export const LabelController = {
    /**
     * Every sellable variant, with the fields a label needs already filled in.
     *
     * `barcode` is null when the variant has never been allocated one, and
     * `price` is null when it has never been purchased — the client shows both
     * as actionable states rather than silently printing a blank label.
     */
    async getLabelSources(c: Context) {
        const search = c.req.query("search")?.trim() ?? "";
        const shopId = c.get("shopId") as string;

        const variants = await prisma.productVariant.findMany({
            where: {
                is_active: true,
                product: { is_active: true, shop_id: shopId },
                ...(search
                    ? {
                        OR: [
                            { product: { name: { contains: search, mode: "insensitive" } } },
                            { product: { brand: { contains: search, mode: "insensitive" } } },
                            { name: { contains: search, mode: "insensitive" } },
                        ],
                    }
                    : {}),
            },
            select: {
                id: true,
                name: true,
                color: true,
                size: true,
                stock_on_hand: true,
                product: { select: { name: true, brand: true } },
                // Newest batch wins: that is the price currently on the shelf.
                purchaseItems: {
                    select: { sell_price: true },
                    orderBy: { purchase: { date: "desc" } },
                    take: 1,
                },
                variantBarcodeAllocations: {
                    where: { barcode: { status: BarcodeStatus.ALLOCATED } },
                    select: { barcode: { select: { code: true } } },
                    take: 1,
                },
            },
            orderBy: [{ product: { name: "asc" } }, { name: "asc" }],
            take: 200,
        });

        const rows: LabelSource[] = variants.map((v) => ({
            variantId: v.id,
            productName: v.product.name,
            variantName: v.name,
            brand: v.product.brand,
            size: v.size,
            color: v.color,
            price: v.purchaseItems[0] ? Number(v.purchaseItems[0].sell_price) : null,
            barcode: v.variantBarcodeAllocations[0]?.barcode.code ?? null,
            stock: v.stock_on_hand,
        }));

        return sendSuccess(c, rows, "Label sources fetched successfully", 200);
    },

    /**
     * Return the variant's scannable barcode, allocating one if it has none.
     *
     * Idempotent by design: a barcode identifies the product batch, not an
     * individual unit, so printing 50 copies of one label is the normal case
     * and re-issuing on every print would flood the table with dead codes.
     */
    async issueBarcode(c: Context) {
        const variantId = (c.get("validatedBody") as { variantId: string }).variantId;
        const userId = c.get("userId") as string;
        const shopId = c.get("shopId") as string;

        const variant = await prisma.productVariant.findFirst({
            where: { id: variantId, product: { shop_id: shopId } },
            select: {
                id: true,
                name: true,
                color: true,
                size: true,
                stock_on_hand: true,
                is_active: true,
                product: { select: { name: true, brand: true, is_active: true } },
            },
        });

        if (!variant || !variant.is_active || !variant.product.is_active) {
            return sendError(c, "Product variant not found", "NOT_FOUND", 404);
        }

        // Reuse an existing allocation before minting anything.
        const existing = await prisma.variantBarcodeAllocation.findFirst({
            where: { variant_id: variantId, barcode: { status: BarcodeStatus.ALLOCATED } },
            select: {
                barcode: { select: { code: true } },
                purchaseItem: { select: { sell_price: true } },
            },
        });

        if (existing) {
            return sendSuccess(
                c,
                {
                    variantId,
                    productName: variant.product.name,
                    variantName: variant.name,
                    brand: variant.product.brand,
                    size: variant.size,
                    color: variant.color,
                    price: Number(existing.purchaseItem.sell_price),
                    barcode: existing.barcode.code,
                    stock: variant.stock_on_hand,
                    issued: false,
                },
                "Existing barcode returned",
                200,
            );
        }

        // An allocation must name the batch the unit came from — that batch is
        // where the sell price lives, so a variant that was never purchased
        // cannot be labelled with a meaningful price.
        const latestBatch = await prisma.purchaseItem.findFirst({
            where: { variant_id: variantId, purchase: { shop_id: shopId } },
            select: { id: true, sell_price: true },
            orderBy: { purchase: { date: "desc" } },
        });

        if (!latestBatch) {
            return sendError(
                c,
                "This variant has no purchase batch yet, so it has no sell price to print. Record a purchase for it first.",
                "NO_PURCHASE_BATCH",
                422,
            );
        }

        const result = await prisma.$transaction(async (tx) => {
            // Reserve the serial from the DB sequence rather than computing it
            // from a read — two concurrent issues would otherwise collide.
            const [reserved] = await tx.$queryRaw<Array<{ serial: number }>>(
                Prisma.sql`SELECT nextval('barcodes_serial_seq')::int AS serial`,
            );
            if (reserved === undefined) throw new Error("Failed to reserve a barcode serial");

            const code = generateEAN13(reserved.serial);

            const barcode = await tx.barcode.create({
                data: { code, serial: reserved.serial, status: BarcodeStatus.ALLOCATED },
                select: { id: true, code: true },
            });

            await tx.variantBarcodeAllocation.create({
                data: {
                    barcode_id: barcode.id,
                    variant_id: variantId,
                    purchase_item_id: latestBatch.id,
                    allocated_by: userId,
                },
            });

            return barcode;
        });

        return sendSuccess(
            c,
            {
                variantId,
                productName: variant.product.name,
                variantName: variant.name,
                brand: variant.product.brand,
                size: variant.size,
                color: variant.color,
                price: Number(latestBatch.sell_price),
                barcode: result.code,
                stock: variant.stock_on_hand,
                issued: true,
            },
            "Barcode issued successfully",
            201,
        );
    },
};
