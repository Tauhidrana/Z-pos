/**
 * The public storefront API.
 *
 * Everything here is unauthenticated and reachable by anyone on the internet,
 * so two rules hold throughout:
 *
 *   1. The tenant is resolved from the URL slug and nothing else. There is no
 *      shop id, store id or user id in any request, so there is nothing for a
 *      caller to tamper with — asking for `/storefront/abc/...` can only ever
 *      return the `abc` store's data.
 *   2. Responses carry only what a shopper needs. No cost prices, no suppliers,
 *      no internal ids beyond the ones needed to place an order, no other
 *      customer's details, and never the shop's own identifiers.
 */

import type { Context } from "hono";
import prisma from "@/lib/prisma";
import { sendError, sendSuccess } from "@/utils/response";
import { AppError } from "@/utils/AppError";
import { mediaUrlResolver } from "@/controllers/media.controller";
import {
    discountPercent,
    isNewProduct,
    pickDisplayVariant,
    resolvePrice,
    round2,
} from "@/lib/store";
import type {
    StoreBannerPublic,
    StoreCategory,
    StoreHome,
    StorePolicies,
    StorePolicyFlags,
    StorePublic,
    StoreProductCard,
    StoreProductDetail,
    StoreOrderConfirmation,
} from "@myapp/shared";
import { isValidBdAddress } from "@myapp/shared/data/bd-geo";
import type { PlaceOrderPayload } from "@myapp/shared/schemas/online-order.schema";
import { Prisma, StockDirection, StockMovementType } from "generated/prisma";
import { Decimal } from "generated/prisma/runtime/client";

// ── Shared selects ───────────────────────────────────────────────────────────

const VARIANT_PRICE_SELECT = {
    id: true,
    name: true,
    color: true,
    size: true,
    is_active: true,
    stock_on_hand: true,
    last_sell_price: true,
    online_price: true,
    online_sale_price: true,
} as const;

const PRODUCT_CARD_SELECT = {
    id: true,
    name: true,
    slug: true,
    brand: true,
    created_at: true,
    is_featured: true,
    category: { select: { name: true, slug: true } },
    images: {
        select: { url: true, alt: true },
        orderBy: { position: "asc" },
        take: 1,
    },
    variants: { select: VARIANT_PRICE_SELECT },
} as const;

type ProductCardRow = Prisma.ProductGetPayload<{ select: typeof PRODUCT_CARD_SELECT }>;

/**
 * Only products the merchant has published, that are active, and that have at
 * least one active variant. Reused by every listing so a single definition of
 * "on sale to the public" governs the whole storefront.
 */
function publicProductWhere(shopId: string): Prisma.ProductWhereInput {
    return {
        shop_id: shopId,
        is_active: true,
        online_visible: true,
        variants: { some: { is_active: true } },
    };
}

/**
 * Map a product row to a card, or null when it has no sellable price.
 *
 * A product whose variants have never been purchased has no shelf price, and
 * quoting one at ৳0 would be worse than omitting it — so it is withheld from
 * the storefront entirely and flagged in the merchant's dashboard instead.
 */
function toCard(
    product: ProductCardRow,
    mediaUrl: (ref: string | null | undefined) => string | null,
): StoreProductCard | null {
    const display = pickDisplayVariant(product.variants);
    if (!display) return null;

    const totalStock = product.variants
        .filter((v) => v.is_active)
        .reduce((sum, v) => sum + v.stock_on_hand, 0);

    return {
        id: product.id,
        slug: product.slug ?? product.id,
        name: product.name,
        brand: product.brand,
        categoryName: product.category.name,
        categorySlug: product.category.slug,
        imageUrl: mediaUrl(product.images[0]?.url),
        price: display.price,
        compareAtPrice: display.compareAtPrice,
        discountPercent: discountPercent(display.price, display.compareAtPrice),
        inStock: totalStock > 0,
        totalStock,
        isFeatured: product.is_featured,
        isNew: isNewProduct(product.created_at),
    };
}

function toCards(
    products: ProductCardRow[],
    mediaUrl: (ref: string | null | undefined) => string | null,
): StoreProductCard[] {
    return products
        .map((product) => toCard(product, mediaUrl))
        .filter((c): c is StoreProductCard => c !== null);
}

