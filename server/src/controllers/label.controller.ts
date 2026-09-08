import prisma from "@/lib/prisma";
import { barcodeCandidates, generateEAN13, isStorableBarcode } from "@/lib/barcode";
import { sendError, sendSuccess } from "@/utils/response";
import { BarcodeStatus, Prisma } from "generated/prisma";
import type { Context } from "hono";

/**
 * Backing API for the barcode-label generator.
 *
 * A barcode in this system is not free-form text: it is registered against a
 * variant, and the price printed on the label has to be the price the till will
 * charge for a unit carrying it. A code invented client-side would render fine
 * and then fail at the till with "Barcode not found", so the label data and the
 * code itself are both resolved here.
 *
 * Two prices can apply, and which one wins is not a preference:
 *
 *   - A barcode allocated to a purchase batch is priced from that batch
 *     (`purchase_items.sell_price`), because the till prices that exact unit
 *     from it. Printing anything else would put a number on the sticker that
 *     the receipt then contradicts.
 *   - A barcode with no batch behind it is priced from the variant's shelf
 *     price (`product_variants.last_sell_price`) — the figure the merchant
 *     typed when they added the product, kept current by every later purchase,
 *     and the same one the storefront quotes.
 *
 * The second case used to be unreachable: labelling refused outright unless the
 * variant had been purchased, so a product created with opening stock and a
 * price could never be given a barcode at all.
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
     * `price` is null only when the variant has neither a shelf price nor a
     * purchase behind it — the client shows both as actionable states rather
     * than silently printing a blank label.
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
                last_sell_price: true,
                product: { select: { name: true, brand: true } },
                // Newest batch wins: that is the price currently on the shelf.
                purchaseItems: {
                    select: { sell_price: true },
                    orderBy: { purchase: { date: "desc" } },
                    take: 1,
                },
                variantBarcodeAllocations: {
                    where: { barcode: { status: BarcodeStatus.ALLOCATED } },
                    select: {
                        barcode: { select: { code: true } },
                        purchaseItem: { select: { sell_price: true } },
                    },
                    take: 1,
                },
            },
            orderBy: [{ product: { name: "asc" } }, { name: "asc" }],
            take: 200,
        });

        const rows: LabelSource[] = variants.map((v) => {
            const allocation = v.variantBarcodeAllocations[0];
            // An already-labelled variant prints the price of the batch its
            // label belongs to, because that is what the till will charge for
            // it. Everything else falls back to the shelf price, then to the
            // newest batch for the pre-`last_sell_price` rows that never had
            // one written.
            const price =
                allocation?.purchaseItem?.sell_price ??
                v.last_sell_price ??
                v.purchaseItems[0]?.sell_price ??
                null;

            return {
                variantId: v.id,
                productName: v.product.name,
                variantName: v.name,
                brand: v.product.brand,
                size: v.size,
                color: v.color,
                price: price === null ? null : Number(price),
                barcode: allocation?.barcode.code ?? null,
                stock: v.stock_on_hand,
            };
        });

        return sendSuccess(c, rows, "Label sources fetched successfully", 200);
    },

    /**
     * Return the variant's scannable barcode, allocating one if it has none.
     *
     * Idempotent by design: a barcode identifies the product, not an individual
     * unit, so printing 50 copies of one label is the normal case and re-issuing
     * on every print would flood the table with dead codes.
     *
     * With a `code` in the body this registers that code instead of minting one
     * — the merchant scanned the manufacturer's own barcode off a carton they
     * already stock. Nothing about the till changes: the code is stored and
     * looked up exactly like a generated one, which is what makes a factory
     * barcode resolve to the right product at the counter.
     */
    async issueBarcode(c: Context) {
        const body = c.get("validatedBody") as { variantId: string; code?: string };
        const variantId = body.variantId;
        const userId = c.get("userId") as string;
        const shopId = c.get("shopId") as string;

        // A supplied code is normalized to the one form it is stored and
        // compared in, so the same label typed by hand and read by a scanner
        // land on the same row.
        const suppliedCode = body.code ? (barcodeCandidates(body.code)[0] ?? "") : null;
        if (suppliedCode !== null && !isStorableBarcode(suppliedCode)) {
            return sendError(
                c,
                "That does not look like a barcode. Scan or type the code printed under the bars.",
                "INVALID_BARCODE",
                422,
            );
        }

        const variant = await prisma.productVariant.findFirst({
            where: { id: variantId, product: { shop_id: shopId } },
            select: {
                id: true,
                name: true,
                color: true,
                size: true,
                stock_on_hand: true,
                is_active: true,
                last_sell_price: true,
                product: { select: { name: true, brand: true, is_active: true } },
            },
        });

        if (!variant || !variant.is_active || !variant.product.is_active) {
            return sendError(c, "Product variant not found", "NOT_FOUND", 404);
        }

        const respond = (
            code: string,
            price: Prisma.Decimal | number,
            issued: boolean,
            message: string,
            status: 200 | 201,
        ) =>
            sendSuccess(
                c,
                {
                    variantId,
                    productName: variant.product.name,
                    variantName: variant.name,
                    brand: variant.product.brand,
                    size: variant.size,
                    color: variant.color,
                    price: Number(price),
                    barcode: code,
                    stock: variant.stock_on_hand,
                    issued,
                },
                message,
                status,
            );

        // Reuse an existing allocation before minting anything — unless the
        // caller named a specific code, which is a request to register that
        // one rather than to re-resolve whatever the variant already has.
        const existing = suppliedCode
            ? null
            : await prisma.variantBarcodeAllocation.findFirst({
                where: { variant_id: variantId, barcode: { status: BarcodeStatus.ALLOCATED } },
                select: {
                    barcode: { select: { code: true } },
                    purchaseItem: { select: { sell_price: true } },
                },
            });

        if (existing) {
            const price = existing.purchaseItem?.sell_price ?? variant.last_sell_price;
            if (price === null) return noPriceError(c);
            return respond(existing.barcode.code, price, false, "Existing barcode returned", 200);
        }

        // Prefer the newest batch: it names where the unit came from and is the
        // price the till charges for a label allocated to it. A variant that
        // was never purchased has no batch, which is ordinary — opening stock
        // entered with the product never passes through one — and is labelled
        // against its shelf price instead.
        const latestBatch = await prisma.purchaseItem.findFirst({
            where: { variant_id: variantId, purchase: { shop_id: shopId } },
            select: { id: true, sell_price: true },
            orderBy: { purchase: { date: "desc" } },
        });

        const price = latestBatch?.sell_price ?? variant.last_sell_price;
        if (price === null) return noPriceError(c);

        // A code already on the shelf must not be quietly moved to another
        // product: the label in the customer's hand would then ring up as
        // something else.
        if (suppliedCode) {
            const clash = await prisma.barcode.findUnique({
                where: { code: suppliedCode },
                select: {
                    status: true,
                    allocation: {
                        select: {
                            variant_id: true,
                            variant: { select: { product: { select: { name: true } } } },
                        },
                    },
                },
            });

            if (clash?.allocation && clash.allocation.variant_id !== variantId) {
                return sendError(
                    c,
                    `Barcode ${suppliedCode} is already registered to ${clash.allocation.variant.product.name}.`,
                    "BARCODE_TAKEN",
                    409,
                );
            }

            if (clash?.allocation && clash.status === BarcodeStatus.ALLOCATED) {
                return respond(suppliedCode, price, false, "Existing barcode returned", 200);
            }
        }

        const result = await prisma.$transaction(async (tx) => {
            let code = suppliedCode;
            let serial: number | undefined;

            if (!code) {
                // Reserve the serial from the DB sequence rather than computing
                // it from a read — two concurrent issues would otherwise
                // collide. A merchant's own code carries no serial: it is not
                // ours to number.
                const [reserved] = await tx.$queryRaw<Array<{ serial: number }>>(
                    Prisma.sql`SELECT nextval('barcodes_serial_seq')::int AS serial`,
                );
                if (reserved === undefined) throw new Error("Failed to reserve a barcode serial");
                serial = reserved.serial;
                code = generateEAN13(reserved.serial);
            }

            const barcode = await tx.barcode.upsert({
                where: { code },
                update: { status: BarcodeStatus.ALLOCATED },
                create: {
                    code,
                    ...(serial === undefined ? {} : { serial }),
                    status: BarcodeStatus.ALLOCATED,
                },
                select: { id: true, code: true },
            });

            await tx.variantBarcodeAllocation.upsert({
                where: { barcode_id: barcode.id },
                update: { variant_id: variantId, purchase_item_id: latestBatch?.id ?? null },
                create: {
                    barcode_id: barcode.id,
                    variant_id: variantId,
                    purchase_item_id: latestBatch?.id ?? null,
                    allocated_by: userId,
                },
            });

            return barcode;
        });

        return respond(
            result.code,
            price,
            true,
            suppliedCode ? "Barcode linked successfully" : "Barcode issued successfully",
            201,
        );
    },
};

/**
 * A variant with no price anywhere cannot be labelled: the sticker would carry
 * a blank where the amount goes, and the till would refuse the sale.
 */
function noPriceError(c: Context) {
    return sendError(
        c,
        "This product has no price yet. Set one on the product page, or record a purchase for it.",
        "NO_PRICE",
        422,
    );
}
