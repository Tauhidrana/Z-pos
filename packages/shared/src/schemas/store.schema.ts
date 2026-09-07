import { z } from "zod";
import { zodUUID } from "./helper";
import { imageRefSchema } from "./media.schema";

/**
 * Slugs the storefront resolver can never hand to a merchant, because they are
 * either already routes on the main application or hostnames a platform is
 * expected to own. Checked on the server; the dashboard checks the same list so
 * the user finds out while typing rather than on submit.
 */
export const RESERVED_STORE_SLUGS = new Set([
    "www", "api", "app", "admin", "dashboard", "store", "stores", "shop", "shops",
    "login", "signup", "signin", "auth", "account", "accounts", "billing",
    "help", "support", "docs", "blog", "status", "mail", "email", "smtp",
    "static", "assets", "cdn", "img", "images", "media", "files", "download",
    "test", "dev", "staging", "preview", "demo", "internal", "system",
    "zpos", "pos", "checkout", "cart", "order", "orders", "product", "products",
    "vercel", "ftp", "ns", "ns1", "ns2", "mx", "webmail", "root", "null",
]);

/**
 * A slug is a hostname label, so it obeys hostname rules: lowercase letters,
 * digits and inner hyphens only, 3–32 characters. Anything else either fails
 * DNS or produces a URL that cannot be typed reliably from a phone.
 */
export const storeSlugSchema = z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "At least 3 characters")
    .max(32, "At most 32 characters")
    .regex(
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
        "Use lowercase letters, numbers and hyphens; must start and end with a letter or number",
    )
    .refine((s) => !s.includes("--"), "Cannot contain two hyphens in a row")
    .refine((s) => !RESERVED_STORE_SLUGS.has(s), "This address is reserved");

/** Empty string means "clear this field", which is different from omitting it. */
const optionalText = (max: number) =>
    z.preprocess(
        (v) => (typeof v === "string" && v.trim() === "" ? null : v),
        z.string().trim().max(max).nullable().optional(),
    );

/**
 * An image slot: an uploaded reference (`media:<id>`), or null to clear it.
 * Absolute URLs still parse so rows written before uploads existed can be saved
 * back unchanged, but nothing in the UI produces one any more.
 */
const optionalImage = z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    imageRefSchema.nullable().optional(),
);

/** A link out to somewhere else on the web — a Facebook page, say. */
const optionalUrl = z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z
        .string()
        .trim()
        .max(2048)
        .refine(
            (v) => /^https?:\/\/\S+$/i.test(v),
            "Must be a full URL starting with http:// or https://",
        )
        .nullable()
        .optional(),
);

const money = (max: number) =>
    z.preprocess(
        (v) => (v === "" || v === null || v === undefined ? undefined : Number(v)),
        z
            .number()
            .min(0, "Cannot be negative")
            .max(max, `Cannot exceed ${max}`)
            .refine((v) => Number(v.toFixed(2)) === v, "Maximum 2 decimal places"),
    );

/**
 * A nullable money field on a PATCH body, where the three input states are
 * genuinely different: absent means "leave it alone", null or "" means "clear
 * it", and a number means "set it".
 *
 * Collapsing `undefined` to `null` here — which is what the obvious one-liner
 * does — made an omitted field an instruction to erase: saving a variant's
 * regular price would silently wipe its discount.
 */
const optionalMoney = z.preprocess(
    (v) => (v === undefined ? undefined : v === "" || v === null ? null : Number(v)),
    z
        .number()
        .min(0, "Cannot be negative")
        .max(1_000_000, "Too large")
        .refine((v) => Number(v.toFixed(2)) === v, "Maximum 2 decimal places")
        .nullable()
        .optional(),
);

export const createStoreSchema = z.object({
    name: z.string().trim().min(2, "Store name is required").max(80),
    slug: storeSlugSchema,
    description: optionalText(1000),
    logo_url: optionalImage,
    banner_url: optionalImage,
    phone: optionalText(20),
    email: optionalText(120),
    address: optionalText(300),
});

export type CreateStore = z.infer<typeof createStoreSchema>;

/** Long-form policy text rendered as its own storefront page. */
const optionalLongText = (max: number) =>
    z.preprocess(
        (v) => (typeof v === "string" && v.trim() === "" ? null : v),
        z.string().trim().max(max).nullable().optional(),
    );

/**
 * A latitude or longitude, or null to clear the pin.
 *
 * Range-checked rather than merely numeric: a transposed pair (lat 90.4, lng
 * 23.8 — Dhaka's coordinates the wrong way round) is the single most common way
 * a map pin ends up in the Arctic, and it is cheap to refuse here.
 */
const optionalCoordinate = (limit: number, label: string) =>
    z.preprocess(
        (v) => (v === "" || v === null || v === undefined ? (v === undefined ? undefined : null) : Number(v)),
        z
            .number()
            .min(-limit, `${label} is out of range`)
            .max(limit, `${label} is out of range`)
            .nullable()
            .optional(),
    );

