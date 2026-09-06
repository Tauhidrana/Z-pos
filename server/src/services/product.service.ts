import prisma from "@/lib/prisma";
import { normalizeProductName } from "@/lib/product-name-normalizer";
import type { CreateProduct } from "@myapp/shared/schemas/product.schema";
import type { PrismaTx, ProductRow, ProductStatus, ProductTableRow } from "@/types";
import { Prisma } from "generated/prisma";
import { AppError } from "@/utils/AppError";

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
        const rows = await tx.$queryRaw<ProductRow[]>(Prisma.sql`
        WITH product_stock AS (
            SELECT
                pv.product_id,
                COALESCE(SUM(pv.stock_on_hand), 0)::INT AS total_stock,
                COUNT(pv.id)::INT                       AS total_variants
            FROM product_variants pv
            WHERE pv.is_active = true
            GROUP BY pv.product_id
        ),
        computed AS (
            SELECT
                p.id,
                p.name,
                p.reorder_level,
                p.is_active,
                c.name                          AS category,
                COALESCE(ps.total_stock, 0)     AS stock,
                COALESCE(ps.total_variants, 0)  AS variants,
                CASE
                    WHEN COALESCE(ps.total_stock, 0) = 0                        THEN 'OUT_OF_STOCK'
                    WHEN COALESCE(ps.total_stock, 0) <= p.reorder_level         THEN 'LOW_STOCK'
                    ELSE 'IN_STOCK'
                END                             AS computed_status
            FROM products p
            INNER JOIN categories c ON c.id = p.category_id
            LEFT JOIN  product_stock ps ON ps.product_id = p.id
            WHERE p.is_active = true AND p.shop_id = ${shopId}
        )
        SELECT
            id,
            name,
            reorder_level,
            category,
            stock,
            variants,
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
    async create(data: CreateProduct, shopId: string) {
        const normalized = normalizeProductName(data.name);

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
            const variants = await Promise.all(
                data.variants.map((variant) => {
                    // Build the label from whichever attributes are present.
                    // Interpolating both unconditionally produced names like
                    // "undefined - undefined" for a plain product with no
                    // colour or size. ProductVariant.name is nullable exactly
                    // for that case, so leave it null rather than inventing a
                    // label the cashier would see on the POS screen.
                    const color = variant.color?.trim() || null;
                    const size = variant.size?.trim() || null;
                    const name =
                        [size, color].filter(Boolean).join(" - ") || null;

                    return tx.productVariant.create({
                        data: {
                            product_id: product.id,
                            name,
                            color,
                            size,
                        },
                    });

                })

            )
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