import { z } from "zod";
import { imageRefSchema } from "./media.schema";

/**
 * Category artwork is composed for a square tile — that is how the storefront's
 * category rail and grid render it, on both form factors. Exported so the
 * upload UI can warn about a wildly non-square image before it is saved rather
 * than after it has been cropped into something unrecognisable.
 */
export const CATEGORY_IMAGE_ASPECT_RATIO = 1;
export const CATEGORY_IMAGE_MIN_WIDTH = 400;
export const CATEGORY_IMAGE_ASPECT_TOLERANCE = 0.35;

/** Empty string means "clear this field", which is different from omitting it. */
const optionalText = (max: number) =>
    z.preprocess(
        (v) => (typeof v === "string" && v.trim() === "" ? null : v),
        z.string().trim().max(max).nullable().optional(),
    );

const optionalImage = z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    imageRefSchema.nullable().optional(),
);

export const updateCategorySchema = z.object({
    id: z.string().min(1, "Category ID is required"),
    name: z.string().trim().min(1, "Category name is required").max(100).optional(),
    description: optionalText(255),
    /** Storefront tile artwork. Null clears it back to the typographic tile. */
    image_url: optionalImage,
    /** Ascending order in the storefront's category rail. */
    position: z.number().int().min(0).max(9999).optional(),
    is_active: z.boolean().optional(),
});

export type UpdateCategory = z.infer<typeof updateCategorySchema>;

export const categorySchema = z.object({
    name: z.string().trim().min(1, "Category name is required").max(100),
    description: optionalText(255),
    image_url: optionalImage,
    position: z.number().int().min(0).max(9999).optional(),
    parent_id: z.string().optional(),
});

export type CategoryFormValues = z.infer<typeof categorySchema>;

/**
 * Turn a category name into a URL segment.
 *
 * The old inline version was `name.toLowerCase().replace(/\s+/g, "-")`, which
 * left apostrophes, slashes and ampersands in the slug — "Men's / Women's"
 * became "men's-/-women's", a string that has to be escaped to appear in a URL
 * at all — and produced an empty slug for a purely non-Latin name like "পোশাক",
 * which then collided with every other such category on the shop's unique index.
 *
 * Non-Latin names are common here, so they get a stable fallback rather than a
 * failure: the caller appends a short discriminator when this returns "".
 */
export function categorySlug(name: string): string {
    return name
        .toLowerCase()
        .normalize("NFKD")
        // Strip combining marks left behind by the decomposition above, so
        // accented Latin folds to plain ASCII rather than to nothing.
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60)
        .replace(/-+$/, "");
}