export const updateStoreSchema = z.object({
    name: z.string().trim().min(2, "Store name is required").max(80).optional(),
    slug: storeSlugSchema.optional(),
    description: optionalText(1000),
    logo_url: optionalImage,
    banner_url: optionalImage,
    favicon_url: optionalImage,
    phone: optionalText(20),
    email: optionalText(120),
    address: optionalText(300),
    facebook_url: optionalUrl,
    instagram_url: optionalUrl,
    whatsapp_number: optionalText(20),

    // ── Business location ────────────────────────────────────────────────────
    latitude: optionalCoordinate(90, "Latitude"),
    longitude: optionalCoordinate(180, "Longitude"),

    // ── Published policy pages ───────────────────────────────────────────────
    delivery_info: optionalLongText(4000),
    return_policy: optionalLongText(8000),
    terms: optionalLongText(20_000),
    privacy_policy: optionalLongText(20_000),
    opening_hours: optionalText(200),

    // ── SEO ──────────────────────────────────────────────────────────────────
    meta_title: optionalText(70),
    meta_description: optionalText(180),

    delivery_charge: money(10_000).optional(),
    free_delivery_over: optionalMoney,
    min_order_amount: money(1_000_000).optional(),
    theme_color: z
        .string()
        .trim()
        .regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #a8431d")
        .optional(),
    is_active: z.boolean().optional(),
});

export type UpdateStore = z.infer<typeof updateStoreSchema>;

/** Product-level storefront settings, edited from the dashboard. */
export const updateStoreProductSchema = z.object({
    id: zodUUID,
    slug: z
        .string()
        .trim()
        .toLowerCase()
        .min(1, "Address is required")
        .max(80)
        .regex(
            /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
            "Use lowercase letters, numbers and hyphens",
        )
        .optional(),
    description: optionalText(4000),
    online_visible: z.boolean().optional(),
    is_featured: z.boolean().optional(),
    /** Replaces the gallery wholesale — order in the array is display order. */
    images: z
        .array(
            z.object({
                url: imageRefSchema,
                alt: z.string().trim().max(200).optional(),
            }),
        )
        .max(8, "Up to 8 images")
        .optional(),
});

export type UpdateStoreProduct = z.infer<typeof updateStoreProductSchema>;

/** Per-variant online pricing. Both nulls fall the variant back to shelf price. */
export const updateStoreVariantSchema = z.object({
    id: zodUUID,
    online_price: optionalMoney,
    online_sale_price: optionalMoney,
});

export type UpdateStoreVariant = z.infer<typeof updateStoreVariantSchema>;


// ─────────────────────────────────────────────────────────────────────────────
// Storefront banners
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How many slides a hero carousel can hold.
 *
 * Not an arbitrary limit: past about five, shoppers stop swiping and the extra
 * artwork is weight nobody sees. Enforced server-side, and surfaced in the
 * dashboard so the merchant is told before they upload rather than after.
 */
export const MAX_STORE_BANNERS = 5;

/**
 * The aspect ratio banner artwork is composed for, and the minimum width that
 * still looks sharp on a desktop hero.
 *
 * Exported so the upload UI can check a chosen file and warn before it is
 * saved. A portrait photograph dropped into a 3:1 slot is the fastest way for a
 * merchant to wreck their own homepage, and the fix — telling them at the
 * moment they pick the file — costs nothing.
 */
export const BANNER_ASPECT_RATIO = 3 / 1;
export const BANNER_MIN_WIDTH = 1200;
/** How far from 3:1 an image may stray before it is worth warning about. */
export const BANNER_ASPECT_TOLERANCE = 0.45;

/**
 * Where a banner's button leads.
 *
 * Either a storefront-relative path or an absolute http(s) URL, and nothing
 * else. The explicit rejection matters: a banner link is merchant-supplied text
 * rendered into an `href`, so `javascript:` and `data:` URLs would otherwise be
 * a stored-XSS hole on every shopper's homepage.
 */
export const bannerLinkSchema = z
    .string()
    .trim()
    .max(2048)
    .refine(
        (v) => /^\/[^\s]*$/.test(v) || /^https?:\/\/\S+$/i.test(v),
        "Use a shop path like /category/shoes, or a full https:// link",
    );

const optionalBannerLink = z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    bannerLinkSchema.nullable().optional(),
);

export const createBannerSchema = z.object({
    image_url: imageRefSchema,
    title: optionalText(80),
    subtitle: optionalText(160),
    button_text: optionalText(30),
    button_link: optionalBannerLink,
    is_active: z.boolean().optional(),
});

export type CreateBanner = z.infer<typeof createBannerSchema>;

export const updateBannerSchema = createBannerSchema.partial().extend({
    id: zodUUID,
});

export type UpdateBanner = z.infer<typeof updateBannerSchema>;

/** The full ordering, sent as one list — see the controller for why. */
export const reorderBannersSchema = z.object({
    ids: z.array(zodUUID).min(1, "Nothing to reorder").max(MAX_STORE_BANNERS),
});

export type ReorderBanners = z.infer<typeof reorderBannersSchema>;
