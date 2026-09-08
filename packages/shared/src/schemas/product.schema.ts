import { z } from "zod";
import { zodUUID } from "./helper";
import { imageRefSchema } from "./media.schema";


/**
 * The shelf price of one variant, in taka.
 *
 * Written once and shared by every route that sets a price — creating a
 * product, adding a variant to it later, and editing one — so the three cannot
 * drift into disagreeing about what a valid price is.
 */
export const sellPriceSchema = z
    .number()
    .min(0, "Price cannot be negative")
    .refine((v) => Number(v.toFixed(2)) === v, "Maximum 2 decimal places");

/** Opening stock for a variant that is being created. */
export const openingStockSchema = z
    .number()
    .int("Stock must be a whole number")
    .min(0, "Stock cannot be negative");

const productVariant = z.object({
    color: z.string().optional(),
    size: z.string().optional(),
    // A new product can arrive with stock already on the shelf. Keep this on
    // the variant because colour/size variants are counted independently.
    stock: openingStockSchema.default(0),
    // Opening stock with no price is stock that cannot be sold: the till has no
    // figure to ring up and the online store withholds the product rather than
    // quote it at zero. Optional, because a product entered before its pricing
    // is decided is legitimate — it just will not go on sale until a purchase
    // or this field gives it a price.
    sell_price: sellPriceSchema.optional(),
});

/** Trim to undefined so "  " never counts as a filled attribute. */
const attr = (v?: string) => {
    const t = v?.trim();
    return t ? t : undefined;
};

export const createProductSchema = z.object({
    name: z.string().min(1, "Product name is required"),
    description: z.string().optional(),
    reorder_level: z.number().optional(),
    brand: z.string().min(1, "Brand is required"),
    category_id: z.string().uuid("Please select a category"),
    variants: z.array(productVariant).min(1, "At least one variant is required"),
    /// Uploaded photographs, in display order. The first is the thumbnail every
    /// listing shows. Optional — a product can be entered at the counter now
    /// and photographed later.
    images: z.array(imageRefSchema).max(8, "Up to 8 photos").optional(),
}).superRefine((data, ctx) => {
    // A product with a single variant needs no colour or size — that is the
    // plain "base variant" case the data model already allows (ProductVariant
    // .name is nullable precisely for it), and it is how real stock like
    // "Miniket Rice 5kg" or "USB-C Fast Charger" is entered.
    //
    // Two or more variants must each carry something that tells them apart,
    // otherwise the product ends up with indistinguishable rows.
    if (data.variants.length < 2) return;

    const seen = new Map<string, number>();

    data.variants.forEach((v, i) => {
        const color = attr(v.color);
        const size = attr(v.size);

        if (!color && !size) {
            // Anchor the issue on a field that is actually rendered. The old
            // path ["color","size"] resolved to `variants.N.color.size`, which
            // no input owns, so react-hook-form blocked submit while showing
            // no message at all — the form simply did nothing when clicked.
            ctx.addIssue({
                code: "custom",
                message: "Add a colour or size to tell this variant apart",
                path: ["variants", i, "color"],
            });
            return;
        }

        const key = `${(color ?? "").toLowerCase()}|${(size ?? "").toLowerCase()}`;
        const first = seen.get(key);
        if (first !== undefined) {
            ctx.addIssue({
                code: "custom",
                message: "This variant duplicates an earlier one",
                path: ["variants", i, "color"],
            });
        } else {
            seen.set(key, i);
        }
    });
});


export const updateProductSchema = z.object({
    id: z.string().uuid(),
    name: z.string().optional(),
    description: z.string().optional(),
    reorder_level: z.number().optional(),
    category: z.string().uuid().optional(),
    brand: z.string().optional(),
})


export type CreateProduct = z.infer<typeof createProductSchema>
export type UpdateProduct = z.infer<typeof updateProductSchema>


export const updateProductVariantSchema = z.object({
    id: z.string().uuid(),
    color: z.string().optional(),
    size: z.string().optional(),
    /**
     * The shelf price. Null clears it, which marks the variant as not yet
     * priced — the till and the storefront both withhold it rather than sell at
     * zero, which is the honest reading of "no price has been decided".
     *
     * Omitting the field leaves the current price alone, so an edit that only
     * renames a colour cannot silently wipe the price.
     */
    sell_price: sellPriceSchema.nullable().optional(),
})

export type UpdateProductVariant = z.infer<typeof updateProductVariantSchema>

export const createProductVariantSchemaSepa = z.object({
    productId: zodUUID,
    color: z.string().optional(),
    size: z.string().optional(),
    /**
     * Opening stock and price, exactly as `createProductSchema` accepts them.
     * A variant added a week after the product is the same kind of thing as one
     * added with it; without these it arrives at zero stock and no price, and
     * the merchant has no screen anywhere that can give it either.
     */
    stock: openingStockSchema.optional(),
    sell_price: sellPriceSchema.optional(),
})

export type CreateProductVariantSepa = z.infer<typeof createProductVariantSchemaSepa>



export const productVariantSchema = z.object({
    color: z.string().optional(),
    size: z.string().optional(),
}).superRefine((data, ctx) => {
    if (!data.color && !data.size) {
        ctx.addIssue({
            code: "custom",
            message: "Color or size is required",
            // Single-segment path: ["color","size"] resolved to `color.size`,
            // which no input owns, so the message never rendered.
            path: ["color"],
        });
    }
});

export type CreateProductVariant = z.infer<typeof productVariantSchema>


/**
 * Body for issuing (or re-resolving) a variant's printable barcode.
 * Kept separate from `idBodySchema` so the field name matches what the label
 * generator actually sends, rather than an ambiguous bare `id`.
 *
 * `code` links a barcode the merchant did not print — the manufacturer's own,
 * scanned off the carton — instead of minting a new one. It is deliberately not
 * constrained to EAN-13: a supplier's Code-128 is a real label that has to ring
 * up at the till like any other. The server normalizes and range-checks it.
 */
export const issueBarcodeSchema = z.object({
    variantId: zodUUID,
    code: z.string().trim().min(4).max(48).optional(),
});

export type IssueBarcode = z.infer<typeof issueBarcodeSchema>;
