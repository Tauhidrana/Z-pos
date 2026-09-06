/**
 * The shopper's cart.
 *
 * Held in localStorage under a key that includes the store slug, so two
 * storefronts open in the same browser never see each other's carts — which
 * matters more than it sounds: on the path form (`/s/tds`, `/s/abc`) both
 * stores share one origin and therefore one localStorage.
 *
 * What is stored is deliberately thin — a variant id, a quantity and enough
 * text to render a row offline. Prices here are for display only; the server
 * re-prices everything at checkout from the merchant's own catalog, so a cart
 * that has been sitting open since yesterday cannot buy at yesterday's price.
 */

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from "react";

export type CartLine = {
    variantId: string;
    productId: string;
    productSlug: string;
    productName: string;
    variantName: string | null;
    imageUrl: string | null;
    /** Display only — never trusted for money. */
    unitPrice: number;
    quantity: number;
    /** Stock at the time it was added, to keep the stepper honest offline. */
    maxQuantity: number;
};

const MAX_LINE_QUANTITY = 99;

function storageKey(slug: string) {
    return `zpos:cart:${slug}`;
}

function readCart(slug: string): CartLine[] {
    try {
        const raw = localStorage.getItem(storageKey(slug));
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];

        // Anything in localStorage is untrusted input — it survives deploys and
        // can be edited by hand. Drop rows that no longer fit the shape rather
        // than letting them crash a render.
        return parsed.filter((line): line is CartLine => {
            const l = line as Partial<CartLine>;
            return (
                typeof l?.variantId === "string" &&
                typeof l?.productName === "string" &&
                typeof l?.quantity === "number" &&
                Number.isFinite(l.quantity) &&
                l.quantity > 0
            );
        });
    } catch {
        // Private mode, cleared storage, quota errors — an unreadable cart is
        // an empty cart, never a broken page.
        return [];
    }
}

function writeCart(slug: string, lines: CartLine[]) {
    try {
        localStorage.setItem(storageKey(slug), JSON.stringify(lines));
    } catch {
        // Nothing useful to do: the cart still works for this page view.
    }
}

export type CartApi = {
    lines: CartLine[];
    itemCount: number;
    subtotal: number;
    add: (line: Omit<CartLine, "quantity">, quantity?: number) => void;
    setQuantity: (variantId: string, quantity: number) => void;
    remove: (variantId: string) => void;
    clear: () => void;
    quantityOf: (variantId: string) => number;
};

export const CartContext = createContext<CartApi | null>(null);

export function useCartState(slug: string): CartApi {
    // Read once, on mount. The slug cannot change under a mounted storefront —
    // `Root` keys the whole tree by it — so re-reading on every change would be
    // a state update chasing a value that never moves.
    const [lines, setLines] = useState<CartLine[]>(() => readCart(slug));

    useEffect(() => {
        writeCart(slug, lines);
    }, [slug, lines]);

    // Another tab on the same store is the same cart.
    useEffect(() => {
        const onStorage = (event: StorageEvent) => {
            if (event.key === storageKey(slug)) setLines(readCart(slug));
        };
        window.addEventListener("storage", onStorage);
        return () => window.removeEventListener("storage", onStorage);
    }, [slug]);

    const add = useCallback((line: Omit<CartLine, "quantity">, quantity = 1) => {
        setLines((current) => {
            const existing = current.find((l) => l.variantId === line.variantId);
            const ceiling = Math.min(line.maxQuantity || MAX_LINE_QUANTITY, MAX_LINE_QUANTITY);

            if (existing) {
                return current.map((l) =>
                    l.variantId === line.variantId
                        ? {
                              ...l,
                              ...line,
                              quantity: Math.min(l.quantity + quantity, ceiling),
                          }
                        : l,
                );
            }
            return [...current, { ...line, quantity: Math.min(quantity, ceiling) }];
        });
    }, []);

    const setQuantity = useCallback((variantId: string, quantity: number) => {
        setLines((current) =>
            quantity <= 0
                ? current.filter((l) => l.variantId !== variantId)
                : current.map((l) =>
                      l.variantId === variantId
                          ? {
                                ...l,
                                quantity: Math.min(
                                    quantity,
                                    Math.min(l.maxQuantity || MAX_LINE_QUANTITY, MAX_LINE_QUANTITY),
                                ),
                            }
                          : l,
                  ),
        );
    }, []);

    const remove = useCallback((variantId: string) => {
        setLines((current) => current.filter((l) => l.variantId !== variantId));
    }, []);

    const clear = useCallback(() => setLines([]), []);

    return useMemo(() => {
        const itemCount = lines.reduce((sum, l) => sum + l.quantity, 0);
        const subtotal = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
        return {
            lines,
            itemCount,
            subtotal: Math.round(subtotal * 100) / 100,
            add,
            setQuantity,
            remove,
            clear,
            quantityOf: (variantId: string) =>
                lines.find((l) => l.variantId === variantId)?.quantity ?? 0,
        };
    }, [lines, add, setQuantity, remove, clear]);
}

export function useCart(): CartApi {
    const cart = useContext(CartContext);
    if (!cart) throw new Error("useCart must be used inside the storefront's CartProvider");
    return cart;
}
