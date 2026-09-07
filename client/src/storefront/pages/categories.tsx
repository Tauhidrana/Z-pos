import { Link } from "wouter";
import { LayoutGrid } from "lucide-react";
import type { StoreCategory, StorePublic } from "@myapp/shared";
import { Button } from "@/components/ui/button";
import { EmptyState } from "../components/primitives";
import { useStoreSeo } from "../lib/seo";

/**
 * The browse-by-category page. It exists mainly for the mobile tab bar, where
 * the horizontal category strip in the header is easy to miss — this gives the
 * whole list a screen of its own.
 */
export default function CategoriesPage({
    store,
    categories,
}: {
    store: StorePublic;
    categories: StoreCategory[];
}) {
    useStoreSeo({
        title: `Categories — ${store.name}`,
        description: `Browse every category at ${store.name}.`,
        favicon: store.faviconUrl ?? store.logoUrl,
    });

    return (
        <div className="mx-auto w-full max-w-4xl px-4 py-5 sm:py-7">
            <h1 className="mb-4 font-serif text-xl font-semibold sm:text-2xl">Categories</h1>

            {categories.length === 0 ? (
                <EmptyState
                    icon={LayoutGrid}
                    title="No categories yet"
                    description="This shop has not organised its products into categories."
                    action={
                        <Link href="/shop">
                            <Button>See all products</Button>
                        </Link>
                    }
                />
            ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {categories.map((category) => (
                        <Link
                            key={category.id}
                            href={`/category/${category.slug}`}
                            className="group overflow-hidden rounded-xl border border-card-border bg-card transition-shadow hover:shadow-md"
                        >
                            {/* Square artwork, or a typographic panel when the
                                merchant has not uploaded any — never an empty
                                grey box, which reads as a broken page. */}
                            <div className="aspect-square w-full overflow-hidden bg-muted">
                                {category.imageUrl ? (
                                    <img
                                        src={category.imageUrl}
                                        alt=""
                                        loading="lazy"
                                        decoding="async"
                                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                                    />
                                ) : (
                                    <div className="flex h-full w-full items-center justify-center bg-accent/40 p-3 text-center">
                                        <span className="font-serif text-base font-semibold leading-tight text-accent-foreground">
                                            {category.name}
                                        </span>
                                    </div>
                                )}
                            </div>
                            <div className="p-3">
                                <p className="truncate text-sm font-medium leading-snug">
                                    {category.name}
                                </p>
                                <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                                    {category.productCount}{" "}
                                    {category.productCount === 1 ? "item" : "items"}
                                </p>
                            </div>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}