function toPublicStore(
    mediaUrl: (ref: string | null | undefined) => string | null,
    store: {
    slug: string;
    name: string;
    description: string | null;
    logo_url: string | null;
    banner_url: string | null;
    favicon_url: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    facebook_url: string | null;
    instagram_url: string | null;
    whatsapp_number: string | null;
    latitude: Decimal | null;
    longitude: Decimal | null;
    opening_hours: string | null;
    meta_title: string | null;
    meta_description: string | null;
    delivery_charge: Decimal;
    free_delivery_over: Decimal | null;
    min_order_amount: Decimal;
    theme_color: string;
    },
): StorePublic {
    return {
        slug: store.slug,
        name: store.name,
        description: store.description,
        logoUrl: mediaUrl(store.logo_url),
        bannerUrl: mediaUrl(store.banner_url),
        faviconUrl: mediaUrl(store.favicon_url),
        phone: store.phone,
        email: store.email,
        address: store.address,
        facebookUrl: store.facebook_url,
        instagramUrl: store.instagram_url,
        whatsappNumber: store.whatsapp_number,
        latitude: store.latitude === null ? null : Number(store.latitude),
        longitude: store.longitude === null ? null : Number(store.longitude),
        openingHours: store.opening_hours,
        metaTitle: store.meta_title,
        metaDescription: store.meta_description,
        deliveryCharge: Number(store.delivery_charge),
        freeDeliveryOver:
            store.free_delivery_over === null ? null : Number(store.free_delivery_over),
        minOrderAmount: Number(store.min_order_amount),
        themeColor: store.theme_color,
    };
}

const STORE_SELECT = {
    id: true,
    shop_id: true,
    slug: true,
    name: true,
    description: true,
    logo_url: true,
    banner_url: true,
    favicon_url: true,
    phone: true,
    email: true,
    address: true,
    facebook_url: true,
    instagram_url: true,
    whatsapp_number: true,
    latitude: true,
    longitude: true,
    opening_hours: true,
    meta_title: true,
    meta_description: true,
    delivery_charge: true,
    free_delivery_over: true,
    min_order_amount: true,
    theme_color: true,
    is_active: true,
} as const;

/**
 * Which policy pages have content.
 *
 * A separate query that returns four booleans rather than four columns in
 * `STORE_SELECT`: terms and a privacy policy can each run to twenty thousand
 * characters, and the homepage only needs to know whether to render a footer
 * link. Selecting the text to test it for emptiness would ship all of it on
 * every storefront request. It runs inside the homepage's existing
 * `Promise.all`, so it costs no extra round-trip.
 */
async function policyFlags(storeId: string): Promise<StorePolicyFlags> {
    const rows = await prisma.$queryRaw<
        {
            has_delivery_info: boolean;
            has_return_policy: boolean;
            has_terms: boolean;
            has_privacy_policy: boolean;
        }[]
    >`
        SELECT
            COALESCE(delivery_info,  '') <> '' AS has_delivery_info,
            COALESCE(return_policy,  '') <> '' AS has_return_policy,
            COALESCE(terms,          '') <> '' AS has_terms,
            COALESCE(privacy_policy, '') <> '' AS has_privacy_policy
        FROM stores
        WHERE id = ${storeId}
    `;

    const row = rows[0];
    return {
        hasDeliveryInfo: row?.has_delivery_info ?? false,
        hasReturnPolicy: row?.has_return_policy ?? false,
        hasTerms: row?.has_terms ?? false,
        hasPrivacyPolicy: row?.has_privacy_policy ?? false,
    };
}

type StoreRow = Prisma.StoreGetPayload<{ select: typeof STORE_SELECT }>;

/**
 * Resolve the tenant for a request, or throw the response the storefront should
 * render. "No such store" and "the merchant switched it off" are different
 * pages to a visitor, so they are different codes here.
 */
async function requireStore(slugParam: string | undefined): Promise<StoreRow> {
    const slug = slugParam?.trim().toLowerCase();
    if (!slug) throw new AppError("Store not found", "STORE_NOT_FOUND", 404);

    const store = await prisma.store.findUnique({ where: { slug }, select: STORE_SELECT });
    if (!store) throw new AppError("Store not found", "STORE_NOT_FOUND", 404);
    if (!store.is_active) {
        throw new AppError(
            "This store is not accepting orders right now.",
            "STORE_DISABLED",
            403,
        );
    }
    return store;
}

/** Public reads are cacheable at the edge for a few seconds; orders never are. */
function cacheFor(c: Context, seconds: number) {
    c.header(
        "Cache-Control",
        `public, max-age=0, s-maxage=${seconds}, stale-while-revalidate=${seconds * 6}`,
    );
}

