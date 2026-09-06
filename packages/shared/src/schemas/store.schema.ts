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
