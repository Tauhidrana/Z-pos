import { Link } from "wouter";
import { ShoppingBag } from "lucide-react";
import type { StoreProductCard } from "@myapp/shared";
import { cn } from "@/lib/utils";
import { DiscountBadge, Pill, Price, ProductImage } from "./primitives";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The grid tile.
 *
 * Sized for a two-across phone layout first, which is where most of this
 * store's traffic will be: the image carries a fixed 4:5 ratio so rows never
 * reflow as pictures load, the name is clamped to two lines so tiles in a row
 * stay the same height, and the whole tile is one tap target rather than a card
 * with a small link inside it.
 */
export function ProductCard({
    product,
    href,
    priority = false,
}: {
    product: StoreProductCard;
    href: string;
    priority?: boolean;
}) {
    return (
        <Link
            href={href}
            className="group block rounded-xl border border-card-border bg-card transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
            <div className="relative p-2 pb-0">
                <ProductImage
                    src={product.imageUrl}
                    alt={product.name}
                    ratio="portrait"
                    priority={priority}
                    sizes="(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 220px"
                />

                <div className="absolute left-3.5 top-3.5 flex flex-col items-start gap-1">
                    {product.discountPercent != null && (
                        <DiscountBadge percent={product.discountPercent} />
                    )}
                    {product.isNew && product.discountPercent == null && (
                        <Pill tone="accent">New</Pill>
                    )}
                </div>

                {!product.inStock && (
                    // A scrim rather than a corner badge: a sold-out tile should
                    // read as unavailable at a glance, from arm's length.
                    <div className="absolute inset-2 bottom-0 flex items-center justify-center rounded-lg bg-background/70 backdrop-blur-[1px]">
                        <span className="rounded-md bg-foreground px-2.5 py-1 text-[11px] font-medium text-background">
                            Out of stock
                        </span>
                    </div>
                )}
            </div>

            <div className="space-y-1.5 p-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {product.categoryName}
                </p>
                <h3
                    className="line-clamp-2 text-sm font-medium leading-snug"
                    title={product.name}
                >
                    {product.name}
                </h3>
                <Price
                    price={product.price}
                    compareAtPrice={product.compareAtPrice}
                    size="sm"
                />
            </div>
        </Link>
    );
}

export function ProductCardSkeleton() {
    return (
        <div className="rounded-xl border border-card-border bg-card">
            <div className="p-2 pb-0">
                <Skeleton className="aspect-[4/5] w-full rounded-lg" />
            </div>
            <div className="space-y-2 p-3">
                <Skeleton className="h-2.5 w-12" />
                <Skeleton className="h-3.5 w-full" />
                <Skeleton className="h-3.5 w-2/3" />
                <Skeleton className="h-4 w-16" />
            </div>
        </div>
    );
}

/**
 * The one grid definition the whole storefront uses.
 *
 * Two columns on a phone is the point: one column wastes half the screen and
 * three makes the images too small to judge a product by.
 */
export function ProductGrid({
    children,
    className,
}: {
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <div
            className={cn(
                "grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5",
                className,
            )}
        >
            {children}
        </div>
    );
}

/**
 * A horizontally scrolling rail for the homepage.
 *
 * Snap points and an edge-to-edge scroll area, so it behaves like the app-store
 * carousels shoppers already know, and the last card is not clipped by the
 * page's own padding.
 */
export function ProductRail({
    products,
    hrefFor,
    isLoading,
}: {
    products: StoreProductCard[];
    hrefFor: (product: StoreProductCard) => string;
    isLoading?: boolean;
}) {
    if (isLoading) {
        return (
            <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
                {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="w-[46vw] shrink-0 sm:w-52">
                        <ProductCardSkeleton />
                    </div>
                ))}
            </div>
        );
    }

    return (
        <div
            className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:gap-4 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            role="list"
        >
            {products.map((product, index) => (
                <div
                    key={product.id}
                    role="listitem"
                    className="w-[46vw] shrink-0 snap-start sm:w-52"
                >
                    <ProductCard
                        product={product}
                        href={hrefFor(product)}
                        priority={index < 2}
                    />
                </div>
            ))}
        </div>
    );
}

export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
    return (
        <ProductGrid>
            {Array.from({ length: count }).map((_, i) => (
                <ProductCardSkeleton key={i} />
            ))}
        </ProductGrid>
    );
}

export { ShoppingBag };
