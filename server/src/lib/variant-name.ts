/**
 * The display label for a variant, derived from its attributes.
 *
 * One function because there are three places that create or rename a variant —
 * creating a product, adding a variant to an existing one, and editing one —
 * and each had grown its own version. They disagreed, visibly:
 *
 *   - creation built `[size, color].join(" - ")`, correctly leaving a plain
 *     product with neither attribute unnamed;
 *   - editing built `"${color} / ${size}"` unconditionally, so a variant with
 *     only a colour was renamed to `"RED / "` — trailing separator included;
 *   - adding a variant substituted the *product name* for a missing attribute,
 *     turning a red shirt into `"RED / Shirt"`.
 *
 * `ProductVariant.name` is nullable precisely so a single-variant product like
 * "Miniket Rice 5kg" carries no label at all, and the POS shows the product
 * name alone rather than an empty separator.
 */
export function variantLabel(
    color: string | null | undefined,
    size: string | null | undefined,
): string | null {
    const c = color?.trim() || null;
    const s = size?.trim() || null;

    // Size first, matching how these read on a shelf ticket: "L - Blue".
    return [s, c].filter(Boolean).join(" - ") || null;
}
