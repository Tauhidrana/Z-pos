import prisma from "@/lib/prisma";
import { normalizeProductName } from "@/lib/product-name-normalizer";
import { barcodeCandidates } from "@/lib/barcode";
import type { CreateProduct, CreateProductVariantSepa, UpdateProduct, UpdateProductVariant } from "@myapp/shared/schemas/product.schema";
import type { IdBody } from "@myapp/shared/schemas/helper";
import { ProductService } from "@/services/product.service";
import type { CartEntryProduct, ProductStatus, TProduct } from "@/types";
import { sendError, sendSuccess } from "@/utils/response";
import { BarcodeStatus, Prisma, StockDirection, StockMovementType } from "generated/prisma";
import { Decimal } from "generated/prisma/runtime/client";
import { variantLabel } from "@/lib/variant-name";
import type { Context } from "hono";

export const ProductController = {
    async getAll(c: Context) {
        const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") ?? "20", 10) || 20));
        const search = c.req.query("search")?.trim() ?? "";
        const status = (c.req.query("status")?.trim().toUpperCase() ?? "ALL") as ProductStatus | "ALL";

        // console.log("[Status]", status);
        const VALID_STATUSES = ["ALL", "IN_STOCK", "LOW_STOCK", "OUT_OF_STOCK"];
        if (!VALID_STATUSES.includes(status)) {
            return sendError(
                c,
                `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`,
                "INVALID_REQUEST",
                422
            );
        }

        const products = await ProductService.getAll(
            prisma,
            c.get("shopId") as string,
            page,
            limit,
            search,
            status,
        );

        return sendSuccess(
            c,
            {
                items: products.data,
                total: products.total,
                currentPage: page,
                totalPages: Math.ceil(products.total / limit),
                hasNext: page < Math.ceil(products.total / limit),
                hasPrev: page > 1,
            },
            "Products fetched successfully",
            200
        );
    },
    async getById(c: Context) {
        const id = c.req.param("id") ?? "";

        const product = await prisma.product.findFirst({
            where: {
                id,
                shop_id: c.get("shopId") as string,
            },
            include: {
                category: true,
                variants: true,
            }
        });

        if (!product) {
            return sendError(c, "Product not found", "NOT_FOUND", 404);
        }

        const productData: TProduct = {
            id: product.id,
            name: product.name,
            description: product.description,
            brand: product.brand ?? "",
            isActive: product.is_active,
            category: {
                id: product.category_id,
                name: product.category.name,
            },
            reorderLevel: product.reorder_level,
            variants: product.variants.map((v) => ({
                id: v.id,
                name: v.name ?? "",
                isActive: v.is_active,
                color: v.color ?? "",
                size: v.size ?? "",
                stock: v.stock_on_hand,
                // The shelf price was being selected and then dropped here, so
                // a merchant could type a price when creating a product and
                // never see it again on any screen.
                sellPrice:
                    v.last_sell_price === null ? null : Number(v.last_sell_price),
            })),
        }

        return sendSuccess(c, productData, "Product fetched successfully", 200);
    },
    async create(c: Context) {
        const body = c.get("validatedBody") as CreateProduct;
        const product = await ProductService.create(
            body,
            c.get("shopId") as string,
            c.get("userId") as string,
        )

        return sendSuccess(c, product, "Product created successfully", 201);
    },
    async update(c: Context) {
        const body = c.get("validatedBody") as UpdateProduct;
        const { id, name, description, reorder_level, category, brand } = body;
        const shopId = c.get("shopId") as string;

        // updateMany, not update: it takes a filter rather than a unique id, so
        // the shop check and the write are one statement and a product from
        // another shop simply matches nothing.
        const updated = await prisma.product.updateMany({
            where: { id, shop_id: shopId },
            data: {
                ...(name && {
                    name,
                    normalized_key: normalizeProductName(name),
                }),
                ...(brand && { brand }),
                ...(description !== undefined && { description }),
                ...(reorder_level !== undefined && { reorder_level }),
                ...(category && { category_id: category }),
            },
        });

        if (updated.count === 0) {
            return sendError(c, "Product not found", "NOT_FOUND", 404);
        }

        return sendSuccess(c, {}, "Product updated successfully", 200);
    },
    async deleteById(c: Context) {
        const { id } = c.get("validatedBody") as IdBody;

        const product = await prisma.product.findFirst({
            where: { id, shop_id: c.get("shopId") as string },
            include: { variants: { select: { id: true } } },
        });

        if (!product) {
            return sendError(c, "Product not found", "NOT_FOUND", 404);
        }

        const variantIds = product.variants.map((v) => v.id);

        // A product with any purchase/sale/stock history can't be hard-deleted
        // without destroying financial records and the append-only stock
        // ledger — deactivate it instead so history stays intact.
        const [ledgerCount, saleItemCount, purchaseItemCount] = await Promise.all([
            prisma.stockLedger.count({ where: { variant_id: { in: variantIds } } }),
            prisma.saleItem.count({ where: { variant_id: { in: variantIds } } }),
            prisma.purchaseItem.count({ where: { variant_id: { in: variantIds } } }),
        ]);

        if (ledgerCount > 0 || saleItemCount > 0 || purchaseItemCount > 0) {
            await prisma.$transaction([
                prisma.productVariant.updateMany({
                    where: { id: { in: variantIds } },
                    data: { is_active: false },
                }),
                prisma.product.update({
                    where: { id },
                    data: { is_active: false },
                }),
            ]);

            return sendSuccess(
                c,
                {},
                "Product has purchase or sale history — deactivated instead of deleted",
                200
            );
        }

        await prisma.$transaction(async (tx) => {
            await tx.variantBarcodeAllocation.deleteMany({
                where: { variant_id: { in: variantIds } },
            });

            await tx.productVariant.deleteMany({
                where: { id: { in: variantIds } },
            });

            await tx.product.delete({
                where: { id },
            });
        });

        return sendSuccess(c, {}, "Product deleted successfully", 200);
    },
    async getPurchaseData(c: Context) {
        // Only the three fields below are rendered, so select rather than
        // include — this used to hydrate every column of every variant, product
        // and category row in the database on each page load.
        const productVariants = await prisma.productVariant.findMany({
            where: {
                is_active: true,
                product: { is_active: true, shop_id: c.get("shopId") as string },
            },
            select: {
                id: true,
                name: true,
                product: {
                    select: {
                        name: true,
                        category: { select: { name: true } },
                    },
                },
            },
            orderBy: { product: { name: "asc" } },
        });

        const formattedProducts = productVariants.map((v) => ({
            id: v.id,
            name: `${v.product.name} - ${v.name}`,
            category: v.product.category.name,

        }));

        return sendSuccess(c, formattedProducts, "Products for purchase fetched successfully", 200);
    },

    /**
     * Resolve any scanned symbol to the cart entry it represents.
     *
     * The reader is format-agnostic on purpose. Most stock in a shop carries a
     * barcode the shop did not print — the manufacturer's EAN-13 on a carton, a
     * supplier's Code-128 — and a till that only recognised its own generated
     * labels would be useless for all of it. Any code the merchant has
     * registered against a variant resolves here; everything else comes back
     * 404 with the code echoed, so the caller can say which label it was
     * holding rather than "scan failed".
     *
     * The same physical label decodes differently depending on the reader (a
     * UPC-A is 12 digits to one scanner and 13 to another), so the lookup
     * matches on every form the code could have arrived in.
     */
    async getByBarcode(c: Context) {
        const scanned = c.req.param("barcode") ?? "";
        const candidates = barcodeCandidates(scanned);
        if (candidates.length === 0) {
            return sendError(c, "Invalid barcode", "BAD_REQUEST", 400);
        }

        const allocation = await prisma.variantBarcodeAllocation.findFirst({
            where: {
                barcode: { code: { in: candidates }, status: BarcodeStatus.ALLOCATED },
                // Barcode codes stay globally unique — they are physical labels
                // — so the tenant boundary is enforced on the product behind it.
                // Without this, scanning another shop's label would sell their
                // stock from this till.
                variant: { product: { shop_id: c.get("shopId") as string } },
            },
            include: {
                barcode: { select: { code: true } },
                purchaseItem: { select: { sell_price: true } },
                variant: {
                    select: {
                        id: true,
                        name: true,
                        stock_on_hand: true,
                        last_sell_price: true,
                        product: { select: { name: true } },
                    },
                },
            },
        });

        if (!allocation) {
            return sendError(
                c,
                `Barcode ${candidates[0]} is not registered to any product in this shop.`,
                "BARCODE_NOT_FOUND",
                404,
            );
        }

        const { variant, purchaseItem, barcode } = allocation;
        // A label allocated to a purchase batch is priced from it, exactly as
        // the unit was bought. A label with no batch behind it — opening stock,
        // or a manufacturer code linked to something already on the shelf — is
        // priced from the variant's shelf price.
        const price = purchaseItem?.sell_price ?? variant.last_sell_price;
        if (price === null) {
            return sendError(
                c,
                `${variant.product.name} has no price yet. Set one on the product page, or record a purchase.`,
                "NO_PRICE",
                422,
            );
        }

        const result: CartEntryProduct = {
            variantId: variant.id,
            name: `${variant.product.name}${variant.name ? ` - ${variant.name}` : ""}`,
            price: Number(price),
            barcode: barcode.code,
            availableStock: variant.stock_on_hand,
        };
        return sendSuccess(c, result, "Variant fetched successfully", 200);
    },

    /**
     * Resolve a product straight to its cart entry.
     *
     * The POS previously did this in two sequential round-trips: fetch the
     * whole product to learn its first variant id, then fetch that variant's
     * cart item. Every tap on a product in the grid paid for both.
     */
    async getCartItemByProduct(c: Context) {
        const productId = c.req.param("id") ?? "";

        const allocation = await prisma.variantBarcodeAllocation.findFirst({
            where: {
                variant: {
                    product_id: productId,
                    is_active: true,
                    product: { shop_id: c.get("shopId") as string },
                },
                barcode: { status: BarcodeStatus.ALLOCATED },
            },
            include: {
                barcode: { select: { code: true } },
                purchaseItem: { select: { sell_price: true } },
                variant: {
                    select: {
                        id: true,
                        name: true,
                        stock_on_hand: true,
                        last_sell_price: true,
                        product: { select: { name: true } },
                    },
                },
            },
        });

        // An allocation with no batch behind it is priced from the variant's
        // shelf price — the same rule the till applies to a scanned label.
        const allocationPrice = allocation
            ? (allocation.purchaseItem?.sell_price ?? allocation.variant.last_sell_price)
            : null;

        if (allocation && allocationPrice !== null) {
            const { variant, barcode } = allocation;

            return sendSuccess(
                c,
                {
                    variantId: variant.id,
                    name: `${variant.product.name}${variant.name ? ` - ${variant.name}` : ""}`,
                    price: Number(allocationPrice),
                    barcode: barcode.code,
                    availableStock: variant.stock_on_hand,
                } satisfies CartEntryProduct,
                "Product cart item fetched successfully",
                200,
            );
        }

        // No purchase batch behind this product. That is ordinary rather than
        // exceptional — opening stock entered when the product was created, or
        // a variant added by hand, never passes through a purchase and so never
        // gets a barcode. Fall back to the variant's own shelf price, which is
        // the same figure the online store already sells it at.
        const priced = await prisma.productVariant.findFirst({
            where: {
                product_id: productId,
                is_active: true,
                product: { shop_id: c.get("shopId") as string },
                last_sell_price: { not: null },
            },
            select: {
                id: true,
                name: true,
                stock_on_hand: true,
                last_sell_price: true,
                product: { select: { name: true } },
            },
        });

        if (!priced) {
            return sendError(
                c,
                "This product has no price yet. Set one on the product page, or record a purchase.",
                "NO_PRICE",
                404,
            );
        }

        const result: CartEntryProduct = {
            variantId: priced.id,
            name: `${priced.product.name}${priced.name ? ` - ${priced.name}` : ""}`,
            price: Number(priced.last_sell_price),
            availableStock: priced.stock_on_hand,
        };

        return sendSuccess(c, result, "Product cart item fetched successfully", 200);
    },

    async getCartItemByVariant(c: Context) {
        const variantId = c.req.param("variantId") ?? "";

        const allocation = await prisma.variantBarcodeAllocation.findFirst({
            where: {
                variant: { product: { shop_id: c.get("shopId") as string } },
                variant_id: variantId,
                barcode: { status: BarcodeStatus.ALLOCATED },
            },
            include: {
                barcode: true,
                purchaseItem: { select: { sell_price: true } },
                variant: {
                    select: {
                        id: true,
                        name: true,
                        stock_on_hand: true,
                        last_sell_price: true,
                        product: { select: { name: true } },
                    },
                },
            },
        });

        const allocationPrice = allocation
            ? (allocation.purchaseItem?.sell_price ?? allocation.variant.last_sell_price)
            : null;

        if (allocation && allocationPrice !== null) {
            const { variant, barcode } = allocation;

            return sendSuccess(
                c,
                {
                    variantId: variant.id,
                    name: `${variant.product.name}${variant.name ? ` - ${variant.name}` : ""}`,
                    price: Number(allocationPrice),
                    barcode: barcode.code,
                    availableStock: variant.stock_on_hand,
                } satisfies CartEntryProduct,
                "Variant cart item fetched successfully",
                200,
            );
        }

        // Same fallback as the by-product lookup: no batch behind this variant
        // is normal, and its shelf price is a real price.
        const priced = await prisma.productVariant.findFirst({
            where: {
                id: variantId,
                product: { shop_id: c.get("shopId") as string },
            },
            select: {
                id: true,
                name: true,
                stock_on_hand: true,
                last_sell_price: true,
                product: { select: { name: true } },
            },
        });

        if (!priced) {
            return sendError(c, "Variant not found", "NOT_FOUND", 404);
        }

        if (priced.last_sell_price === null) {
            return sendError(
                c,
                "This variant has no price yet. Set one on the product page, or record a purchase.",
                "NO_PRICE",
                404,
            );
        }

        const result: CartEntryProduct = {
            variantId: priced.id,
            name: `${priced.product.name}${priced.name ? ` - ${priced.name}` : ""}`,
            price: Number(priced.last_sell_price),
            availableStock: priced.stock_on_hand,
        };

        return sendSuccess(c, result, "Variant cart item fetched successfully", 200);
    },

    async updateVariant(c: Context) {
        const body = c.get("validatedBody") as UpdateProductVariant;
        const { id, color, size, sell_price } = body;

        // Price is an edit in its own right. The old guard demanded a colour or
        // a size on every call, so the one field a merchant most often needs to
        // change — what the thing costs — could not be changed at all on a
        // plain product that has neither attribute.
        if (color === undefined && size === undefined && sell_price === undefined) {
            return sendError(c, "Nothing to update", "BAD_REQUEST", 400);
        }

        const variant = await prisma.productVariant.findFirst({
            where: { id, product: { shop_id: c.get("shopId") as string } },
            select: { id: true, color: true, size: true },
        });

        if (!variant) {
            return sendError(c, "Variant not found", "NOT_FOUND", 404);
        }

        // Rename against the attributes the variant will actually have, not
        // only the ones in this request, or clearing one field would drop the
        // other from the label.
        const nextColor = color !== undefined ? color.trim() || null : variant.color;
        const nextSize = size !== undefined ? size.trim() || null : variant.size;

        await prisma.productVariant.update({
            where: { id },
            data: {
                ...(color !== undefined && { color: nextColor }),
                ...(size !== undefined && { size: nextSize }),
                ...((color !== undefined || size !== undefined) && {
                    name: variantLabel(nextColor, nextSize),
                }),
                // Null clears the price; omitted leaves it alone. A rename must
                // never wipe what the variant sells for.
                ...(sell_price !== undefined && {
                    last_sell_price: sell_price === null ? null : new Decimal(sell_price),
                }),
            },
        });
        return sendSuccess(c, {}, "Variant updated successfully", 200);
    },

    async toggleVariantById(c: Context) {
        const { id } = c.get("validatedBody") as IdBody;

        const variant = await prisma.productVariant.findFirst({
            where: { id, product: { shop_id: c.get("shopId") as string } },
        });

        if (!variant) {
            return sendError(c, "Variant not found", "NOT_FOUND", 404);
        }

        await prisma.productVariant.update({
            where: { id },
            data: {
                is_active: !variant.is_active,
            },
        });

        return sendSuccess(c, {}, "Variant toggled successfully", 200);
    },

    async deleteVariantById(c: Context) {

        // check if variant is used in any purchase or sale
        // warning!!! :=> this func is not ready to use yet

        const { id } = await c.req.json();

        if (!id || typeof id !== "string" || id.trim() === "") {
            return sendError(c, "Invalid ID", "BAD_REQUEST", 400);
        }

        const variant = await prisma.productVariant.findFirst({
            where: { id, product: { shop_id: c.get("shopId") as string } },
        });

        if (!variant) {
            return sendError(c, "Variant not found", "NOT_FOUND", 404);
        }

        await prisma.productVariant.delete({
            where: { id },
        });



        return sendSuccess(c, {}, "Variant deleted successfully", 200);
    },

    async createVariant(c: Context) {
        const body = c.get("validatedBody") as CreateProductVariantSepa;
        const { productId, color, size, stock, sell_price } = body;
        const shopId = c.get("shopId") as string;
        const userId = c.get("userId") as string;

        const product = await prisma.product.findFirst({
            where: { id: productId, shop_id: shopId },
            select: { id: true, name: true },
        });

        if (!product) {
            return sendError(c, "Product not found", "NOT_FOUND", 404);
        }

        const nextColor = color?.trim() || null;
        const nextSize = size?.trim() || null;
        const openingStock = stock ?? 0;

        // A variant added later is the same kind of thing as one added with the
        // product, so it is created the same way: opening stock recorded as an
        // adjustment against the append-only ledger, never as a bare number on
        // the variant row that the ledger does not know about.
        const variant = await prisma.$transaction(async (tx) => {
            const created = await tx.productVariant.create({
                data: {
                    product_id: product.id,
                    // Was `"${color ?? product.name} / ${size ?? product.name}"`,
                    // which labelled a red shirt "RED / Shirt".
                    name: variantLabel(nextColor, nextSize),
                    color: nextColor,
                    size: nextSize,
                    stock_on_hand: openingStock,
                    last_sell_price:
                        sell_price !== undefined && sell_price > 0
                            ? new Decimal(sell_price)
                            : null,
                },
            });

            if (openingStock > 0) {
                const adjustment = await tx.stockAdjustment.create({
                    data: {
                        shop_id: shopId,
                        adjusted_by: userId,
                        reason: "Initial stock",
                        note: `Opening stock entered when adding a variant to ${product.name}`,
                    },
                });

                await tx.stockAdjustmentItem.create({
                    data: {
                        adjustment_id: adjustment.id,
                        variant_id: created.id,
                        direction: StockDirection.IN,
                        quantity: openingStock,
                        note: "Initial stock",
                    },
                });

                await tx.stockLedger.create({
                    data: {
                        variant_id: created.id,
                        type: StockMovementType.ADJUSTMENT,
                        direction: StockDirection.IN,
                        quantity: openingStock,
                        balance_after: openingStock,
                        adjustment_id: adjustment.id,
                    },
                });
            }

            return created;
        });

        return sendSuccess(c, variant, "Variant created successfully", 201);
    },
    async getProductStats(c: Context) {
        const result = await prisma.$queryRaw<
            {
                total_products: number
                total_stock: number
                total_low_stock: number
                total_out_of_stock: number
            }[]
        >`
        WITH product_stock AS (
            SELECT
                p.id,
                p.reorder_level,
                COALESCE(SUM(pv.stock_on_hand),0) AS stock
            FROM products p
            LEFT JOIN product_variants pv
                   ON pv.product_id = p.id AND pv.is_active = true
            WHERE p.is_active = true AND p.shop_id = ${c.get("shopId") as string}
            GROUP BY p.id
        )
        SELECT
            COUNT(*)::int AS total_products,
            COALESCE(SUM(stock),0)::int AS total_stock,
            COUNT(*) FILTER (
                WHERE stock > 0 AND stock <= reorder_level
            )::int AS total_low_stock,
            COUNT(*) FILTER (
                WHERE stock = 0
            )::int AS total_out_of_stock
        FROM product_stock
        `

        const stats = result[0]

        return sendSuccess(
            c,
            {
                totalProducts: Number(stats?.total_products),
                totalStock: Number(stats?.total_stock),
                totalLowStock: Number(stats?.total_low_stock),
                totalOutOfStock: Number(stats?.total_out_of_stock),
            },
            "Product stats fetched successfully",
            200
        )
    }
}