// ── Controller ───────────────────────────────────────────────────────────────

export const StorefrontController = {
    /**
     * Everything the homepage renders, in one request: store identity,
     * categories with counts, and the three product rails. A phone on a slow
     * connection should not pay for four round-trips to see a shop front.
     */
    async getHome(c: Context) {
        const mediaUrl = mediaUrlResolver(c);
        const store = await requireStore(c.req.param("slug"));
        const where = publicProductWhere(store.shop_id);

        const [banners, policies, categories, featured, latest, discounted] = await Promise.all([
            prisma.storeBanner.findMany({
                where: { store_id: store.id, is_active: true },
                select: {
                    id: true,
                    image_url: true,
                    title: true,
                    subtitle: true,
                    button_text: true,
                    button_link: true,
                },
                orderBy: [{ position: "asc" }, { created_at: "asc" }],
            }),
            policyFlags(store.id),
            prisma.category.findMany({
                where: {
                    shop_id: store.shop_id,
                    is_active: true,
                    products: { some: where },
                },
                select: {
                    id: true,
                    name: true,
                    slug: true,
                    image_url: true,
                    _count: { select: { products: { where } } },
                },
                // Merchant order first, then alphabetical — an untouched
                // catalogue stays alphabetical because every row defaults to 0.
                orderBy: [{ position: "asc" }, { name: "asc" }],
            }),
            prisma.product.findMany({
                where: { ...where, is_featured: true },
                select: PRODUCT_CARD_SELECT,
                orderBy: { updated_at: "desc" },
                take: 12,
            }),
            prisma.product.findMany({
                where,
                select: PRODUCT_CARD_SELECT,
                orderBy: { created_at: "desc" },
                take: 12,
            }),
            // Candidates for the sale rail: a discount lives on the variant, so
            // the filter narrows to products that have one and `toCards` then
            // drops any where the "sale" price is not actually lower.
            prisma.product.findMany({
                where: { ...where, variants: { some: { is_active: true, online_sale_price: { not: null } } } },
                select: PRODUCT_CARD_SELECT,
                orderBy: { updated_at: "desc" },
                take: 24,
            }),
        ]);

        const payload: StoreHome = {
            store: toPublicStore(mediaUrl, store),
            banners: banners.map(
                (banner): StoreBannerPublic => ({
                    id: banner.id,
                    // Resolved to a loadable URL here, like every other image:
                    // the row holds a reference with no hostname in it.
                    imageUrl: mediaUrl(banner.image_url) ?? "",
                    title: banner.title,
                    subtitle: banner.subtitle,
                    buttonText: banner.button_text,
                    buttonLink: banner.button_link,
                }),
                // A banner whose image failed to resolve would render as a
                // broken slide in the middle of the carousel; drop it instead.
            ).filter((banner) => banner.imageUrl !== ""),
            policies,
            categories: categories
                .map(
                    (cat): StoreCategory => ({
                        id: cat.id,
                        name: cat.name,
                        slug: cat.slug,
                        productCount: cat._count.products,
                        imageUrl: mediaUrl(cat.image_url),
                    }),
                )
                .filter((cat) => cat.productCount > 0),
            featured: toCards(featured, mediaUrl),
            latest: toCards(latest, mediaUrl),
            onSale: toCards(discounted, mediaUrl)
                .filter((p) => p.compareAtPrice !== null)
                .slice(0, 12),
        };

        cacheFor(c, 30);
        return sendSuccess(c, payload, "Store fetched successfully");
    },

    /** Catalog listing: search, category filter, sort, paginate. */
    async getProducts(c: Context) {
        const mediaUrl = mediaUrlResolver(c);
        const store = await requireStore(c.req.param("slug"));

        const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10) || 1);
        const limit = Math.min(48, Math.max(1, parseInt(c.req.query("limit") ?? "24", 10) || 24));
        const search = c.req.query("search")?.trim() ?? "";
        const category = c.req.query("category")?.trim() ?? "";
        const sort = c.req.query("sort")?.trim() ?? "newest";
        const inStockOnly = c.req.query("inStock") === "1";

        const where: Prisma.ProductWhereInput = {
            ...publicProductWhere(store.shop_id),
            ...(category ? { category: { slug: category } } : {}),
            ...(search
                ? {
                      OR: [
                          { name: { contains: search, mode: "insensitive" } },
                          { brand: { contains: search, mode: "insensitive" } },
                          { description: { contains: search, mode: "insensitive" } },
                          { category: { name: { contains: search, mode: "insensitive" } } },
                      ],
                  }
                : {}),
            ...(inStockOnly ? { variants: { some: { is_active: true, stock_on_hand: { gt: 0 } } } } : {}),
        };

        // Price sorting cannot be pushed into the database: the effective price
        // is `online_sale_price ?? online_price ?? last_sell_price` picked from
        // the cheapest sellable variant, which no single column expresses. Name
        // and recency sort in SQL as usual; for price we take an ordered window
        // and sort the page's cards. The window is capped so a huge catalog
        // still answers in bounded time.
        const sortsByPrice = sort === "price_asc" || sort === "price_desc";

        const orderBy: Prisma.ProductOrderByWithRelationInput =
            sort === "name_asc"
                ? { name: "asc" }
                : sort === "name_desc"
                  ? { name: "desc" }
                  : sort === "oldest"
                    ? { created_at: "asc" }
                    : { created_at: "desc" };

        if (sortsByPrice) {
            const PRICE_SORT_WINDOW = 600;
            const [rows, total] = await Promise.all([
                prisma.product.findMany({
                    where,
                    select: PRODUCT_CARD_SELECT,
                    orderBy: { created_at: "desc" },
                    take: PRICE_SORT_WINDOW,
                }),
                prisma.product.count({ where }),
            ]);

            const cards = toCards(rows, mediaUrl).sort((a, b) =>
                sort === "price_asc" ? a.price - b.price : b.price - a.price,
            );
            const start = (page - 1) * limit;

            cacheFor(c, 15);
            return sendSuccess(
                c,
                {
                    items: cards.slice(start, start + limit),
                    total: Math.min(total, cards.length),
                    page,
                    totalPages: Math.max(1, Math.ceil(cards.length / limit)),
                },
                "Products fetched successfully",
            );
        }

        const [rows, total] = await Promise.all([
            prisma.product.findMany({
                where,
                select: PRODUCT_CARD_SELECT,
                orderBy,
                skip: (page - 1) * limit,
                take: limit,
            }),
            prisma.product.count({ where }),
        ]);

        cacheFor(c, 15);
        return sendSuccess(
            c,
            {
                items: toCards(rows, mediaUrl),
                total,
                page,
                totalPages: Math.max(1, Math.ceil(total / limit)),
            },
            "Products fetched successfully",
        );
    },

    /** One product, its gallery, its buyable variants, and a related rail. */
    async getProduct(c: Context) {
        const mediaUrl = mediaUrlResolver(c);
        const store = await requireStore(c.req.param("slug"));
        const key = c.req.param("productSlug")?.trim() ?? "";

        if (!key) return sendError(c, "Product not found", "PRODUCT_NOT_FOUND", 404);

        const product = await prisma.product.findFirst({
            // Slug first, id as a fallback, both pinned to this shop — a product
            // id from another store resolves to nothing.
            where: {
                ...publicProductWhere(store.shop_id),
                OR: [{ slug: key }, { id: key }],
            },
            select: {
                ...PRODUCT_CARD_SELECT,
                description: true,
                category: { select: { id: true, name: true, slug: true } },
                images: {
                    select: { url: true, alt: true },
                    orderBy: { position: "asc" },
                },
            },
        });

        if (!product) {
            return sendError(c, "Product not found", "PRODUCT_NOT_FOUND", 404);
        }

        const card = toCard({ ...product, images: product.images.slice(0, 1) }, mediaUrl);
        if (!card) {
            // Published but unpriced: to a shopper this is the same as not
            // being for sale, and it must not render a ৳0 buy button.
            return sendError(c, "Product is not available", "PRODUCT_UNAVAILABLE", 404);
        }

        const variants = product.variants
            .filter((v) => v.is_active)
            .map((v) => {
                const { price, compareAtPrice } = resolvePrice(v);
                return price === null
                    ? null
                    : {
                          id: v.id,
                          name: v.name,
                          color: v.color,
                          size: v.size,
                          price,
                          compareAtPrice,
                          stock: v.stock_on_hand,
                          inStock: v.stock_on_hand > 0,
                      };
            })
            .filter((v): v is NonNullable<typeof v> => v !== null);

        const related = await prisma.product.findMany({
            where: {
                ...publicProductWhere(store.shop_id),
                category_id: product.category.id,
                id: { not: product.id },
            },
            select: PRODUCT_CARD_SELECT,
            orderBy: { created_at: "desc" },
            take: 8,
        });

        const detail: StoreProductDetail = {
            ...card,
            description: product.description,
            images: product.images
                .map((img) => ({ url: mediaUrl(img.url), alt: img.alt }))
                .filter((img): img is { url: string; alt: string | null } => img.url !== null),
            variants,
            sku: null,
        };

        cacheFor(c, 30);
        return sendSuccess(
            c,
            { product: detail, related: toCards(related, mediaUrl).slice(0, 4) },
            "Product fetched successfully",
        );
    },

    /** Category list for the storefront's browse page and mobile nav. */
    async getCategories(c: Context) {
        const mediaUrl = mediaUrlResolver(c);
        const store = await requireStore(c.req.param("slug"));
        const where = publicProductWhere(store.shop_id);

        const categories = await prisma.category.findMany({
            where: { shop_id: store.shop_id, is_active: true, products: { some: where } },
            select: {
                id: true,
                name: true,
                slug: true,
                image_url: true,
                _count: { select: { products: { where } } },
            },
            orderBy: [{ position: "asc" }, { name: "asc" }],
        });

        cacheFor(c, 60);
        return sendSuccess(
            c,
            categories
                .map(
                    (cat): StoreCategory => ({
                        id: cat.id,
                        name: cat.name,
                        slug: cat.slug,
                        productCount: cat._count.products,
                        imageUrl: mediaUrl(cat.image_url),
                    }),
                )
                .filter((cat) => cat.productCount > 0),
            "Categories fetched successfully",
        );
    },

    /**
     * The merchant's published policy pages.
     *
     * Its own endpoint rather than part of the homepage payload: this is the
     * long text, fetched only when a shopper actually opens one of the pages,
     * and cached hard because it changes about once a year.
     */
    async getPolicies(c: Context) {
        const store = await requireStore(c.req.param("slug"));

        const row = await prisma.store.findUnique({
            where: { id: store.id },
            select: {
                delivery_info: true,
                return_policy: true,
                terms: true,
                privacy_policy: true,
            },
        });

        const policies: StorePolicies = {
            deliveryInfo: row?.delivery_info ?? null,
            returnPolicy: row?.return_policy ?? null,
            terms: row?.terms ?? null,
            privacyPolicy: row?.privacy_policy ?? null,
        };

        cacheFor(c, 300);
        return sendSuccess(c, policies, "Policies fetched successfully");
    },

    /**
     * Place a cash-on-delivery order.
     *
     * The client sends variant ids and quantities. Everything financial is
     * recomputed here from the merchant's own catalog, and stock is taken under
     * the same `FOR UPDATE` discipline the till uses, so two shoppers racing for
     * the last unit cannot both win it.
     */
    async placeOrder(c: Context) {
        const mediaUrl = mediaUrlResolver(c);
        const store = await requireStore(c.req.param("slug"));
        const body = c.get("validatedBody") as PlaceOrderPayload;

        // ── 1. Address must be a real division → district → upazila chain ────
        const { division, district, upazila } = body.address;
        if (!isValidBdAddress(division, district, upazila)) {
            return sendError(
                c,
                "Please choose a valid division, district and upazila.",
                "INVALID_ADDRESS",
                422,
            );
        }

        // ── 2. Merge duplicate lines so one variant is locked once ───────────
        const qtyByVariant = new Map<string, number>();
        for (const item of body.items) {
            qtyByVariant.set(item.variantId, (qtyByVariant.get(item.variantId) ?? 0) + item.quantity);
        }
        const variantIds = [...qtyByVariant.keys()];

        // ── 3. Price the cart from the catalog, not from the request ─────────
        const variants = await prisma.productVariant.findMany({
            where: {
                id: { in: variantIds },
                is_active: true,
                // The tenant boundary: a variant id belonging to another shop
                // matches nothing here, so it cannot be bought through this
                // storefront at any price.
                product: {
                    shop_id: store.shop_id,
                    is_active: true,
                    online_visible: true,
                },
            },
            select: {
                ...VARIANT_PRICE_SELECT,
                product: {
                    select: {
                        name: true,
                        images: { select: { url: true }, orderBy: { position: "asc" }, take: 1 },
                    },
                },
            },
        });

        if (variants.length !== variantIds.length) {
            return sendError(
                c,
                "Some items are no longer available. Please review your cart.",
                "ITEM_UNAVAILABLE",
                422,
            );
        }

        type Line = {
            variantId: string;
            productName: string;
            variantName: string | null;
            imageUrl: string | null;
            unitPrice: number;
            quantity: number;
            total: number;
        };

        const lines: Line[] = [];
        let subtotal = 0;

        for (const variant of variants) {
            const quantity = qtyByVariant.get(variant.id)!;
            const { price } = resolvePrice(variant);

            if (price === null) {
                return sendError(
                    c,
                    `"${variant.product.name}" is not available for online orders right now.`,
                    "ITEM_UNAVAILABLE",
                    422,
                );
            }

            const lineTotal = round2(price * quantity);
            subtotal = round2(subtotal + lineTotal);

            lines.push({
                variantId: variant.id,
                productName: variant.product.name,
                variantName: variant.name,
                imageUrl: variant.product.images[0]?.url ?? null,
                unitPrice: price,
                quantity,
                total: lineTotal,
            });
        }

        // ── 4. Store-level rules ─────────────────────────────────────────────
        const minOrder = Number(store.min_order_amount);
        if (minOrder > 0 && subtotal < minOrder) {
            return sendError(
                c,
                `Minimum order is ৳${minOrder}. Please add a little more to your cart.`,
                "BELOW_MIN_ORDER",
                422,
            );
        }

        const freeOver =
            store.free_delivery_over === null ? null : Number(store.free_delivery_over);
        const deliveryCharge =
            freeOver !== null && subtotal >= freeOver ? 0 : round2(Number(store.delivery_charge));
        const total = round2(subtotal + deliveryCharge);

        // ── 5. Reuse the shop's customer record ──────────────────────────────
        // Same upsert the POS checkout performs, so an online buyer and a
        // walk-in on the same number are one customer, not two.
        let customerId: string | null = null;
        try {
            const customer = await prisma.customer.upsert({
                where: { shop_id_phone: { shop_id: store.shop_id, phone: body.customer.phone } },
                update: {
                    name: body.customer.name,
                    email: body.customer.email || undefined,
                    address: `${body.address.addressLine}, ${upazila}, ${district}`,
                },
                create: {
                    shop_id: store.shop_id,
                    name: body.customer.name,
                    phone: body.customer.phone,
                    email: body.customer.email || undefined,
                    address: `${body.address.addressLine}, ${upazila}, ${district}`,
                },
                select: { id: true },
            });
            customerId = customer.id;
        } catch (err) {
            // A customer row is a convenience for the merchant, not a condition
            // of the sale. Losing that race must never cost the order.
            console.error("[storefront] customer upsert failed:", err);
        }

        // ── 6. Commit: lock stock, verify, decrement, write the order ────────
        const order = await prisma.$transaction(async (tx) => {
            const locked = await tx.$queryRaw<
                Array<{ id: string; stock_on_hand: number }>
            >(Prisma.sql`
                SELECT pv.id, pv.stock_on_hand
                FROM product_variants pv
                JOIN products p ON p.id = pv.product_id
                WHERE pv.id IN (${Prisma.join(variantIds)})
                  AND p.shop_id = ${store.shop_id}
                FOR UPDATE OF pv
            `);

            if (locked.length !== variantIds.length) {
                throw new AppError(
                    "Some items are no longer available. Please review your cart.",
                    "ITEM_UNAVAILABLE",
                    422,
                );
            }

            const stockById = new Map(locked.map((v) => [v.id, Number(v.stock_on_hand)]));

            for (const line of lines) {
                const available = stockById.get(line.variantId) ?? 0;
                if (available < line.quantity) {
                    throw new AppError(
                        available === 0
                            ? `"${line.productName}" just sold out.`
                            : `Only ${available} left of "${line.productName}". Please lower the quantity.`,
                        "INSUFFICIENT_STOCK",
                        422,
                    );
                }
            }

            const counter = await tx.counter.upsert({
                where: { shop_id_key: { shop_id: store.shop_id, key: "online_order" } },
                update: { value: { increment: 1 } },
                create: { shop_id: store.shop_id, key: "online_order", value: 1001 },
            });
            const orderNumber = `ORD-${String(counter.value).padStart(6, "0")}`;

            const created = await tx.onlineOrder.create({
                data: {
                    shop_id: store.shop_id,
                    store_id: store.id,
                    order_number: orderNumber,
                    status: "PENDING",
                    payment_method: "COD",
                    customer_id: customerId,
                    customer_name: body.customer.name,
                    customer_phone: body.customer.phone,
                    customer_email: body.customer.email ?? null,
                    division,
                    district,
                    upazila,
                    area: body.address.area ?? null,
                    address_line: body.address.addressLine,
                    note: body.note ?? null,
                    subtotal: new Decimal(subtotal),
                    delivery_charge: new Decimal(deliveryCharge),
                    total: new Decimal(total),
                    items: {
                        create: lines.map((l) => ({
                            variant_id: l.variantId,
                            product_name: l.productName,
                            variant_name: l.variantName,
                            image_url: l.imageUrl,
                            unit_price: new Decimal(l.unitPrice),
                            quantity: l.quantity,
                            total: new Decimal(l.total),
                        })),
                    },
                },
                select: { id: true, order_number: true, placed_at: true },
            });

            // Stock leaves the shelf now, not on dispatch — the ledger records
            // the movement and the denormalized column is decremented under the
            // lock taken above, exactly as a till sale does.
            await tx.stockLedger.createMany({
                data: lines.map((l) => ({
                    variant_id: l.variantId,
                    type: StockMovementType.SALE,
                    direction: StockDirection.OUT,
                    quantity: l.quantity,
                    balance_after: (stockById.get(l.variantId) ?? 0) - l.quantity,
                    online_order_id: created.id,
                })),
            });

            await Promise.all(
                lines.map((l) =>
                    tx.productVariant.update({
                        where: { id: l.variantId },
                        data: { stock_on_hand: { decrement: l.quantity } },
                    }),
                ),
            );

            return created;
        });

        return sendSuccess(
            c,
            {
                orderNumber: order.order_number,
                total,
                subtotal,
                deliveryCharge,
                placedAt: order.placed_at.toISOString(),
            },
            "Order placed successfully",
            201,
        );
    },

    /**
     * Order lookup for the confirmation and tracking page.
     *
     * Order numbers are sequential and therefore guessable, so the customer's
     * phone number is required alongside — it is the one thing the buyer knows
     * and a passer-by does not. Without it this would leak names and addresses
     * to anyone counting upwards.
     */
    async getOrder(c: Context) {
        const mediaUrl = mediaUrlResolver(c);
        const store = await requireStore(c.req.param("slug"));
        const orderNumber = c.req.param("orderNumber")?.trim().toUpperCase() ?? "";
        const phone = c.req.query("phone")?.trim() ?? "";

        if (!orderNumber || !phone) {
            return sendError(c, "Order not found", "ORDER_NOT_FOUND", 404);
        }

        const order = await prisma.onlineOrder.findFirst({
            where: {
                shop_id: store.shop_id,
                order_number: orderNumber,
                customer_phone: phone,
            },
            select: {
                order_number: true,
                status: true,
                placed_at: true,
                customer_name: true,
                customer_phone: true,
                division: true,
                district: true,
                upazila: true,
                area: true,
                address_line: true,
                note: true,
                subtotal: true,
                delivery_charge: true,
                total: true,
                items: {
                    select: {
                        product_name: true,
                        variant_name: true,
                        image_url: true,
                        unit_price: true,
                        quantity: true,
                        total: true,
                    },
                },
            },
        });

        if (!order) {
            return sendError(
                c,
                "We could not find that order. Check the order number and phone number.",
                "ORDER_NOT_FOUND",
                404,
            );
        }

        const payload: StoreOrderConfirmation = {
            orderNumber: order.order_number,
            status: order.status,
            placedAt: order.placed_at.toISOString(),
            customerName: order.customer_name,
            customerPhone: order.customer_phone,
            address: {
                division: order.division,
                district: order.district,
                upazila: order.upazila,
                area: order.area,
                addressLine: order.address_line,
            },
            items: order.items.map((item) => ({
                productName: item.product_name,
                variantName: item.variant_name,
                imageUrl: mediaUrl(item.image_url),
                unitPrice: Number(item.unit_price),
                quantity: item.quantity,
                total: Number(item.total),
            })),
            subtotal: Number(order.subtotal),
            deliveryCharge: Number(order.delivery_charge),
            total: Number(order.total),
            paymentMethod: "COD",
            note: order.note,
        };

        c.header("Cache-Control", "no-store");
        return sendSuccess(c, payload, "Order fetched successfully");
    },
};
