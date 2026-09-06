import { Link } from "wouter";
import { ArrowRight, PackageOpen, Sparkles, Tag, Truck } from "lucide-react";
import type { StoreHome } from "@myapp/shared";
import { Button } from "@/components/ui/button";
import { formatCurrencyInBDT } from "@/lib/utils";
import { EmptyState, ProductImage, SectionHeading } from "../components/primitives";
import { ProductRail } from "../components/product-card";
import { useStoreSeo } from "../lib/seo";

export default function StoreHomePage({
    data,
    isLoading,
}: {
    data: StoreHome | undefined;
    isLoading: boolean;
}) {
    const store = data?.store;

    useStoreSeo(
        store
            ? {
                  title: store.name,
                  description:
                      store.description ??
                      `Shop ${store.name} online. Cash on delivery across Bangladesh.`,
                  image: store.bannerUrl ?? store.logoUrl,
                  favicon: store.faviconUrl ?? store.logoUrl,
                  jsonLd: {
                      "@context": "https://schema.org",
                      "@type": "Store",
                      name: store.name,
                      description: store.description ?? undefined,
                      image: store.logoUrl ?? undefined,
                      telephone: store.phone ?? undefined,
                      email: store.email ?? undefined,
                      address: store.address
                          ? {
                                "@type": "PostalAddress",
                                streetAddress: store.address,
                                addressCountry: "BD",
                            }
                          : undefined,
                      url: window.location.origin + window.location.pathname,
                  },
              }
            : null,
    );

    if (isLoading || !data) return <HomeSkeleton />;

    const { categories, featured, latest, onSale } = data;
    const hasAnything = featured.length + latest.length + onSale.length > 0;

    return (
        <div className="mx-auto w-full max-w-6xl px-4">
            <Hero store={data.store} />

            {!hasAnything ? (
                <EmptyState
                    icon={PackageOpen}
                    title="Nothing on the shelves yet"
                    description={`${data.store.name} is still setting up. Please check back shortly.`}
                />
            ) : (
                <div className="space-y-10 pb-4 pt-8 sm:space-y-12">
                    {categories.length > 0 && (
                        <section>
                            <SectionHeading
                                title="Shop by category"
                                action={
                                    <Link href="/categories">
                                        <Button variant="ghost" size="sm" className="gap-1">
                                            All
                                            <ArrowRight className="h-3.5 w-3.5" />
                                        </Button>
                                    </Link>
                                }
                            />
                            <div className="-mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-4 sm:gap-3 sm:px-0 lg:grid-cols-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                                {categories.slice(0, 12).map((category) => (
                                    <Link
                                        key={category.id}
                                        href={`/category/${category.slug}`}
                                        className="flex w-32 shrink-0 flex-col justify-between rounded-xl border border-card-border bg-card p-3 transition-shadow hover:shadow-md sm:w-auto"
                                    >
                                        <span className="text-sm font-medium leading-snug">
                                            {category.name}
                                        </span>
                                        <span className="mt-3 font-mono text-xs text-muted-foreground">
                                            {category.productCount}{" "}
                                            {category.productCount === 1 ? "item" : "items"}
                                        </span>
                                    </Link>
                                ))}
                            </div>
                        </section>
                    )}

                    {featured.length > 0 && (
                        <Rail
                            title="Featured"
                            subtitle="Picked by the shop"
                            icon={Sparkles}
                            products={featured}
                        />
                    )}

                    {onSale.length > 0 && (
                        <Rail
                            title="On sale"
                            subtitle="Reduced right now"
                            icon={Tag}
                            products={onSale}
                        />
                    )}

                    {latest.length > 0 && (
                        <section>
                            <SectionHeading
                                title="New arrivals"
                                subtitle="Latest in the shop"
                                action={
                                    <Link href="/shop">
                                        <Button variant="ghost" size="sm" className="gap-1">
                                            See all
                                            <ArrowRight className="h-3.5 w-3.5" />
                                        </Button>
                                    </Link>
                                }
                            />
                            <ProductRail
                                products={latest}
                                hrefFor={(p) => `/product/${p.slug}`}
                            />
                        </section>
                    )}
                </div>
            )}
        </div>
    );
}

function Rail({
    title,
    subtitle,
    icon: Icon,
    products,
}: {
    title: string;
    subtitle: string;
    icon: React.ComponentType<{ className?: string }>;
    products: StoreHome["featured"];
}) {
    return (
        <section>
            <SectionHeading
                title={title}
                subtitle={subtitle}
                icon={<Icon className="h-4 w-4 text-primary" />}
                action={
                    <Link href="/shop">
                        <Button variant="ghost" size="sm" className="gap-1">
                            See all
                            <ArrowRight className="h-3.5 w-3.5" />
                        </Button>
                    </Link>
                }
            />
            <ProductRail products={products} hrefFor={(p) => `/product/${p.slug}`} />
        </section>
    );
}

/**
 * The banner.
 *
 * A merchant with no cover image still needs a shop front that looks finished,
 * so the fallback is a typographic panel built from the store's own name and
 * description rather than a grey box waiting for an upload.
 */
function Hero({ store }: { store: StoreHome["store"] }) {
    return (
        <section className="pt-4 sm:pt-6">
            {store.bannerUrl ? (
                <div className="overflow-hidden rounded-xl border border-card-border">
                    <ProductImage
                        src={store.bannerUrl}
                        alt={`${store.name} banner`}
                        ratio="wide"
                        priority
                        className="rounded-none"
                        sizes="(max-width: 1024px) 100vw, 1024px"
                    />
                </div>
            ) : (
                <div className="rounded-xl border border-card-border bg-card px-5 py-8 sm:px-8 sm:py-12">
                    <h1 className="font-serif text-2xl font-semibold leading-tight sm:text-4xl">
                        {store.name}
                    </h1>
                    {store.description && (
                        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
                            {store.description}
                        </p>
                    )}
                    <Link href="/shop">
                        <Button className="mt-5 gap-2">
                            Browse products
                            <ArrowRight className="h-4 w-4" />
                        </Button>
                    </Link>
                </div>
            )}

            <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-xs text-muted-foreground sm:text-sm">
                <Truck className="h-4 w-4 shrink-0 text-primary" />
                <span>
                    Cash on delivery across Bangladesh
                    {store.freeDeliveryOver != null ? (
                        <>
                            {" · "}Free delivery over{" "}
                            <span className="font-mono">
                                {formatCurrencyInBDT(store.freeDeliveryOver)}
                            </span>
                        </>
                    ) : (
                        <>
                            {" · "}Delivery{" "}
                            <span className="font-mono">
                                {formatCurrencyInBDT(store.deliveryCharge)}
                            </span>
                        </>
                    )}
                </span>
            </div>
        </section>
    );
}

function HomeSkeleton() {
    return (
        <div className="mx-auto w-full max-w-6xl animate-pulse px-4 pt-6">
            <div className="aspect-[16/9] w-full rounded-xl bg-muted sm:aspect-[3/1]" />
            <div className="mt-3 h-10 rounded-lg bg-muted" />
            <div className="mt-10 h-5 w-40 rounded bg-muted" />
            <div className="mt-4 flex gap-3 overflow-hidden">
                {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-64 w-[46vw] shrink-0 rounded-xl bg-muted sm:w-52" />
                ))}
            </div>
        </div>
    );
}
