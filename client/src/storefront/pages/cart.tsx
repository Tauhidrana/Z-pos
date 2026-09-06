import { Link } from "wouter";
import { ShoppingBag, Trash2 } from "lucide-react";
import type { StorePublic } from "@myapp/shared";
import { Button } from "@/components/ui/button";
import { useCart } from "../lib/cart";
import { formatCurrencyInBDT } from "@/lib/utils";
import { EmptyState, ProductImage, QuantityStepper } from "../components/primitives";
import { useStoreSeo } from "../lib/seo";

/**
 * The cart.
 *
 * Every figure shown here is provisional and says so at checkout: the server
 * re-prices the whole order from the merchant's catalog when it is placed, so
 * a cart left open overnight cannot buy at yesterday's price. What this page
 * owes the shopper is an accurate *preview* — including the delivery charge and
 * the free-delivery threshold, so the total is not a surprise on the next step.
 */
export default function CartPage({ store }: { store: StorePublic }) {
    const cart = useCart();

    useStoreSeo({
        title: `Cart — ${store.name}`,
        description: `Your cart at ${store.name}.`,
        favicon: store.faviconUrl ?? store.logoUrl,
    });

    if (cart.lines.length === 0) {
        return (
            <div className="mx-auto w-full max-w-3xl px-4 py-6">
                <h1 className="mb-2 font-serif text-xl font-semibold sm:text-2xl">Your cart</h1>
                <EmptyState
                    icon={ShoppingBag}
                    title="Your cart is empty"
                    description="Browse the shop and add something you like."
                    action={
                        <Link href="/shop">
                            <Button>Start shopping</Button>
                        </Link>
                    }
                />
            </div>
        );
    }

    const freeDelivery =
        store.freeDeliveryOver != null && cart.subtotal >= store.freeDeliveryOver;
    const deliveryCharge = freeDelivery ? 0 : store.deliveryCharge;
    const total = cart.subtotal + deliveryCharge;
    const belowMinimum = store.minOrderAmount > 0 && cart.subtotal < store.minOrderAmount;
    const shortfall = store.minOrderAmount - cart.subtotal;

    return (
        <div className="mx-auto w-full max-w-3xl px-4 py-5 sm:py-7">
            <div className="mb-4 flex items-center justify-between gap-3">
                <h1 className="font-serif text-xl font-semibold sm:text-2xl">Your cart</h1>
                <button
                    type="button"
                    onClick={cart.clear}
                    className="text-sm text-muted-foreground transition-colors hover:text-destructive"
                >
                    Clear all
                </button>
            </div>

            <ul className="space-y-2.5">
                {cart.lines.map((line) => (
                    <li
                        key={line.variantId}
                        className="flex gap-3 rounded-xl border border-card-border bg-card p-3"
                    >
                        <Link href={`/product/${line.productSlug}`} className="w-20 shrink-0 sm:w-24">
                            <ProductImage
                                src={line.imageUrl}
                                alt={line.productName}
                                ratio="square"
                            />
                        </Link>

                        <div className="flex min-w-0 flex-1 flex-col">
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <Link
                                        href={`/product/${line.productSlug}`}
                                        className="line-clamp-2 text-sm font-medium leading-snug"
                                    >
                                        {line.productName}
                                    </Link>
                                    {line.variantName && (
                                        <p className="mt-0.5 text-xs text-muted-foreground">
                                            {line.variantName}
                                        </p>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    onClick={() => cart.remove(line.variantId)}
                                    aria-label={`Remove ${line.productName}`}
                                    className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-destructive"
                                >
                                    <Trash2 className="h-4 w-4" />
                                </button>
                            </div>

                            <div className="mt-auto flex items-end justify-between gap-2 pt-2.5">
                                <QuantityStepper
                                    size="sm"
                                    value={line.quantity}
                                    max={line.maxQuantity || 99}
                                    onChange={(next) => cart.setQuantity(line.variantId, next)}
                                />
                                <div className="text-right">
                                    <p className="font-mono text-sm font-semibold tabular-nums">
                                        {formatCurrencyInBDT(line.unitPrice * line.quantity)}
                                    </p>
                                    {line.quantity > 1 && (
                                        <p className="font-mono text-[11px] text-muted-foreground">
                                            {formatCurrencyInBDT(line.unitPrice)} each
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>
                    </li>
                ))}
            </ul>

            <div className="mt-5 rounded-xl border border-card-border bg-card p-4">
                <dl className="space-y-2 text-sm">
                    <div className="flex justify-between">
                        <dt className="text-muted-foreground">Subtotal</dt>
                        <dd className="font-mono tabular-nums">
                            {formatCurrencyInBDT(cart.subtotal)}
                        </dd>
                    </div>
                    <div className="flex justify-between">
                        <dt className="text-muted-foreground">Delivery</dt>
                        <dd className="font-mono tabular-nums">
                            {freeDelivery ? (
                                <span className="text-success">Free</span>
                            ) : (
                                formatCurrencyInBDT(deliveryCharge)
                            )}
                        </dd>
                    </div>
                    <div className="flex justify-between border-t border-border pt-2.5 text-base font-semibold">
                        <dt>Total</dt>
                        <dd className="font-mono tabular-nums">{formatCurrencyInBDT(total)}</dd>
                    </div>
                </dl>

                {store.freeDeliveryOver != null && !freeDelivery && (
                    <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                        Add{" "}
                        <span className="font-mono font-medium text-foreground">
                            {formatCurrencyInBDT(store.freeDeliveryOver - cart.subtotal)}
                        </span>{" "}
                        more for free delivery.
                    </p>
                )}

                {belowMinimum && (
                    <p className="mt-3 rounded-lg bg-warning/12 px-3 py-2 text-xs text-warning">
                        Minimum order is{" "}
                        <span className="font-mono font-medium">
                            {formatCurrencyInBDT(store.minOrderAmount)}
                        </span>
                        . Add{" "}
                        <span className="font-mono font-medium">
                            {formatCurrencyInBDT(shortfall)}
                        </span>{" "}
                        more to check out.
                    </p>
                )}

                <Link href="/checkout">
                    <Button className="mt-4 h-11 w-full" disabled={belowMinimum}>
                        Continue to checkout
                    </Button>
                </Link>
                <Link href="/shop">
                    <Button variant="ghost" className="mt-1.5 w-full">
                        Keep shopping
                    </Button>
                </Link>
            </div>
        </div>
    );
}
