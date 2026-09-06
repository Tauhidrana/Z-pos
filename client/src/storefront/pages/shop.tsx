import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { PackageOpen, SearchX, SlidersHorizontal } from "lucide-react";
import type { StoreCategory, StorePublic, StoreProductList } from "@myapp/shared";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useDebounce } from "@/hooks/useDebounce";
import { Input } from "@/components/ui/input";
import { useStoreListQuery } from "../lib/api";
import { ProductCard, ProductGrid, ProductGridSkeleton } from "../components/product-card";
import { EmptyState } from "../components/primitives";
import { useStoreSeo } from "../lib/seo";
import { ErrorPanel } from "../components/states";

const SORTS = [
    { value: "newest", label: "Newest first" },
    { value: "price_asc", label: "Price: low to high" },
    { value: "price_desc", label: "Price: high to low" },
    { value: "name_asc", label: "Name: A to Z" },
    { value: "name_desc", label: "Name: Z to A" },
] as const;

/**
 * The catalog page, used for both "all products" and a single category.
 *
 * Filter state lives in the URL rather than in component state, so a shopper
 * can share what they are looking at, and the back button undoes a filter
 * instead of leaving the shop.
 */
export default function ShopPage({
    slug,
    store,
    categories,
    categorySlug,
}: {
    slug: string;
    store: StorePublic;
    categories: StoreCategory[];
    categorySlug?: string;
}) {
    const [, navigate] = useLocation();
    const search = useSearch();
    const params = new URLSearchParams(search);

    const urlSearch = params.get("search") ?? "";
    const sort = params.get("sort") ?? "newest";
    const inStockOnly = params.get("inStock") === "1";
    const page = Math.max(1, Number(params.get("page") ?? "1") || 1);

    const [searchInput, setSearchInput] = useState(urlSearch);
    const debouncedSearch = useDebounce(searchInput, 350);

    // Follow the URL when it changes underneath us — a category link, or the
    // back button. Adjusted during render rather than in an effect so the input
    // never paints the previous query for a frame.
    const [lastUrlSearch, setLastUrlSearch] = useState(urlSearch);
    if (urlSearch !== lastUrlSearch) {
        setLastUrlSearch(urlSearch);
        setSearchInput(urlSearch);
    }

    const basePathname = categorySlug ? `/category/${categorySlug}` : "/shop";

    // Typing rewrites the URL, which is what actually drives the query. Done
    // with replace so a search does not fill the history with one step per
    // keystroke — otherwise "back" would walk the shopper letter by letter out
    // of their own search.
    useEffect(() => {
        if (debouncedSearch === urlSearch) return;
        const next = new URLSearchParams(search);
        if (debouncedSearch) next.set("search", debouncedSearch);
        else next.delete("search");
        next.delete("page");
        navigate(`${basePathname}${next.toString() ? `?${next}` : ""}`, { replace: true });
        // `search` and `navigate` change on every render of a new URL; keying
        // this on the debounced value alone is what keeps it from looping.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [debouncedSearch]);

    const activeCategory = categories.find((c) => c.slug === categorySlug);

    const query = new URLSearchParams({
        page: String(page),
        limit: "24",
        sort,
        ...(urlSearch ? { search: urlSearch } : {}),
        ...(categorySlug ? { category: categorySlug } : {}),
        ...(inStockOnly ? { inStock: "1" } : {}),
    });

    const { data, isLoading, isFetching, error, refetch } = useStoreListQuery<StoreProductList>(
        `/storefront/${slug}/products?${query}`,
        ["storefront", slug, "products", query.toString()],
    );

    const title = activeCategory ? activeCategory.name : urlSearch ? `"${urlSearch}"` : "All products";

    useStoreSeo({
        title: `${title} — ${store.name}`,
        description: activeCategory
            ? `Browse ${activeCategory.name} at ${store.name}. Cash on delivery across Bangladesh.`
            : store.description ?? `Shop all products at ${store.name}.`,
        favicon: store.faviconUrl ?? store.logoUrl,
    });

    const setParam = (key: string, value: string | null) => {
        const next = new URLSearchParams(search);
        if (value === null) next.delete(key);
        else next.set(key, value);
        if (key !== "page") next.delete("page");
        navigate(`${basePathname}${next.toString() ? `?${next}` : ""}`);
    };

    const items = data?.items ?? [];
    const totalPages = data?.totalPages ?? 1;

    return (
        <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:py-7">
            <div className="mb-4 sm:mb-5">
                <h1 className="font-serif text-xl font-semibold sm:text-2xl">{title}</h1>
                <p className="mt-0.5 text-sm text-muted-foreground">
                    {isLoading
                        ? "Loading…"
                        : `${data?.total ?? 0} ${data?.total === 1 ? "product" : "products"}`}
                </p>
            </div>

            <div className="mb-5 flex flex-col gap-2.5 sm:flex-row sm:items-center">
                <Input
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder="Search this shop"
                    type="search"
                    aria-label="Search products"
                    className="h-11 sm:h-9 sm:max-w-xs"
                />

                <div className="flex items-center gap-2">
                    <Select value={sort} onValueChange={(value) => setParam("sort", value)}>
                        <SelectTrigger
                            className="h-11 flex-1 sm:h-9 sm:w-48"
                            aria-label="Sort products"
                        >
                            <SlidersHorizontal className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {SORTS.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    <Button
                        type="button"
                        variant={inStockOnly ? "default" : "outline"}
                        className="h-11 shrink-0 sm:h-9"
                        aria-pressed={inStockOnly}
                        onClick={() => setParam("inStock", inStockOnly ? null : "1")}
                    >
                        In stock
                    </Button>
                </div>
            </div>

            {error ? (
                <ErrorPanel error={error} onRetry={() => void refetch()} />
            ) : isLoading ? (
                <ProductGridSkeleton count={8} />
            ) : items.length === 0 ? (
                <EmptyState
                    icon={urlSearch ? SearchX : PackageOpen}
                    title={urlSearch ? "No matches" : "Nothing here yet"}
                    description={
                        urlSearch
                            ? `We could not find anything for "${urlSearch}". Try a different word.`
                            : "This section has no products at the moment."
                    }
                    action={
                        urlSearch ? (
                            <Button variant="outline" onClick={() => setParam("search", null)}>
                                Clear search
                            </Button>
                        ) : undefined
                    }
                />
            ) : (
                <>
                    <div
                        className={
                            // A refetch keeps the previous page on screen; dimming
                            // it says "working" without collapsing the layout.
                            isFetching ? "opacity-60 transition-opacity" : undefined
                        }
                    >
                        <ProductGrid>
                            {items.map((product, index) => (
                                <ProductCard
                                    key={product.id}
                                    product={product}
                                    href={`/product/${product.slug}`}
                                    priority={index < 4}
                                />
                            ))}
                        </ProductGrid>
                    </div>

                    {totalPages > 1 && (
                        <div className="mt-8 flex items-center justify-center gap-3">
                            <Button
                                variant="outline"
                                disabled={page <= 1}
                                onClick={() => setParam("page", String(page - 1))}
                            >
                                Previous
                            </Button>
                            <span className="font-mono text-sm text-muted-foreground">
                                {page} / {totalPages}
                            </span>
                            <Button
                                variant="outline"
                                disabled={page >= totalPages}
                                onClick={() => setParam("page", String(page + 1))}
                            >
                                Next
                            </Button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
