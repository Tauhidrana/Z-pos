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
                            className="flex flex-col justify-between rounded-xl border border-card-border bg-card p-4 transition-shadow hover:shadow-md"
                        >
                            <span className="text-sm font-medium leading-snug">
                                {category.name}
                            </span>
                            <span className="mt-4 font-mono text-xs text-muted-foreground">
                                {category.productCount}{" "}
                                {category.productCount === 1 ? "item" : "items"}
                            </span>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}
