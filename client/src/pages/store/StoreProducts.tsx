import { useState } from "react";
import { Link } from "wouter";
import {
    ChevronLeft,
    Eye,
    EyeOff,
    ImageOff,
    Loader2,
    Package,
    Search,
    Sparkles,
    TriangleAlert,
    X,
} from "lucide-react";
import { toast } from "sonner";
import type {
    BasicDataResponse,
    MerchantStoreProduct,
    MerchantStoreProductDetail,
} from "@/types";
import { useGetData, useListData, usePatchData } from "@/lib/api-request";
import { useDebounce } from "@/hooks/useDebounce";
import { queryClient } from "@/lib/query-client";
import { formatCurrencyInBDT } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { StorePageHeader } from "./store-common";
import { ImageGalleryField } from "@/components/image-upload";

/**
 * Which products the storefront shows, and what they cost there.
 *
 * There is no product *creation* here on purpose. Products, categories, stock
 * and shelf prices all come from the existing POS catalog — this page only
 * layers on what a shop window needs and the till does not: photographs, a
 * description worth reading, an online price, and the decision to show an item
 * at all.
 */

type ListResponse = {
    items: MerchantStoreProduct[];
    total: number;
    page: number;
    totalPages: number;
};

const FILTERS = [
    { value: "all", label: "All products" },
    { value: "visible", label: "Shown online" },
    { value: "hidden", label: "Hidden" },
    { value: "featured", label: "Featured" },
    { value: "no_image", label: "Missing photos" },
] as const;

export default function StoreProductsPage() {
    const [search, setSearch] = useState("");
    const [filter, setFilter] = useState<string>("all");
    const [page, setPage] = useState(1);
    const [editingId, setEditingId] = useState<string | null>(null);

    const debouncedSearch = useDebounce(search, 300);

    // Narrowing the list has to send the merchant back to page 1, or a filter
    // applied on page 4 lands them on an empty page. That belongs in the event
    // that changed the query, not in an effect watching the result.
    const changeSearch = (value: string) => {
        setSearch(value);
        setPage(1);
    };
    const changeFilter = (value: string) => {
        setFilter(value);
        setPage(1);
    };

    const query = new URLSearchParams({
        page: String(page),
        limit: "20",
        filter,
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
    });

    const { data, isFetching } = useListData<BasicDataResponse<ListResponse>>(
        `/store/products?${query}`,
        ["store", "products", query.toString()],
    );

    const items = data?.data.items ?? [];
    const totalPages = data?.data.totalPages ?? 1;

    return (
        <div className="space-y-4 p-4 sm:space-y-5 sm:p-6">
            <Link
                href="/store"
                className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
                <ChevronLeft className="h-4 w-4" />
                Online store
            </Link>

            <StorePageHeader
                title="Products online"
                description="Everything here comes from your zPOS catalog. Add photos and prices for the web."
            />

            <div className="flex flex-col gap-2.5 sm:flex-row">
                <div className="relative flex-1 sm:max-w-xs">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        value={search}
                        onChange={(e) => changeSearch(e.target.value)}
                        placeholder="Search products"
                        className="h-10 pl-9"
                    />
                </div>
                <Select value={filter} onValueChange={changeFilter}>
                    <SelectTrigger className="h-10 sm:w-52" aria-label="Filter products">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {FILTERS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                                {option.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {isFetching && items.length === 0 ? (
                <div className="space-y-2.5">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className="h-24 w-full rounded-xl" />
                    ))}
                </div>
            ) : items.length === 0 ? (
                <div className="rounded-xl border border-card-border bg-card py-16 text-center">
                    <Package className="mx-auto mb-3 h-9 w-9 text-muted-foreground/40" />
                    <p className="text-sm font-medium">No products found</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                        {debouncedSearch || filter !== "all"
                            ? "Try a different search or filter."
                            : "Add products from the Products page first."}
                    </p>
                    {!debouncedSearch && filter === "all" && (
                        <Link href="/products">
                            <Button className="mt-4">Go to Products</Button>
                        </Link>
                    )}
                </div>
            ) : (
                <div className={isFetching ? "space-y-2.5 opacity-60" : "space-y-2.5"}>
                    {items.map((product) => (
                        <ProductRow
                            key={product.id}
                            product={product}
                            onEdit={() => setEditingId(product.id)}
                        />
                    ))}
                </div>
            )}

            {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 pt-2">
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={page <= 1}
                        onClick={() => setPage(page - 1)}
                    >
                        Previous
                    </Button>
                    <span className="font-mono text-sm text-muted-foreground">
                        {page} / {totalPages}
                    </span>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={page >= totalPages}
                        onClick={() => setPage(page + 1)}
                    >
                        Next
                    </Button>
                </div>
            )}

            {editingId && (
                <ProductEditor productId={editingId} onClose={() => setEditingId(null)} />
            )}
        </div>
    );
}

