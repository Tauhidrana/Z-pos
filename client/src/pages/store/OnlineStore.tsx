import { useState } from "react";
import { Link } from "wouter";
import {
    AlertTriangle,
    ArrowRight,
    CheckCircle2,
    Globe,
    Loader2,
    Package,
    Settings,
    ShoppingBag,
    Store as StoreIcon,
} from "lucide-react";
import { toast } from "sonner";
import type { BasicDataResponse, MerchantStore, MerchantOrderStats } from "@/types";
import { useGetData, usePostData } from "@/lib/api-request";
import { useDebounce } from "@/hooks/useDebounce";
import { queryClient } from "@/lib/query-client";
import { storeUrls, appDomain } from "@/lib/tenant";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrencyInBDT } from "@/lib/utils";
import {
    CopyButton,
    ExternalLinkButton,
    SettingsSection,
    StorePageHeader,
} from "./store-common";

/**
 * The Online Store landing page.
 *
 * Two completely different screens behind one route: the merchant either has a
 * storefront (overview) or does not (the form that opens one). Keeping them
 * together means the nav item never leads to a dead end.
 */
export default function OnlineStorePage() {
    const { data, isLoading } = useGetData<BasicDataResponse<MerchantStore | null>>(
        "/store",
        ["store"],
        { staleTime: 60_000 },
    );

    if (isLoading) {
        return (
            <div className="space-y-4 p-4 sm:p-6">
                <Skeleton className="h-8 w-48" />
                <Skeleton className="h-40 w-full rounded-xl" />
                <Skeleton className="h-32 w-full rounded-xl" />
            </div>
        );
    }

    return data?.data ? <StoreOverview store={data.data} /> : <CreateStoreForm />;
}

// ── Overview ─────────────────────────────────────────────────────────────────

function StoreOverview({ store }: { store: MerchantStore }) {
    const urls = storeUrls(store.slug);

    const { data: statsRes } = useGetData<BasicDataResponse<MerchantOrderStats>>(
        "/store/orders/stats",
        ["store", "orders", "stats"],
    );
    const stats = statsRes?.data;

    return (
        <div className="space-y-4 p-4 sm:space-y-5 sm:p-6">
            <StorePageHeader
                title="Online store"
                description={`${store.name} is ${store.isActive ? "live" : "switched off"}`}
                action={
                    <Link href="/store/settings">
                        <Button variant="outline" className="gap-2">
                            <Settings className="h-4 w-4" />
                            Settings
                        </Button>
                    </Link>
                }
            />

            {!store.isActive && (
                <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/8 p-4">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
                    <div className="text-sm">
                        <p className="font-medium">Your storefront is switched off</p>
                        <p className="mt-0.5 text-muted-foreground">
                            Visitors see a "shop is closed" page and cannot order. Turn it back
                            on in{" "}
                            <Link href="/store/settings" className="text-primary underline-offset-2 hover:underline">
                                settings
                            </Link>
                            .
                        </p>
                    </div>
                </div>
            )}

            <SettingsSection
                title="Your web address"
                description="Share this link with your customers."
            >
                <div className="space-y-3">
                    <AddressRow
                        label="Shop link"
                        url={urls.path}
                        note="Works right now, on your current deployment."
                        recommended
                    />
                    <AddressRow
                        label="Subdomain"
                        url={urls.subdomain}
                        note={`Works once ${appDomain} has a wildcard domain (*.${appDomain}) pointed at this project.`}
                    />
                </div>
            </SettingsSection>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard
                    label="New orders"
                    value={stats?.pending}
                    icon={ShoppingBag}
                    tone="warning"
                />
                <StatCard label="In progress" value={stats?.processing} icon={Package} />
                <StatCard
                    label="Delivered"
                    value={stats?.delivered}
                    icon={CheckCircle2}
                    tone="success"
                />
                <StatCard
                    label="Online revenue"
                    value={stats?.revenue}
                    icon={Globe}
                    money
                />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
                <QuickLink
                    href="/store/orders"
                    icon={ShoppingBag}
                    title="Orders"
                    description={
                        stats?.pending
                            ? `${stats.pending} waiting to be confirmed`
                            : "Confirm, pack and deliver online orders"
                    }
                    highlight={Boolean(stats?.pending)}
                />
                <QuickLink
                    href="/store/products"
                    icon={Package}
                    title="Products online"
                    description="Choose what appears, add photos and set online prices"
                />
            </div>
        </div>
    );
}

