import prisma from "@/lib/prisma";
import { normalizeProductName } from "@/lib/product-name-normalizer";
import { variantLabel } from "@/lib/variant-name";
import type { CreateProduct } from "@myapp/shared/schemas/product.schema";
import type { PrismaTx, ProductRow, ProductStatus, ProductTableRow } from "@/types";
import { Prisma, StockDirection, StockMovementType } from "generated/prisma";
import { AppError } from "@/utils/AppError";
import { resolveImageRefs } from "@/controllers/media.controller";

export const ProductService = {
    async getAll(
        tx: PrismaTx,
        shopId: string,
        page = 1,
        pageSize = 20,
        search: string = "",
        status?: ProductStatus | "ALL"
    ): Promise<{ data: ProductTableRow[]; total: number }> {
        const offset = (page - 1) * pageSize;

        // ── Search clause ──────────────────────────────────────────────────────
        // Filtered AFTER the CTE, alongside the status clause, so it must use
        // the CTE's output columns (`name`, `category`). The `p.`/`c.` aliases
        // only exist inside `computed`, and referencing them out here made
        // Postgres reject the whole statement with "missing FROM-clause entry
        // for table p" — every search, on every keystroke, returned a 500.
        // ILIKE is already case-insensitive, so LOWER() added nothing.
        const searchClause =
            search.trim() !== ""
                ? Prisma.sql`AND (
                name       ILIKE ${"%" + search.trim() + "%"}
                OR category ILIKE ${"%" + search.trim() + "%"}
              )`
                : Prisma.empty;

        // ── Status clause ──────────────────────────────────────────────────────
        // Status is computed in the CTE, so we filter AFTER computation.
        // We inject as a literal since it's an enum we control (safe).
        const statusClause =
            status && status !== "ALL"
                ? Prisma.sql`AND computed_status = ${status}`
                : Prisma.empty;

        // Stock comes from the denormalized product_variants.stock_on_hand
        // column, kept in sync with the ledger on every write. Deriving it here
        // with DISTINCT ON over stock_ledgers meant scanning every stock
        // movement ever recorded on each keystroke of a POS search.
        //
        // `shop_products` is materialised first and `product_stock` joins to
        // it. Without that join the aggregate grouped EVERY active variant in
        // the database — all tenants — before a single row was filtered to this
        // shop, so one merchant's search got slower as unrelated merchants
        // added stock. Now it walks `products(shop_id)` and touches only this
        // shop's variants via `product_variants(product_id)`.
        const rows = await tx.$queryRaw<ProductRow[]>(Prisma.sql`
        WITH shop_products AS (
            SELECT
                p.id,
                p.name,
                p.reorder_level,
                p.is_active,
                p.category_id
            FROM products p
            WHERE p.is_active = true AND p.shop_id = ${shopId}
        ),
        product_stock AS (
            SELECT
                pv.product_id,
                COALESCE(SUM(pv.stock_on_hand), 0)::INT AS total_stock,
                COUNT(pv.id)::INT                       AS total_variants,
                -- Variants of one product need not share a price, so the row
                -- carries the range and the UI renders "৳900" or "৳900 – ৳1,200".
                -- NULL when nothing under the product has been priced.
                MIN(pv.last_sell_price)                 AS price_min,
                MAX(pv.last_sell_price)                 AS price_max
            FROM product_variants pv
            JOIN shop_products sp ON sp.id = pv.product_id
            WHERE pv.is_active = true
            GROUP BY pv.product_id
        ),
        computed AS (
            SELECT
                sp.id,
                sp.name,
                sp.reorder_level,
                sp.is_active,
                c.name                          AS category,
                COALESCE(ps.total_stock, 0)     AS stock,
                COALESCE(ps.total_variants, 0)  AS variants,
                ps.price_min,
                ps.price_max,
                CASE
                    WHEN COALESCE(ps.total_stock, 0) = 0                        THEN 'OUT_OF_STOCK'
                    WHEN COALESCE(ps.total_stock, 0) <= sp.reorder_level        THEN 'LOW_STOCK'
                    ELSE 'IN_STOCK'
                END                             AS computed_status
            FROM shop_products sp
            INNER JOIN categories c ON c.id = sp.category_id
            LEFT JOIN  product_stock ps ON ps.product_id = sp.id
        )
        SELECT
            id,
            name,
            reorder_level,
            category,
            stock,
            variants,
            price_min,
            price_max,
            computed_status  AS status,
            COUNT(*) OVER () AS total_count
        FROM computed
        WHERE 1 = 1
        ${searchClause}
        ${statusClause}
        ORDER BY name ASC
        LIMIT  ${pageSize}
        OFFSET ${offset}
    `);

        const total = rows.length > 0 ? Number((rows[0] as any).total_count) : 0;

        return {
            total,
            data: rows.map((row): ProductTableRow => ({
                id: row.id,
                name: row.name,
                category: row.category,
                stock: Number(row.stock),
                variants: Number(row.variants),
                priceMin: row.price_min === null ? null : Number(row.price_min),
                priceMax: row.price_max === null ? null : Number(row.price_max),
                status: row.status as ProductStatus,
            })),
        };
    },
    async getById(tx: PrismaTx, id: string, shopId: string) {
        return tx.product.findFirst({
            where: { id, shop_id: shopId },
            include: {
                variants: true,
            },
        });
    },
    async create(data: CreateProduct, shopId: string, userId: string) {
        const normalized = normalizeProductName(data.name);

        // Every uploaded image has to belong to this shop. Checked before the
        // transaction opens, so a bad reference costs nothing and never holds a
        // write lock; without it, a caller could attach another shop's
        // photograph to their own product by quoting its id.
        const resolved = await resolveImageRefs(data.images ?? [], shopId);
        if (!resolved.ok) {
            throw new AppError(resolved.error, "INVALID_INPUT", 422);
        }
        const images = resolved.values;

        const result = await prisma.$transaction(async (tx) => {
            // The category must belong to the same shop, or a caller could
            // attach their product to someone else's category by id.
            const category = await tx.category.findFirst({
                where: { id: data.category_id, shop_id: shopId },
                select: { id: true },
            });
            if (!category) {
                throw new AppError("Category not found", "INVALID_INPUT", 400);
            }

            const product = await tx.product.create({
                data: {
                    shop_id: shopId,
                    name: data.name,
                    description: data.description,
                    normalized_key: normalized,
                    reorder_level: data.reorder_level,
                    brand: data.brand,
                    // Plain id rather than `category: { connect }`: Prisma
                    // rejects mixing a scalar FK with a nested connect.
                    category_id: data.category_id,
                },
                include: {
                    category: {
                        select: {
                            name: true
                        }
                    }
                }
            })
            // Photographs are attached to the product itself rather than a
            // variant: a colour/size split of the same item is the same item in
            // a picture, and per-variant galleries would ask the merchant to
            // photograph the same shirt four times.
            if (images.length > 0) {
                await tx.productImage.createMany({
                    data: images.map((ref, index) => ({
                        product_id: product.id,
                        url: ref,
                        position: index,
                    })),
                });
            }

            const variants = await Promise.all(
                data.variants.map((variant) => {
                    const color = variant.color?.trim() || null;
                    const size = variant.size?.trim() || null;
                    const name = variantLabel(color, size);

                    return tx.productVariant.create({
                        data: {
                            product_id: product.id,
                            name,
                            color,
                            size,
                            // New rows are invisible to other transactions until
                            // commit. Return the same balance as the ledger below.
                            stock_on_hand: variant.stock ?? 0,
                            // The shelf price. Without it the product is stock
                            // nobody can buy — the till has nothing to ring up
                            // and the storefront withholds the product rather
                            // than quote it at zero. A later purchase overwrites
                            // this with that batch's price, which is correct:
                            // the newest batch sets the current shelf price.
                            last_sell_price:
                                variant.sell_price && variant.sell_price > 0
                                    ? variant.sell_price
                                    : null,
                        },
                    });

                })

            )

            // Opening stock is an inventory movement, not just a number on
            // ProductVariant. Recording it as an adjustment keeps the
            // append-only ledger and the fast stock_on_hand balance in sync.
            const openingStock = variants
                .map((variant, index) => ({
                    variantId: variant.id,
                    quantity: data.variants[index]?.stock ?? 0,
                }))
                .filter((item) => item.quantity > 0);

            if (openingStock.length > 0) {
                const adjustment = await tx.stockAdjustment.create({
                    data: {
                        shop_id: shopId,
                        adjusted_by: userId,
                        reason: "Initial stock",
                        note: `Opening stock entered when creating ${product.name}`,
                    },
                });

                await tx.stockAdjustmentItem.createMany({
                    data: openingStock.map((item) => ({
                        adjustment_id: adjustment.id,
                        variant_id: item.variantId,
                        direction: StockDirection.IN,
                        quantity: item.quantity,
                        note: "Initial stock",
                    })),
                });

                await tx.stockLedger.createMany({
                    data: openingStock.map((item) => ({
                        adjustment_id: adjustment.id,
                        variant_id: item.variantId,
                        type: StockMovementType.ADJUSTMENT,
                        direction: StockDirection.IN,
                        quantity: item.quantity,
                        balance_after: item.quantity,
                    })),
                });

            }
            return { product, variants };
        });
        return result;
    },
    async update(tx: PrismaTx, id: string, shopId: string, data: any) {
        return tx.product.updateMany({
            where: { id, shop_id: shopId },
            data,
        });
    },
    async deleteById(tx: PrismaTx, id: string, shopId: string) {
        return tx.product.deleteMany({
            where: { id, shop_id: shopId },
        });
    },
}