// ── Row ──────────────────────────────────────────────────────────────────────

function ProductRow({
    product,
    onEdit,
}: {
    product: MerchantStoreProduct;
    onEdit: () => void;
}) {
    const { mutate: patch, isPending } = usePatchData<
        Record<string, unknown>,
        BasicDataResponse<{ slug: string }>
    >("/store/products");

    const toggle = (field: "online_visible" | "is_featured", value: boolean) => {
        patch(
            { id: product.id, [field]: value },
            {
                onSuccess: () => {
                    void queryClient.invalidateQueries({ queryKey: ["store", "products"] });
                },
                onError: (error) => toast.error(error.message ?? "Could not update"),
            },
        );
    };

    // The two reasons a product silently fails to appear online. Surfacing them
    // on the row is the whole point of this page — otherwise the merchant flips
    // "show online" on and nothing happens, with nothing to explain why.
    const unpriced = product.price === null;
    const noPhoto = product.imageCount === 0;

    return (
        <div className="rounded-xl border border-card-border bg-card p-3 sm:p-4">
            <div className="flex gap-3">
                <button
                    type="button"
                    onClick={onEdit}
                    className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-border bg-muted sm:h-20 sm:w-20"
                    aria-label={`Edit ${product.name}`}
                >
                    {product.primaryImageUrl ? (
                        <img
                            src={product.primaryImageUrl}
                            alt=""
                            loading="lazy"
                            className="h-full w-full object-cover"
                        />
                    ) : (
                        <span className="flex h-full w-full items-center justify-center text-muted-foreground/40">
                            <ImageOff className="h-5 w-5" strokeWidth={1.5} />
                        </span>
                    )}
                </button>

                <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                            <button
                                type="button"
                                onClick={onEdit}
                                className="block truncate text-left text-sm font-medium hover:underline"
                            >
                                {product.name}
                            </button>
                            <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                {product.categoryName} · {product.variantCount}{" "}
                                {product.variantCount === 1 ? "option" : "options"} ·{" "}
                                <span className="font-mono">{product.totalStock}</span> in stock
                            </p>
                        </div>
                        <div className="shrink-0 text-right">
                            {product.price === null ? (
                                <span className="text-xs text-muted-foreground">No price</span>
                            ) : (
                                <>
                                    <p className="font-mono text-sm font-semibold tabular-nums">
                                        {formatCurrencyInBDT(product.price)}
                                    </p>
                                    {product.compareAtPrice != null && (
                                        <p className="font-mono text-[11px] text-muted-foreground line-through">
                                            {formatCurrencyInBDT(product.compareAtPrice)}
                                        </p>
                                    )}
                                </>
                            )}
                        </div>
                    </div>

                    {(unpriced || noPhoto) && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            {unpriced && (
                                <span className="inline-flex items-center gap-1 rounded-md bg-warning/12 px-1.5 py-0.5 text-[11px] font-medium text-warning">
                                    <TriangleAlert className="h-3 w-3" />
                                    No price — hidden from the shop
                                </span>
                            )}
                            {noPhoto && (
                                <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                                    <ImageOff className="h-3 w-3" />
                                    No photo
                                </span>
                            )}
                        </div>
                    )}

                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                        <label className="flex cursor-pointer items-center gap-2 text-xs">
                            <Switch
                                checked={product.onlineVisible}
                                disabled={isPending}
                                onCheckedChange={(value) => toggle("online_visible", value)}
                                aria-label={`Show ${product.name} online`}
                            />
                            <span className="inline-flex items-center gap-1 text-muted-foreground">
                                {product.onlineVisible ? (
                                    <Eye className="h-3.5 w-3.5" />
                                ) : (
                                    <EyeOff className="h-3.5 w-3.5" />
                                )}
                                {product.onlineVisible ? "Shown" : "Hidden"}
                            </span>
                        </label>

                        <label className="flex cursor-pointer items-center gap-2 text-xs">
                            <Switch
                                checked={product.isFeatured}
                                disabled={isPending}
                                onCheckedChange={(value) => toggle("is_featured", value)}
                                aria-label={`Feature ${product.name}`}
                            />
                            <span className="inline-flex items-center gap-1 text-muted-foreground">
                                <Sparkles className="h-3.5 w-3.5" />
                                Featured
                            </span>
                        </label>

                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={onEdit}
                            className="ml-auto"
                        >
                            Photos & pricing
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── Editor ───────────────────────────────────────────────────────────────────

function ProductEditor({
    productId,
    onClose,
}: {
    productId: string;
    onClose: () => void;
}) {
    const { data, isLoading } = useGetData<BasicDataResponse<MerchantStoreProductDetail>>(
        `/store/products/${productId}`,
        ["store", "product", productId],
        { staleTime: 0 },
    );

    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{data?.data.name ?? "Product"}</DialogTitle>
                    <DialogDescription>
                        Photos, description and online pricing. Stock and the shelf price come
                        from your purchases.
                    </DialogDescription>
                </DialogHeader>

                {isLoading || !data ? (
                    <div className="space-y-3 py-4">
                        <Skeleton className="h-24 w-full" />
                        <Skeleton className="h-32 w-full" />
                    </div>
                ) : (
                    <EditorBody product={data.data} onSaved={onClose} />
                )}
            </DialogContent>
        </Dialog>
    );
}