function AddressRow({
    label,
    url,
    note,
    recommended,
}: {
    label: string;
    url: string;
    note: string;
    recommended?: boolean;
}) {
    return (
        <div className="rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {label}
                </span>
                {recommended && (
                    <span className="rounded bg-success/12 px-1.5 py-0.5 text-[10px] font-medium text-success">
                        Live now
                    </span>
                )}
            </div>
            <p className="mt-1.5 break-all font-mono text-sm">{url}</p>
            <p className="mt-1 text-xs text-muted-foreground">{note}</p>
            <div className="mt-2.5 flex flex-wrap gap-2">
                <CopyButton value={url} label="Copy link" />
                <ExternalLinkButton href={url} label="Open" />
            </div>
        </div>
    );
}

function StatCard({
    label,
    value,
    icon: Icon,
    tone,
    money,
}: {
    label: string;
    value: number | undefined;
    icon: React.ComponentType<{ className?: string }>;
    tone?: "success" | "warning";
    money?: boolean;
}) {
    const toneClass =
        tone === "success"
            ? "text-success"
            : tone === "warning"
              ? "text-warning"
              : "text-primary";

    return (
        <div className="rounded-xl border border-card-border bg-card p-3 sm:p-4">
            <Icon className={`h-4 w-4 ${toneClass}`} />
            <p className="mt-2 font-mono text-lg font-bold tabular-nums sm:text-xl">
                {value === undefined ? (
                    <Skeleton className="h-6 w-14" />
                ) : money ? (
                    formatCurrencyInBDT(value)
                ) : (
                    value
                )}
            </p>
            <p className="text-xs leading-tight text-muted-foreground">{label}</p>
        </div>
    );
}

function QuickLink({
    href,
    icon: Icon,
    title,
    description,
    highlight,
}: {
    href: string;
    icon: React.ComponentType<{ className?: string }>;
    title: string;
    description: string;
    highlight?: boolean;
}) {
    return (
        <Link href={href}>
            <div
                className={`flex items-center gap-3 rounded-xl border bg-card p-4 transition-shadow hover:shadow-md ${
                    highlight ? "border-primary/40" : "border-card-border"
                }`}
            >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Icon className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{title}</p>
                    <p className="text-xs text-muted-foreground">{description}</p>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </div>
        </Link>
    );
}

// ── Creation ─────────────────────────────────────────────────────────────────

type SlugCheck = { available: boolean; slug?: string; reason: string | null };

/**
 * Opening a store.
 *
 * The address is the one decision that is hard to walk back — it is what
 * customers will have bookmarked — so it gets live availability checking rather
 * than a rejection on submit.
 */
