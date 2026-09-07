/**
 * Merchant-side management of the online store.
 *
 * Every handler here runs behind `requireAuth` + `syncUser`, so `shopId` is the
 * session's own tenant and is the only shop these queries ever touch. Nothing
 * accepts a shop or store id from the caller — the store is looked up *from*
 * the session, so there is no id to swap for someone else's.
 */

import type { Context } from "hono";
import prisma from "@/lib/prisma";
import { sendError, sendSuccess } from "@/utils/response";
import { slugify, uniqueProductSlug, resolvePrice, pickDisplayVariant } from "@/lib/store";
import { RESERVED_STORE_SLUGS, storeSlugSchema } from "@myapp/shared/schemas/store.schema";
import type {
    CreateStore,
    UpdateStore,
    UpdateStoreProduct,
    UpdateStoreVariant,
} from "@myapp/shared/schemas/store.schema";
import type { MerchantStore, MerchantStoreProduct, MerchantStoreProductDetail } from "@myapp/shared";
import { mediaUrlResolver, resolveImageRefs } from "@/controllers/media.controller";
import { Prisma } from "generated/prisma";
import { Decimal } from "generated/prisma/runtime/client";

const STORE_SELECT = {
    id: true,
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
    delivery_info: true,
    return_policy: true,
    terms: true,
    privacy_policy: true,
    meta_title: true,
    meta_description: true,
    delivery_charge: true,
    free_delivery_over: true,
    min_order_amount: true,
    theme_color: true,
    is_active: true,
    created_at: true,
} as const;

type StoreRow = Prisma.StoreGetPayload<{ select: typeof STORE_SELECT }>;

function toMerchantStore(
    store: StoreRow,
    mediaUrl: (ref: string | null | undefined) => string | null,
): MerchantStore {
    return {
        id: store.id,
        slug: store.slug,
        name: store.name,
        description: store.description,
        // The stored reference, so the settings form can save it back
        // unchanged; previews resolve it with `imageSrc`.
        logoUrl: store.logo_url,
        bannerUrl: store.banner_url,
        faviconUrl: store.favicon_url,
        phone: store.phone,
        email: store.email,
        address: store.address,
        facebookUrl: store.facebook_url,
        instagramUrl: store.instagram_url,
        whatsappNumber: store.whatsapp_number,
        latitude: store.latitude === null ? null : Number(store.latitude),
        longitude: store.longitude === null ? null : Number(store.longitude),
        openingHours: store.opening_hours,
        deliveryInfo: store.delivery_info,
        returnPolicy: store.return_policy,
        terms: store.terms,
        privacyPolicy: store.privacy_policy,
        metaTitle: store.meta_title,
        metaDescription: store.meta_description,
        deliveryCharge: Number(store.delivery_charge),
        freeDeliveryOver:
            store.free_delivery_over === null ? null : Number(store.free_delivery_over),
        minOrderAmount: Number(store.min_order_amount),
        themeColor: store.theme_color,
        isActive: store.is_active,
        createdAt: store.created_at.toISOString(),
    };
}

/** `undefined` leaves a column alone; `null` clears it. */
function optional<T>(value: T | null | undefined): T | null | undefined {
    return value === undefined ? undefined : value;
}