function EditorBody({
    product,
    onSaved,
}: {
    product: MerchantStoreProductDetail;
    onSaved: () => void;
}) {
    const [images, setImages] = useState<string[]>(
        product.images.map((image) => image.url),
    );
    const [description, setDescription] = useState(product.description ?? "");
    const [slug, setSlug] = useState(product.slug ?? "");

    const { mutate: saveProduct, isPending } = usePatchData<
        Record<string, unknown>,
        BasicDataResponse<{ slug: string }>
    >("/store/products");

    const save = () => {
        saveProduct(
            {
                id: product.id,
                description: description.trim(),
                slug: slug.trim() || undefined,
                images: images.map((ref) => ({ url: ref })),
            },
            {
                onSuccess: () => {
                    toast.success("Product updated");
                    void queryClient.invalidateQueries({ queryKey: ["store", "products"] });
                    void queryClient.invalidateQueries({ queryKey: ["store", "product"] });
                    onSaved();
                },
                onError: (error) => toast.error(error.message ?? "Could not save"),
            },
        );
    };

    return (
        <div className="space-y-5">
            <ImageGalleryField
                value={images}
                onChange={setImages}
                hint="Upload from your phone or computer. The first photo is the one shown in listings."
            />

            <section>
                <h3 className="text-sm font-medium">Description</h3>
                <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={4}
                    maxLength={4000}
                    placeholder="What it is, what it's made of, how it fits — whatever helps someone decide."
                    className="mt-2 resize-none"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                    Shown on the product page and used for search results.
                </p>
            </section>

            <section>
                <h3 className="text-sm font-medium">Web address</h3>
                <Input
                    value={slug}
                    onChange={(e) =>
                        setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
                    }
                    className="mt-2 h-10 font-mono"
                    maxLength={80}
                    placeholder="cotton-shirt"
                />
                <p className="mt-1 break-all text-xs text-muted-foreground">
                    /product/{slug || product.slug || "…"}
                </p>
            </section>

            <section>
                <h3 className="text-sm font-medium">Online pricing</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                    Leave the online price empty to use the shelf price from your latest
                    purchase. A discount must be below the regular price.
                </p>
                <div className="mt-3 space-y-2.5">
                    {product.variants.map((variant) => (
                        <VariantPricingRow key={variant.id} variant={variant} />
                    ))}
                </div>
            </section>

            <div className="flex justify-end gap-2 border-t border-border pt-4">
                <Button type="button" variant="outline" onClick={onSaved}>
                    <X className="h-4 w-4" />
                    Close
                </Button>
                <Button type="button" onClick={save} disabled={isPending} className="gap-2">
                    {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                    Save
                </Button>
            </div>
        </div>
    );
}

function VariantPricingRow({
    variant,
}: {
    variant: MerchantStoreProductDetail["variants"][number];
}) {
    const [price, setPrice] = useState(
        variant.onlinePrice === null ? "" : String(variant.onlinePrice),
    );
    const [salePrice, setSalePrice] = useState(
        variant.onlineSalePrice === null ? "" : String(variant.onlineSalePrice),
    );

    const { mutate: savePricing, isPending } = usePatchData<
        Record<string, unknown>,
        BasicDataResponse<Record<string, never>>
    >("/store/variants");

    const dirty =
        price !== (variant.onlinePrice === null ? "" : String(variant.onlinePrice)) ||
        salePrice !==
            (variant.onlineSalePrice === null ? "" : String(variant.onlineSalePrice));

    const save = () => {
        savePricing(
            {
                id: variant.id,
                // "" clears the override; the server reads null as "fall back to
                // the shelf price" rather than "leave unchanged".
                online_price: price.trim() === "" ? null : price.trim(),
                online_sale_price: salePrice.trim() === "" ? null : salePrice.trim(),
            },
            {
                onSuccess: () => {
                    toast.success("Pricing updated");
                    void queryClient.invalidateQueries({ queryKey: ["store", "product"] });
                    void queryClient.invalidateQueries({ queryKey: ["store", "products"] });
                },
                onError: (error) => toast.error(error.message ?? "Could not update pricing"),
            },
        );
    };

    return (
        <div className="rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                        {variant.name ?? "Standard"}
                        {!variant.isActive && (
                            <span className="ml-2 text-xs text-muted-foreground">(inactive)</span>
                        )}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                        {variant.stock} in stock ·{" "}
                        {variant.shelfPrice === null
                            ? "no shelf price yet"
                            : `shelf ${formatCurrencyInBDT(variant.shelfPrice)}`}
                    </p>
                </div>
                {variant.effectivePrice !== null && (
                    <p className="font-mono text-sm font-semibold">
                        {formatCurrencyInBDT(variant.effectivePrice)}
                    </p>
                )}
            </div>

            <div className="mt-2.5 grid grid-cols-2 gap-2">
                <div>
                    <label className="text-[11px] text-muted-foreground">Online price (৳)</label>
                    <Input
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        inputMode="decimal"
                        placeholder={
                            variant.shelfPrice === null ? "—" : String(variant.shelfPrice)
                        }
                        className="mt-1 h-9 font-mono"
                    />
                </div>
                <div>
                    <label className="text-[11px] text-muted-foreground">Discount (৳)</label>
                    <Input
                        value={salePrice}
                        onChange={(e) => setSalePrice(e.target.value)}
                        inputMode="decimal"
                        placeholder="—"
                        className="mt-1 h-9 font-mono"
                    />
                </div>
            </div>

            {dirty && (
                <Button
                    type="button"
                    size="sm"
                    onClick={save}
                    disabled={isPending}
                    className="mt-2.5 gap-1.5"
                >
                    {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Save pricing
                </Button>
            )}
        </div>
    );
}
