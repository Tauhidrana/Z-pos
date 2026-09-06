/**
 * Shared storefront helpers: slugs, and the one place that decides what a
 * product costs online.
 */

import { Decimal } from "generated/prisma/runtime/client";

/**
 * Turn arbitrary text into a URL segment. Falls back to a fragment of the id
 * when the name has no ASCII to work with — a Bangla-only product name would
 * otherwise slugify to the empty string and leave the row unroutable.
 */
export function slugify(input: string, fallbackId?: string): string {
    const slug = input
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80)
        .replace(/-+$/g, "");

    if (slug) return slug;
    return fallbackId ? `product-${fallbackId.slice(0, 8)}` : "item";
}

/**
 * Find a slug free within `shopId`, appending -2, -3 … as needed.
 * `exists` is injected so this works both inside and outside a transaction.
 */
export async function uniqueProductSlug(
    base: string,
    exists: (slug: string) => Promise<boolean>,
): Promise<string> {
    if (!(await exists(base))) return base;
    for (let n = 2; n < 200; n++) {
        const candidate = `${base}-${n}`;
        if (!(await exists(candidate))) return candidate;
    }
    // Practically unreachable; a random tail is still better than a collision.
    return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Pricing ──────────────────────────────────────────────────────────────────

/** The subset of a variant row the price rules need. */
export type PriceableVariant = {
    last_sell_price: Decimal | null;
    online_price: Decimal | null;
    online_sale_price: Decimal | null;
};

export type ResolvedPrice = {
    /** What the customer pays. Null means the variant is not sellable online. */
    price: number | null;
    /** Struck-through original. Null when the variant is not discounted. */
    compareAtPrice: number | null;
};

/**
 * Decide a variant's online price.
 *
 * The regular price is the merchant's `online_price` override, or else the sell
 * price of the variant's most recent purchase — the shelf price. A sale price
 * only counts when it is positive and genuinely below the regular price, so a
 * mistyped "discount" that is higher can never quietly raise what a customer is
 * charged, and never renders as a fake strikethrough.
 *
 * A variant with neither an override nor a purchase behind it has no price at
 * all. Those are withheld from the storefront rather than shown at zero.
 */
export function resolvePrice(variant: PriceableVariant): ResolvedPrice {
    const regular = variant.online_price ?? variant.last_sell_price;
    if (regular === null || regular === undefined) {
        return { price: null, compareAtPrice: null };
    }

    const regularNum = Number(regular);
    if (!Number.isFinite(regularNum) || regularNum <= 0) {
        return { price: null, compareAtPrice: null };
    }

    const saleNum =
        variant.online_sale_price === null || variant.online_sale_price === undefined
            ? null
            : Number(variant.online_sale_price);

    if (saleNum !== null && Number.isFinite(saleNum) && saleNum > 0 && saleNum < regularNum) {
        return { price: round2(saleNum), compareAtPrice: round2(regularNum) };
    }

    return { price: round2(regularNum), compareAtPrice: null };
}

export function round2(n: number): number {
    return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function discountPercent(price: number, compareAt: number | null): number | null {
    if (!compareAt || compareAt <= price) return null;
    return Math.round(((compareAt - price) / compareAt) * 100);
}

/**
 * Pick the variant a product card should advertise: the cheapest one that is
 * both priced and in stock, falling back to the cheapest priced variant when
 * everything is sold out (so the card can still show a price beside its
 * "Out of stock" badge rather than a blank).
 */
export function pickDisplayVariant<
    T extends PriceableVariant & { stock_on_hand: number; is_active: boolean },
>(variants: T[]): { variant: T; price: number; compareAtPrice: number | null } | null {
    let best: { variant: T; price: number; compareAtPrice: number | null } | null = null;
    let bestOutOfStock: { variant: T; price: number; compareAtPrice: number | null } | null =
        null;

    for (const variant of variants) {
        if (!variant.is_active) continue;
        const { price, compareAtPrice } = resolvePrice(variant);
        if (price === null) continue;

        const candidate = { variant, price, compareAtPrice };
        if (variant.stock_on_hand > 0) {
            if (!best || price < best.price) best = candidate;
        } else if (!bestOutOfStock || price < bestOutOfStock.price) {
            bestOutOfStock = candidate;
        }
    }

    return best ?? bestOutOfStock;
}

/** A product counts as "new" for its first 30 days in the catalog. */
const NEW_PRODUCT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export function isNewProduct(createdAt: Date): boolean {
    return Date.now() - createdAt.getTime() < NEW_PRODUCT_WINDOW_MS;
}