export const StoreController = {
    /** The signed-in shop's store, or null if they have not opened one. */
    async getMyStore(c: Context) {
        const mediaUrl = mediaUrlResolver(c);
        const store = await prisma.store.findUnique({
            where: { shop_id: c.get("shopId") as string },
            select: STORE_SELECT,
        });

        return sendSuccess(
            c,
            store ? toMerchantStore(store, mediaUrl) : null,
            store ? "Store fetched successfully" : "No store yet",
        );
    },

    /**
     * Is this web address free? Answers yes/no and nothing else — it must not
     * become a way to enumerate which merchants exist, so it never reveals who
     * holds a taken slug.
     */
    async checkSlug(c: Context) {
        const raw = c.req.query("slug") ?? "";
        const parsed = storeSlugSchema.safeParse(raw);

        if (!parsed.success) {
            return sendSuccess(
                c,
                {
                    available: false,
                    reason: parsed.error.issues[0]?.message ?? "Invalid address",
                },
                "Slug checked",
            );
        }

        const shopId = c.get("shopId") as string;
        const existing = await prisma.store.findUnique({
            where: { slug: parsed.data },
            select: { shop_id: true },
        });

        // Their own current slug counts as available, or the settings form
        // would reject saving without changing the address.
        const available = !existing || existing.shop_id === shopId;

        return sendSuccess(
            c,
            {
                available,
                slug: parsed.data,
                reason: available ? null : "That address is already taken",
            },
            "Slug checked",
        );
    },

    /** Open the shop's storefront. One store per shop. */
    async createStore(c: Context) {
        const mediaUrl = mediaUrlResolver(c);
        const shopId = c.get("shopId") as string;
        const body = c.get("validatedBody") as CreateStore;

        const existing = await prisma.store.findUnique({
            where: { shop_id: shopId },
            select: { id: true },
        });
        if (existing) {
            return sendError(
                c,
                "This shop already has an online store.",
                "STORE_EXISTS",
                409,
            );
        }

        try {
            const store = await prisma.store.create({
                data: {
                    shop_id: shopId,
                    slug: body.slug,
                    name: body.name,
                    description: body.description ?? null,
                    logo_url: body.logo_url ?? null,
                    banner_url: body.banner_url ?? null,
                    phone: body.phone ?? null,
                    email: body.email ?? null,
                    address: body.address ?? null,
                },
                select: STORE_SELECT,
            });

            // The shop's display name is what the invite emails and receipts
            // use, and a brand-new self-serve shop is still called "My Shop".
            // Naming the store is the first time the merchant tells us what
            // their business is called, so adopt it.
            await prisma.shop.updateMany({
                where: { id: shopId, name: "My Shop" },
                data: { name: body.name },
            });

            return sendSuccess(c, toMerchantStore(store, mediaUrl), "Store created successfully", 201);
        } catch (err) {
            // Two merchants can pick the same address in the same second; the
            // unique index is what actually decides, and the loser is told so
            // rather than shown a 500.
            if ((err as { code?: string }).code === "P2002") {
                return sendError(
                    c,
                    "That address was just taken. Please choose another.",
                    "SLUG_TAKEN",
                    409,
                );
            }
            throw err;
        }
    },

    async updateStore(c: Context) {
        const mediaUrl = mediaUrlResolver(c);
        const shopId = c.get("shopId") as string;
        const body = c.get("validatedBody") as UpdateStore;

        const store = await prisma.store.findUnique({
            where: { shop_id: shopId },
            select: { id: true },
        });
        if (!store) {
            return sendError(c, "You have not created a store yet.", "STORE_NOT_FOUND", 404);
        }

        if (body.slug && RESERVED_STORE_SLUGS.has(body.slug)) {
            return sendError(c, "That address is reserved.", "SLUG_RESERVED", 422);
        }

        // Uploaded images must be this shop's own, or a merchant could point
        // their storefront's logo at another shop's asset by quoting its id.
        const branding = [body.logo_url, body.banner_url, body.favicon_url].filter(
            (value): value is string => typeof value === "string",
        );
        const brandingCheck = await resolveImageRefs(branding, shopId);
        if (!brandingCheck.ok) {
            return sendError(c, brandingCheck.error, "INVALID_IMAGE", 422);
        }

        const data: Prisma.StoreUpdateInput = {
            ...(body.name !== undefined && { name: body.name }),
            ...(body.slug !== undefined && { slug: body.slug }),
            ...(body.description !== undefined && { description: optional(body.description) }),
            ...(body.logo_url !== undefined && { logo_url: optional(body.logo_url) }),
            ...(body.banner_url !== undefined && { banner_url: optional(body.banner_url) }),
            ...(body.favicon_url !== undefined && { favicon_url: optional(body.favicon_url) }),
            ...(body.phone !== undefined && { phone: optional(body.phone) }),
            ...(body.email !== undefined && { email: optional(body.email) }),
            ...(body.address !== undefined && { address: optional(body.address) }),
            ...(body.facebook_url !== undefined && { facebook_url: optional(body.facebook_url) }),
            ...(body.instagram_url !== undefined && { instagram_url: optional(body.instagram_url) }),
            ...(body.whatsapp_number !== undefined && {
                whatsapp_number: optional(body.whatsapp_number),
            }),
            ...(body.delivery_charge !== undefined && {
                delivery_charge: new Decimal(body.delivery_charge),
            }),
            ...(body.free_delivery_over !== undefined && {
                free_delivery_over:
                    body.free_delivery_over === null ? null : new Decimal(body.free_delivery_over),
            }),
            ...(body.min_order_amount !== undefined && {
                min_order_amount: new Decimal(body.min_order_amount),
            }),
            ...(body.theme_color !== undefined && { theme_color: body.theme_color }),
            ...(body.is_active !== undefined && { is_active: body.is_active }),

            // ── Business location ────────────────────────────────────────────
            ...(body.latitude !== undefined && {
                latitude: body.latitude === null ? null : new Decimal(body.latitude),
            }),
            ...(body.longitude !== undefined && {
                longitude: body.longitude === null ? null : new Decimal(body.longitude),
            }),

            // ── Published policy pages ───────────────────────────────────────
            ...(body.delivery_info !== undefined && {
                delivery_info: optional(body.delivery_info),
            }),
            ...(body.return_policy !== undefined && {
                return_policy: optional(body.return_policy),
            }),
            ...(body.terms !== undefined && { terms: optional(body.terms) }),
            ...(body.privacy_policy !== undefined && {
                privacy_policy: optional(body.privacy_policy),
            }),
            ...(body.opening_hours !== undefined && {
                opening_hours: optional(body.opening_hours),
            }),

            // ── SEO ──────────────────────────────────────────────────────────
            ...(body.meta_title !== undefined && { meta_title: optional(body.meta_title) }),
            ...(body.meta_description !== undefined && {
                meta_description: optional(body.meta_description),
            }),
        };

        try {
            const updated = await prisma.store.update({
                where: { id: store.id },
                data,
                select: STORE_SELECT,
            });
            return sendSuccess(c, toMerchantStore(updated, mediaUrl), "Store updated successfully");
        } catch (err) {
            if ((err as { code?: string }).code === "P2002") {
                return sendError(
                    c,
                    "That address is already taken. Please choose another.",
                    "SLUG_TAKEN",
                    409,
                );
            }
            throw err;
        }
    },

    /**
     * The shop's catalog as the storefront sees it — visibility, imagery and
     * the effective online price of each product, so the merchant can tell at a
     * glance which products would not show up and why.
     */
    async getStoreProducts(c: Context) {
        const mediaUrl = mediaUrlResolver(c);
        const shopId = c.get("shopId") as string;
        const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10) || 1);
        const limit = Math.min(60, Math.max(1, parseInt(c.req.query("limit") ?? "20", 10) || 20));
        const search = c.req.query("search")?.trim() ?? "";
        const filter = c.req.query("filter")?.trim() ?? "all";

        const where: Prisma.ProductWhereInput = {
            shop_id: shopId,
            is_active: true,
            ...(search
                ? {
                      OR: [
                          { name: { contains: search, mode: "insensitive" } },
                          { brand: { contains: search, mode: "insensitive" } },
                      ],
                  }
                : {}),
            ...(filter === "visible" ? { online_visible: true } : {}),
            ...(filter === "hidden" ? { online_visible: false } : {}),
            ...(filter === "featured" ? { is_featured: true } : {}),
            ...(filter === "no_image" ? { images: { none: {} } } : {}),
        };

        const [rows, total] = await Promise.all([
            prisma.product.findMany({
                where,
                select: {
                    id: true,
                    name: true,
                    slug: true,
                    online_visible: true,
                    is_featured: true,
                    is_active: true,
                    category: { select: { name: true } },
                    images: {
                        select: { url: true },
                        orderBy: { position: "asc" },
                    },
                    variants: {
                        select: {
                            is_active: true,
                            stock_on_hand: true,
                            last_sell_price: true,
                            online_price: true,
                            online_sale_price: true,
                        },
                    },
                },
                orderBy: { name: "asc" },
                skip: (page - 1) * limit,
                take: limit,
            }),
            prisma.product.count({ where }),
        ]);

        const items: MerchantStoreProduct[] = rows.map((product) => {
            const display = pickDisplayVariant(product.variants.map((v) => ({ ...v })));
            const activeVariants = product.variants.filter((v) => v.is_active);

            return {
                id: product.id,
                name: product.name,
                slug: product.slug,
                categoryName: product.category.name,
                onlineVisible: product.online_visible,
                isFeatured: product.is_featured,
                isActive: product.is_active,
                imageCount: product.images.length,
                primaryImageUrl: mediaUrl(product.images[0]?.url),
                price: display?.price ?? null,
                compareAtPrice: display?.compareAtPrice ?? null,
                totalStock: activeVariants.reduce((sum, v) => sum + v.stock_on_hand, 0),
                variantCount: activeVariants.length,
            };
        });

        return sendSuccess(
            c,
            {
                items,
                total,
                page,
                totalPages: Math.max(1, Math.ceil(total / limit)),
            },
            "Store products fetched successfully",
        );
    },

    async getStoreProduct(c: Context) {
        const mediaUrl = mediaUrlResolver(c);
        const shopId = c.get("shopId") as string;
        const id = c.req.param("id") ?? "";

        const product = await prisma.product.findFirst({
            where: { id, shop_id: shopId },
            select: {
                id: true,
                name: true,
                slug: true,
                description: true,
                brand: true,
                online_visible: true,
                is_featured: true,
                is_active: true,
                category: { select: { name: true } },
                images: {
                    select: { id: true, url: true, alt: true, position: true },
                    orderBy: { position: "asc" },
                },
                variants: {
                    select: {
                        id: true,
                        name: true,
                        is_active: true,
                        stock_on_hand: true,
                        last_sell_price: true,
                        online_price: true,
                        online_sale_price: true,
                    },
                    orderBy: { created_at: "asc" },
                },
            },
        });

        if (!product) return sendError(c, "Product not found", "NOT_FOUND", 404);

        const payload: MerchantStoreProductDetail = {
            id: product.id,
            name: product.name,
            slug: product.slug,
            description: product.description,
            brand: product.brand,
            categoryName: product.category.name,
            onlineVisible: product.online_visible,
            isFeatured: product.is_featured,
            isActive: product.is_active,
            images: product.images,
            variants: product.variants.map((v) => {
                const { price } = resolvePrice(v);
                return {
                    id: v.id,
                    name: v.name,
                    isActive: v.is_active,
                    stock: v.stock_on_hand,
                    shelfPrice: v.last_sell_price === null ? null : Number(v.last_sell_price),
                    onlinePrice: v.online_price === null ? null : Number(v.online_price),
                    onlineSalePrice:
                        v.online_sale_price === null ? null : Number(v.online_sale_price),
                    effectivePrice: price,
                };
            }),
        };

        return sendSuccess(c, payload, "Product fetched successfully");
    },

    /** Storefront settings for one product: visibility, featured, slug, gallery. */
    async updateStoreProduct(c: Context) {
        const shopId = c.get("shopId") as string;
        const body = c.get("validatedBody") as UpdateStoreProduct;

        const product = await prisma.product.findFirst({
            where: { id: body.id, shop_id: shopId },
            select: { id: true, name: true, slug: true },
        });
        if (!product) return sendError(c, "Product not found", "NOT_FOUND", 404);

        if (body.images !== undefined) {
            const check = await resolveImageRefs(
                body.images.map((image) => image.url),
                shopId,
            );
            if (!check.ok) return sendError(c, check.error, "INVALID_IMAGE", 422);
        }

        // A product that predates slugs, or one being renamed, gets a free slug
        // resolved within this shop.
        let slug = product.slug;
        if (body.slug !== undefined || !product.slug) {
            const base = slugify(body.slug ?? product.name, product.id);
            slug = await uniqueProductSlug(base, async (candidate) => {
                if (candidate === product.slug) return false;
                const clash = await prisma.product.findFirst({
                    where: { shop_id: shopId, slug: candidate, id: { not: product.id } },
                    select: { id: true },
                });
                return clash !== null;
            });
        }

        await prisma.$transaction(async (tx) => {
            await tx.product.update({
                where: { id: product.id },
                data: {
                    ...(slug !== product.slug && { slug }),
                    ...(body.description !== undefined && { description: body.description ?? null }),
                    ...(body.online_visible !== undefined && { online_visible: body.online_visible }),
                    ...(body.is_featured !== undefined && { is_featured: body.is_featured }),
                },
            });

            // The gallery is sent whole rather than patched image by image: the
            // editor lets the merchant reorder and remove freely, and diffing
            // that client-side would be a lot of ceremony for a list of ≤8 URLs.
            if (body.images !== undefined) {
                await tx.productImage.deleteMany({ where: { product_id: product.id } });
                if (body.images.length > 0) {
                    await tx.productImage.createMany({
                        data: body.images.map((img, index) => ({
                            product_id: product.id,
                            url: img.url,
                            alt: img.alt ?? null,
                            position: index,
                        })),
                    });
                }
            }
        });

        return sendSuccess(c, { slug }, "Product updated successfully");
    },

    /** Online pricing for one variant. Never touches what the POS charges. */
    async updateStoreVariant(c: Context) {
        const shopId = c.get("shopId") as string;
        const body = c.get("validatedBody") as UpdateStoreVariant;

        const variant = await prisma.productVariant.findFirst({
            where: { id: body.id, product: { shop_id: shopId } },
            select: { id: true, last_sell_price: true, online_price: true },
        });
        if (!variant) return sendError(c, "Variant not found", "NOT_FOUND", 404);

        // Reject a "discount" that is not one, rather than storing it and
        // silently ignoring it at render time — the merchant should be told.
        const regular =
            body.online_price !== undefined && body.online_price !== null
                ? body.online_price
                : variant.online_price !== null
                  ? Number(variant.online_price)
                  : variant.last_sell_price !== null
                    ? Number(variant.last_sell_price)
                    : null;

        if (
            body.online_sale_price !== undefined &&
            body.online_sale_price !== null &&
            regular !== null &&
            body.online_sale_price >= regular
        ) {
            return sendError(
                c,
                `The discount price must be below the regular price (৳${regular}).`,
                "INVALID_PRICE",
                422,
            );
        }

        await prisma.productVariant.update({
            where: { id: variant.id },
            data: {
                ...(body.online_price !== undefined && {
                    online_price:
                        body.online_price === null ? null : new Decimal(body.online_price),
                }),
                ...(body.online_sale_price !== undefined && {
                    online_sale_price:
                        body.online_sale_price === null
                            ? null
                            : new Decimal(body.online_sale_price),
                }),
            },
        });

        return sendSuccess(c, {}, "Pricing updated successfully");
    },
};
