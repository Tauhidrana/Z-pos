import { Link } from "wouter";
import { ArrowRight, PackageOpen, Sparkles, Tag, Truck } from "lucide-react";
import type { StoreCategory, StoreHome } from "@myapp/shared";
import { Button } from "@/components/ui/button";
import { formatCurrencyInBDT } from "@/lib/utils";
import { EmptyState, SectionHeading } from "../components/primitives";
import { HeroCarousel } from "../components/hero-carousel";
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
                  // The merchant's override wins; their store name and
                  // description are the fallback. Either way the tags describe
                  // this shop, never zPOS.
                  title: store.metaTitle ?? store.name,
                  description:
                      store.metaDescription ??
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
                      // The pin, when the merchant has placed one. This is what
                      // puts a shop on a local-results map rather than in a
                      // list of ten blue links.
                      //
                      // `openingHours` is deliberately not emitted alongside
                      // it: schema.org wants "Mo-Th 10:00-20:00", the merchant
                      // typed "Sat–Thu 10am–8pm · Friday closed", and invalid
                      // structured data is treated worse than absent data.
                      geo:
                          store.latitude !== null && store.longitude !== null
                              ? {
                                    "@type": "GeoCoordinates",
                                    latitude: store.latitude,
                                    longitude: store.longitude,
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
            <Hero store={data.store} banners={data.banners} />

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
                                    <CategoryTile key={category.id} category={category} />
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
 * The shop front's hero, plus the delivery promise directly beneath it.
 *
 * The promise sits here rather than in the footer because it answers the two
 * questions a first-time shopper has before they will consider buying — can I
 * pay cash, and what does delivery cost — and it answers them above the fold.
 */
function Hero({
    store,
    banners,
}: {
    store: StoreHome["store"];
    banners: StoreHome["banners"];
}) {
    return (
        <section className="pt-4 sm:pt-6">
            <HeroCarousel banners={banners} store={store} />

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

/**
 * One category in the homepage rail.
 *
 * Artwork when the merchant has uploaded it, and a typographic tile when they
 * have not — rather than a grey placeholder box, which makes a shop look
 * unfinished for the entirely normal case of a merchant who has added products
 * but not category photographs.
 */
function CategoryTile({ category }: { category: StoreCategory }) {
    const count = `${category.productCount} ${category.productCount === 1 ? "item" : "items"}`;

    return (
        <Link
            href={`/category/${category.slug}`}
            className="group w-28 shrink-0 sm:w-auto"
        >
            <div className="aspect-square overflow-hidden rounded-xl border border-card-border bg-card">
                {category.imageUrl ? (
                    <img
                        src={category.imageUrl}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                ) : (
                    <div className="flex h-full w-full items-center justify-center bg-accent/40 p-2 text-center">
                        <span className="font-serif text-sm font-semibold leading-tight text-accent-foreground">
                            {category.name}
                        </span>
                    </div>
                )}
            </div>
            <p className="mt-1.5 truncate text-xs font-medium leading-tight sm:text-sm">
                {category.name}
            </p>
            <p className="font-mono text-[11px] text-muted-foreground">{count}</p>
        </Link>
    );
}