function CreateStoreForm() {
    const [name, setName] = useState("");
    const [slug, setSlug] = useState("");
    const [slugTouched, setSlugTouched] = useState(false);
    const [description, setDescription] = useState("");
    const [phone, setPhone] = useState("");

    // Suggest an address from the shop name until the merchant edits the
    // address themselves, then stop fighting them for control of the field.
    //
    // Adjusted during render against the previous name rather than in an
    // effect, so the suggestion appears in the same paint as the character
    // that produced it instead of one frame later.
    const [lastName, setLastName] = useState(name);
    if (name !== lastName) {
        setLastName(name);
        if (!slugTouched) {
            setSlug(
                name
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/^-+|-+$/g, "")
                    .slice(0, 32),
            );
        }
    }

    const debouncedSlug = useDebounce(slug, 400);

    const { data: checkRes, isFetching: checking } = useGetData<BasicDataResponse<SlugCheck>>(
        `/store/slug-check?slug=${encodeURIComponent(debouncedSlug)}`,
        ["store", "slug-check", debouncedSlug],
        { enabled: debouncedSlug.length >= 3, staleTime: 0, retry: 0 },
    );

    const check = debouncedSlug.length >= 3 ? checkRes?.data : undefined;
    const slugSettled = debouncedSlug === slug && !checking;

    const { mutate: createStore, isPending } = usePostData<
        Record<string, unknown>,
        BasicDataResponse<MerchantStore>
    >("/store");

    const canSubmit =
        name.trim().length >= 2 && slug.length >= 3 && check?.available === true && slugSettled;

    const submit = (event: React.FormEvent) => {
        event.preventDefault();
        if (!canSubmit) return;

        createStore(
            {
                name: name.trim(),
                slug,
                description: description.trim() || null,
                phone: phone.trim() || null,
            },
            {
                onSuccess: () => {
                    toast.success("Your online store is live");
                    // The overview reads the same key, and the shop name may
                    // have been adopted from the store name server-side.
                    void queryClient.invalidateQueries({ queryKey: ["store"] });
                },
                onError: (error) => toast.error(error.message ?? "Could not create the store"),
            },
        );
    };

    return (
        <div className="mx-auto max-w-2xl p-4 sm:p-6">
            <div className="mb-5 flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                    <StoreIcon className="h-5 w-5 text-primary" />
                </div>
                <div>
                    <h1 className="text-xl font-bold sm:text-2xl">Open your online store</h1>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                        Your products, prices and stock come straight from zPOS. Customers order
                        with cash on delivery, and the orders land back in this dashboard.
                    </p>
                </div>
            </div>

            <form onSubmit={submit}>
                <SettingsSection title="The basics">
                    <div className="space-y-4">
                        <div>
                            <label htmlFor="store-name" className="text-sm font-medium">
                                Store name
                            </label>
                            <Input
                                id="store-name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="e.g. TDS Fashion"
                                className="mt-1.5 h-11"
                                maxLength={80}
                                autoFocus
                            />
                            <p className="mt-1 text-xs text-muted-foreground">
                                Shown at the top of your storefront.
                            </p>
                        </div>

                        <div>
                            <label htmlFor="store-slug" className="text-sm font-medium">
                                Web address
                            </label>
                            <Input
                                id="store-slug"
                                value={slug}
                                onChange={(e) => {
                                    setSlugTouched(true);
                                    setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
                                }}
                                placeholder="tds"
                                className="mt-1.5 h-11 font-mono"
                                maxLength={32}
                                aria-describedby="slug-status"
                            />

                            <div id="slug-status" className="mt-1.5 min-h-5 text-xs">
                                {slug.length > 0 && slug.length < 3 ? (
                                    <span className="text-muted-foreground">
                                        At least 3 characters.
                                    </span>
                                ) : checking || debouncedSlug !== slug ? (
                                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                        Checking…
                                    </span>
                                ) : check?.available ? (
                                    <span className="inline-flex items-center gap-1 text-success">
                                        <CheckCircle2 className="h-3 w-3" />
                                        Available
                                    </span>
                                ) : check ? (
                                    <span className="text-destructive">{check.reason}</span>
                                ) : null}
                            </div>

                            {slug.length >= 3 && (
                                <div className="mt-2 rounded-lg bg-muted px-3 py-2">
                                    <p className="text-xs text-muted-foreground">
                                        Your shop will be at
                                    </p>
                                    <p className="mt-0.5 break-all font-mono text-xs">
                                        {storeUrls(slug).path}
                                    </p>
                                </div>
                            )}
                        </div>

                        <div>
                            <label htmlFor="store-desc" className="text-sm font-medium">
                                Short description{" "}
                                <span className="font-normal text-muted-foreground">
                                    (optional)
                                </span>
                            </label>
                            <Textarea
                                id="store-desc"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                rows={2}
                                maxLength={1000}
                                placeholder="What you sell, in a line or two"
                                className="mt-1.5 resize-none"
                            />
                        </div>

                        <div>
                            <label htmlFor="store-phone" className="text-sm font-medium">
                                Contact number{" "}
                                <span className="font-normal text-muted-foreground">
                                    (optional)
                                </span>
                            </label>
                            <Input
                                id="store-phone"
                                value={phone}
                                onChange={(e) => setPhone(e.target.value)}
                                type="tel"
                                inputMode="numeric"
                                placeholder="01XXXXXXXXX"
                                className="mt-1.5 h-11 font-mono"
                                maxLength={20}
                            />
                        </div>
                    </div>
                </SettingsSection>

                <Button
                    type="submit"
                    disabled={!canSubmit || isPending}
                    className="mt-4 h-11 w-full sm:w-auto"
                >
                    {isPending ? (
                        <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Creating…
                        </>
                    ) : (
                        "Create my store"
                    )}
                </Button>
            </form>
        </div>
    );
}
