import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { Check, ChevronLeft, PackageX, ShieldCheck, Truck } from "lucide-react";
import { toast } from "sonner";
import type {
    StorePublic,
    StoreProductCard,
    StoreProductDetail,
    StoreVariant,
} from "@myapp/shared";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatCurrencyInBDT } from "@/lib/utils";
import { useStoreQuery } from "../lib/api";
import { useCart } from "../lib/cart";
import {
    DiscountBadge,
    EmptyState,
    Pill,
    Price,
    ProductImage,
    QuantityStepper,
    SectionHeading,
} from "../components/primitives";
import { ProductCard, ProductGrid } from "../components/product-card";
import { ErrorPanel } from "../components/states";
import { useStoreSeo } from "../lib/seo";

type Response = { product: StoreProductDetail; related: StoreProductCard[] };

export default function ProductPage({
    slug,
    store,
    productSlug,
}: {
    slug: string;
    store: StorePublic;
    productSlug: string;
}) {
    const [, navigate] = useLocation();
    const cart = useCart();

    const { data, isLoading, error, refetch } = useStoreQuery<Response>(
        `/storefront/${slug}/products/${encodeURIComponent(productSlug)}`,
        ["storefront", slug, "product", productSlug],
    );

    const product = data?.product;

    // Default to the first variant that can actually be bought — landing on a
    // sold-out option when another size is in stock reads as "unavailable".
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [quantity, setQuantity] = useState(1);
    const [activeImage, setActiveImage] = useState(0);

    const selected: StoreVariant | undefined = useMemo(() => {
        if (!product?.variants.length) return undefined;
        if (selectedId) {
            const match = product.variants.find((v) => v.id === selectedId);
            if (match) return match;
        }
        return product.variants.find((v) => v.inStock) ?? product.variants[0];
    }, [product, selectedId]);

    useStoreSeo(
        product
            ? {
                  title: `${product.name} — ${store.name}`,
                  description:
                      product.description?.slice(0, 200) ??
                      `Buy ${product.name} from ${store.name}. Cash on delivery across Bangladesh.`,
                  image: product.images[0]?.url ?? store.logoUrl,
                  favicon: store.faviconUrl ?? store.logoUrl,
                  type: "product",
                  jsonLd: {
                      "@context": "https://schema.org",
                      "@type": "Product",
                      name: product.name,
                      description: product.description ?? undefined,
                      image: product.images.map((img) => img.url),
                      brand: product.brand ? { "@type": "Brand", name: product.brand } : undefined,
                      category: product.categoryName,
                      offers: {
                          "@type": "Offer",
                          price: product.price,
                          priceCurrency: "BDT",
                          availability: product.inStock
                              ? "https://schema.org/InStock"
                              : "https://schema.org/OutOfStock",
                          url: window.location.href,
                      },
                  },
              }
            : null,
    );

    if (error) {
        return (
            <div className="mx-auto w-full max-w-6xl px-4 py-8">
                {error.status === 404 ? (
                    <EmptyState
                        icon={PackageX}
                        title="Product not available"
                        description="This item has been removed or is no longer for sale."
                        action={
                            <Link href="/shop">
                                <Button>Browse the shop</Button>
                            </Link>
                        }
                    />
                ) : (
                    <ErrorPanel error={error} onRetry={() => void refetch()} />
                )}
            </div>
        );
    }

    if (isLoading || !product || !selected) return <ProductSkeleton />;

    const images = product.images.length > 0 ? product.images : [{ url: "", alt: null }];
    const canBuy = selected.inStock && selected.stock > 0;
    const maxQuantity = Math.max(1, selected.stock);
    const inCart = cart.quantityOf(selected.id);
    // The stepper stops at what is left after what is already in the cart, so
    // a shopper cannot assemble an impossible order one tap at a time.
    const remaining = Math.max(0, maxQuantity - inCart);

    const addToCart = () => {
        if (!canBuy) return;
        if (remaining <= 0) {
            toast.error(`You already have all ${maxQuantity} available in your cart.`);
            return;
        }
        cart.add(
            {
                variantId: selected.id,
                productId: product.id,
                productSlug: product.slug,
                productName: product.name,
                variantName: selected.name,
                imageUrl: product.images[0]?.url ?? null,
                unitPrice: selected.price,
                maxQuantity,
            },
            Math.min(quantity, remaining),
        );
        toast.success(`${product.name} added to your cart`);
    };

    const buyNow = () => {
        addToCart();
        navigate("/checkout");
    };

    return (
        <div className="mx-auto w-full max-w-6xl px-4 py-4 sm:py-7">
            <button
                type="button"
                onClick={() => window.history.back()}
                className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground sm:mb-5"
            >
                <ChevronLeft className="h-4 w-4" />
                Back
            </button>

            <div className="grid gap-6 lg:grid-cols-2 lg:gap-10">
                {/* Gallery */}
                <div>
                    <ProductImage
                        src={images[activeImage]?.url || null}
                        alt={images[activeImage]?.alt ?? product.name}
                        ratio="square"
                        priority
                        sizes="(max-width: 1024px) 100vw, 500px"
                        className="border border-card-border"
                    />
                    {images.length > 1 && (
                        <div className="mt-2.5 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                            {images.map((image, index) => (
                                <button
                                    key={`${image.url}-${index}`}
                                    type="button"
                                    onClick={() => setActiveImage(index)}
                                    aria-label={`View image ${index + 1}`}
                                    aria-current={index === activeImage}
                                    className={cn(
                                        "w-16 shrink-0 overflow-hidden rounded-lg border-2 transition-colors sm:w-20",
                                        index === activeImage
                                            ? "border-primary"
                                            : "border-transparent",
                                    )}
                                >
                                    <ProductImage
                                        src={image.url}
                                        alt=""
                                        ratio="square"
                                        className="rounded-md"
                                    />
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Details */}
                <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                        {product.categoryName}
                        {product.brand ? ` · ${product.brand}` : ""}
                    </p>
                    <h1 className="mt-1.5 font-serif text-xl font-semibold leading-tight sm:text-3xl">
                        {product.name}
                    </h1>

                    <div className="mt-3 flex flex-wrap items-center gap-2.5">
                        <Price
                            price={selected.price}
                            compareAtPrice={selected.compareAtPrice}
                            size="lg"
                        />
                        {selected.compareAtPrice != null &&
                            selected.compareAtPrice > selected.price && (
                                <DiscountBadge
                                    percent={Math.round(
                                        ((selected.compareAtPrice - selected.price) /
                                            selected.compareAtPrice) *
                                            100,
                                    )}
                                />
                            )}
                    </div>

                    <div className="mt-3">
                        {canBuy ? (
                            selected.stock <= 5 ? (
                                <Pill tone="warning">Only {selected.stock} left</Pill>
                            ) : (
                                <Pill tone="success">
                                    <Check className="mr-1 h-3 w-3" />
                                    In stock
                                </Pill>
                            )
                        ) : (
                            <Pill tone="danger">Out of stock</Pill>
                        )}
                    </div>

                    {product.variants.length > 1 && (
                        <div className="mt-6">
                            <p className="mb-2 text-sm font-medium">
                                Options
                                <span className="ml-1.5 font-normal text-muted-foreground">
                                    ({product.variants.length})
                                </span>
                            </p>
                            <div className="flex flex-wrap gap-2">
                                {product.variants.map((variant) => (
                                    <button
                                        key={variant.id}
                                        type="button"
                                        onClick={() => {
                                            setSelectedId(variant.id);
                                            setQuantity(1);
                                        }}
                                        disabled={!variant.inStock}
                                        className={cn(
                                            "min-h-11 rounded-lg border px-3.5 text-sm transition-colors",
                                            variant.id === selected.id
                                                ? "border-primary bg-primary/10 font-medium text-primary"
                                                : "border-border text-foreground",
                                            !variant.inStock &&
                                                "cursor-not-allowed text-muted-foreground line-through opacity-60",
                                        )}
                                    >
                                        {variant.name ?? "Standard"}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Buy box. On a phone the primary action is pinned to the
                        bottom of the viewport instead — see below. */}
                    <div className="mt-6 hidden items-center gap-3 sm:flex">
                        <QuantityStepper
                            value={quantity}
                            onChange={setQuantity}
                            max={Math.max(1, remaining)}
                            disabled={!canBuy || remaining === 0}
                        />
                        <Button
                            onClick={addToCart}
                            disabled={!canBuy || remaining === 0}
                            className="flex-1"
                        >
                            Add to cart
                        </Button>
                        <Button
                            onClick={buyNow}
                            variant="secondary"
                            disabled={!canBuy || remaining === 0}
                            className="flex-1"
                        >
                            Buy now
                        </Button>
                    </div>

                    {inCart > 0 && (
                        <p className="mt-2.5 hidden text-xs text-muted-foreground sm:block">
                            {inCart} already in your cart.{" "}
                            <Link href="/cart" className="text-primary underline-offset-2 hover:underline">
                                View cart
                            </Link>
                        </p>
                    )}

                    <div className="mt-6 space-y-2.5 rounded-xl border border-border bg-card p-4">
                        <div className="flex items-start gap-2.5 text-sm">
                            <Truck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                            <span className="text-muted-foreground">
                                {store.freeDeliveryOver != null ? (
                                    <>
                                        Delivery{" "}
                                        <span className="font-mono">
                                            {formatCurrencyInBDT(store.deliveryCharge)}
                                        </span>
                                        , free over{" "}
                                        <span className="font-mono">
                                            {formatCurrencyInBDT(store.freeDeliveryOver)}
                                        </span>
                                    </>
                                ) : (
                                    <>
                                        Delivery{" "}
                                        <span className="font-mono">
                                            {formatCurrencyInBDT(store.deliveryCharge)}
                                        </span>{" "}
                                        anywhere in Bangladesh
                                    </>
                                )}
                            </span>
                        </div>
                        <div className="flex items-start gap-2.5 text-sm">
                            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                            <span className="text-muted-foreground">
                                Cash on delivery — pay when it arrives
                            </span>
                        </div>
                    </div>

                    {product.description && (
                        <div className="mt-6">
                            <h2 className="mb-2 font-serif text-base font-semibold">
                                Description
                            </h2>
                            <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                                {product.description}
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {data.related.length > 0 && (
                <section className="mt-12">
                    <SectionHeading title="You may also like" />
                    <ProductGrid>
                        {data.related.map((related) => (
                            <ProductCard
                                key={related.id}
                                product={related}
                                href={`/product/${related.slug}`}
                            />
                        ))}
                    </ProductGrid>
                </section>
            )}

            {/* Sticky mobile buy bar — the single most-tapped control on the
                page, kept in thumb reach rather than scrolled off. */}
            <div className="fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-30 border-t border-border bg-card px-4 py-2.5 sm:hidden">
                <div className="flex items-center gap-2.5">
                    <QuantityStepper
                        value={quantity}
                        onChange={setQuantity}
                        max={Math.max(1, remaining)}
                        disabled={!canBuy || remaining === 0}
                    />
                    <Button
                        onClick={addToCart}
                        disabled={!canBuy || remaining === 0}
                        className="h-11 flex-1"
                    >
                        {canBuy ? "Add to cart" : "Out of stock"}
                    </Button>
                    <Button
                        onClick={buyNow}
                        variant="secondary"
                        disabled={!canBuy || remaining === 0}
                        className="h-11 shrink-0 px-4"
                    >
                        Buy
                    </Button>
                </div>
            </div>
        </div>
    );
}

function ProductSkeleton() {
    return (
        <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-6 lg:grid-cols-2 lg:gap-10">
            <Skeleton className="aspect-square w-full rounded-xl" />
            <div className="space-y-3">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-7 w-3/4" />
                <Skeleton className="h-8 w-32" />
                <Skeleton className="h-5 w-20" />
                <div className="pt-4">
                    <Skeleton className="h-11 w-full" />
                </div>
                <Skeleton className="h-28 w-full rounded-xl" />
            </div>
        </div>
    );
}
