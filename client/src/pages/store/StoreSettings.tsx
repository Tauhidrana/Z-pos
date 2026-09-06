import { useState } from "react";
import { Link } from "wouter";
import { ChevronLeft, Loader2, Power, Save } from "lucide-react";
import { toast } from "sonner";
import type { BasicDataResponse, MerchantStore } from "@/types";
import { useGetData, usePatchData } from "@/lib/api-request";
import { useDebounce } from "@/hooks/useDebounce";
import { queryClient } from "@/lib/query-client";
import { storeUrls } from "@/lib/tenant";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { updateStoreSchema } from "@myapp/shared/schemas/store.schema";
import { SettingsSection, StorePageHeader } from "./store-common";
import { ImageUploadField } from "@/components/image-upload";

/**
 * Storefront settings.
 *
 * One long form rather than a tabbed console: there are perhaps twenty fields
 * in total, and a merchant setting up for the first time wants to walk them
 * top to bottom, not hunt through sections. Validation runs through the same
 * zod schema the server enforces, so what the form accepts and what the API
 * accepts cannot drift apart.
 */

type FormState = {
    name: string;
    slug: string;
    description: string;
    logo_url: string;
    banner_url: string;
    favicon_url: string;
    phone: string;
    email: string;
    address: string;
    facebook_url: string;
    instagram_url: string;
    whatsapp_number: string;
    delivery_charge: string;
    free_delivery_over: string;
    min_order_amount: string;
    theme_color: string;
    is_active: boolean;
};

function toForm(store: MerchantStore): FormState {
    return {
        name: store.name,
        slug: store.slug,
        description: store.description ?? "",
        logo_url: store.logoUrl ?? "",
        banner_url: store.bannerUrl ?? "",
        favicon_url: store.faviconUrl ?? "",
        phone: store.phone ?? "",
        email: store.email ?? "",
        address: store.address ?? "",
        facebook_url: store.facebookUrl ?? "",
        instagram_url: store.instagramUrl ?? "",
        whatsapp_number: store.whatsappNumber ?? "",
        delivery_charge: String(store.deliveryCharge),
        free_delivery_over:
            store.freeDeliveryOver === null ? "" : String(store.freeDeliveryOver),
        min_order_amount: String(store.minOrderAmount),
        theme_color: store.themeColor,
        is_active: store.isActive,
    };
}

export default function StoreSettingsPage() {
    const { data, isLoading } = useGetData<BasicDataResponse<MerchantStore | null>>(
        "/store",
        ["store"],
        { staleTime: 60_000 },
    );

    if (isLoading) {
        return (
            <div className="space-y-4 p-4 sm:p-6">
                <Skeleton className="h-8 w-48" />
                <Skeleton className="h-64 w-full rounded-xl" />
            </div>
        );
    }

    if (!data?.data) {
        return (
            <div className="p-6 text-center">
                <p className="text-sm text-muted-foreground">
                    You have not opened an online store yet.
                </p>
                <Link href="/store">
                    <Button className="mt-4">Open one</Button>
                </Link>
            </div>
        );
    }

    return <SettingsForm store={data.data} />;
}

function SettingsForm({ store }: { store: MerchantStore }) {
    const [form, setForm] = useState<FormState>(() => toForm(store));
    const [errors, setErrors] = useState<Record<string, string>>({});

    const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
        setForm((current) => ({ ...current, [key]: value }));

    const debouncedSlug = useDebounce(form.slug, 400);
    const slugChanged = debouncedSlug !== store.slug;

    const { data: slugCheck } = useGetData<
        BasicDataResponse<{ available: boolean; reason: string | null }>
    >(
        `/store/slug-check?slug=${encodeURIComponent(debouncedSlug)}`,
        ["store", "slug-check", debouncedSlug],
        { enabled: slugChanged && debouncedSlug.length >= 3, staleTime: 0, retry: 0 },
    );

    const { mutate: save, isPending } = usePatchData<
        Record<string, unknown>,
        BasicDataResponse<MerchantStore>
    >("/store");

    // Follow the server's copy after a save, so the form never drifts from what
    // was actually stored (a slug can come back normalised, for one). Compared
    // during render against the record we last rendered, rather than synced
    // from an effect that would flash the pre-save values first.
    const [lastStore, setLastStore] = useState(store);
    if (store !== lastStore) {
        setLastStore(store);
        setForm(toForm(store));
    }

    const submit = (event: React.FormEvent) => {
        event.preventDefault();

        const payload = {
            name: form.name.trim(),
            slug: form.slug.trim().toLowerCase(),
            description: form.description.trim(),
            logo_url: form.logo_url.trim(),
            banner_url: form.banner_url.trim(),
            favicon_url: form.favicon_url.trim(),
            phone: form.phone.trim(),
            email: form.email.trim(),
            address: form.address.trim(),
            facebook_url: form.facebook_url.trim(),
            instagram_url: form.instagram_url.trim(),
            whatsapp_number: form.whatsapp_number.trim(),
            delivery_charge: form.delivery_charge,
            free_delivery_over: form.free_delivery_over,
            min_order_amount: form.min_order_amount,
            theme_color: form.theme_color,
            is_active: form.is_active,
        };

        // Validated against the API's own schema before anything is sent, so
        // the merchant sees the message under the field rather than a toast
        // after a round-trip.
        const parsed = updateStoreSchema.safeParse(payload);
        if (!parsed.success) {
            const next: Record<string, string> = {};
            for (const issue of parsed.error.issues) {
                const field = issue.path.join(".");
                if (!next[field]) next[field] = issue.message;
            }
            setErrors(next);
            toast.error("Please fix the highlighted fields");
            return;
        }

        setErrors({});
        save(parsed.data as Record<string, unknown>, {
            onSuccess: () => {
                toast.success("Store settings saved");
                void queryClient.invalidateQueries({ queryKey: ["store"] });
            },
            onError: (error) => toast.error(error.message ?? "Could not save"),
        });
    };

    const urls = storeUrls(form.slug || store.slug);

    return (
        <form onSubmit={submit} className="space-y-4 p-4 sm:space-y-5 sm:p-6">
            <Link
                href="/store"
                className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
                <ChevronLeft className="h-4 w-4" />
                Online store
            </Link>

            <StorePageHeader
                title="Store settings"
                description="How your storefront looks and what it charges for delivery."
                action={
                    <Button type="submit" disabled={isPending} className="gap-2">
                        {isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <Save className="h-4 w-4" />
                        )}
                        Save changes
                    </Button>
                }
            />

            <SettingsSection
                title="Identity"
                description="The name and web address customers see."
            >
                <div className="space-y-4">
                    <Field label="Store name" error={errors.name}>
                        <Input
                            value={form.name}
                            onChange={(e) => set("name", e.target.value)}
                            className="h-10"
                            maxLength={80}
                        />
                    </Field>

                    <Field
                        label="Web address"
                        error={
                            errors.slug ??
                            (slugChanged && slugCheck?.data.available === false
                                ? (slugCheck.data.reason ?? undefined)
                                : undefined)
                        }
                        hint={
                            slugChanged
                                ? "Changing this breaks any link customers have already saved."
                                : urls.path
                        }
                    >
                        <Input
                            value={form.slug}
                            onChange={(e) =>
                                set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
                            }
                            className="h-10 font-mono"
                            maxLength={32}
                        />
                    </Field>

                    <Field label="Description" error={errors.description}>
                        <Textarea
                            value={form.description}
                            onChange={(e) => set("description", e.target.value)}
                            rows={3}
                            maxLength={1000}
                            className="resize-none"
                            placeholder="A line or two about your shop"
                        />
                    </Field>
                </div>
            </SettingsSection>

            <SettingsSection
                title="Look"
                description="Upload images straight from your phone or computer."
            >
                <div className="space-y-4">
                    <ImageUploadField
                        label="Logo"
                        hint="Shown in the storefront header. A transparent PNG works best."
                        value={form.logo_url}
                        onChange={(value) => set("logo_url", value)}
                        error={errors.logo_url}
                    />
                    <ImageUploadField
                        label="Banner"
                        hint="The wide image at the top of your homepage."
                        aspect="wide"
                        value={form.banner_url}
                        onChange={(value) => set("banner_url", value)}
                        error={errors.banner_url}
                    />
                    <ImageUploadField
                        label="Favicon"
                        hint="The small icon in the browser tab."
                        value={form.favicon_url}
                        onChange={(value) => set("favicon_url", value)}
                        error={errors.favicon_url}
                    />

                    <div>
                        <label className="text-sm font-medium">Accent colour</label>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                            Used for buttons and highlights on your storefront.
                        </p>
                        <div className="mt-2 flex items-center gap-3">
                            <input
                                type="color"
                                value={form.theme_color}
                                onChange={(e) => set("theme_color", e.target.value)}
                                aria-label="Accent colour"
                                className="h-10 w-14 cursor-pointer rounded-lg border border-border bg-card p-1"
                            />
                            <Input
                                value={form.theme_color}
                                onChange={(e) => set("theme_color", e.target.value)}
                                className="h-10 w-32 font-mono"
                                maxLength={7}
                            />
                            {errors.theme_color && (
                                <p className="text-xs text-destructive">{errors.theme_color}</p>
                            )}
                        </div>
                    </div>
                </div>
            </SettingsSection>

            <SettingsSection title="Contact" description="Shown in your storefront footer.">
                <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Phone" error={errors.phone}>
                        <Input
                            value={form.phone}
                            onChange={(e) => set("phone", e.target.value)}
                            type="tel"
                            inputMode="numeric"
                            className="h-10 font-mono"
                            maxLength={20}
                        />
                    </Field>
                    <Field label="Email" error={errors.email}>
                        <Input
                            value={form.email}
                            onChange={(e) => set("email", e.target.value)}
                            type="email"
                            className="h-10"
                            maxLength={120}
                        />
                    </Field>
                    <div className="sm:col-span-2">
                        <Field label="Shop address" error={errors.address}>
                            <Input
                                value={form.address}
                                onChange={(e) => set("address", e.target.value)}
                                className="h-10"
                                maxLength={300}
                            />
                        </Field>
                    </div>
                    <Field label="Facebook page URL" error={errors.facebook_url}>
                        <Input
                            value={form.facebook_url}
                            onChange={(e) => set("facebook_url", e.target.value)}
                            placeholder="https://facebook.com/…"
                            inputMode="url"
                            className="h-10"
                        />
                    </Field>
                    <Field label="Instagram URL" error={errors.instagram_url}>
                        <Input
                            value={form.instagram_url}
                            onChange={(e) => set("instagram_url", e.target.value)}
                            placeholder="https://instagram.com/…"
                            inputMode="url"
                            className="h-10"
                        />
                    </Field>
                    <Field
                        label="WhatsApp number"
                        error={errors.whatsapp_number}
                        hint="With country code, e.g. 8801XXXXXXXXX"
                    >
                        <Input
                            value={form.whatsapp_number}
                            onChange={(e) => set("whatsapp_number", e.target.value)}
                            inputMode="numeric"
                            className="h-10 font-mono"
                            maxLength={20}
                        />
                    </Field>
                </div>
            </SettingsSection>

            <SettingsSection
                title="Delivery"
                description="What customers pay for shipping, and the smallest order you accept."
            >
                <div className="grid gap-4 sm:grid-cols-3">
                    <Field
                        label="Delivery charge (৳)"
                        error={errors.delivery_charge}
                        hint="Added to every order."
                    >
                        <Input
                            value={form.delivery_charge}
                            onChange={(e) => set("delivery_charge", e.target.value)}
                            inputMode="decimal"
                            className="h-10 font-mono"
                        />
                    </Field>
                    <Field
                        label="Free delivery over (৳)"
                        error={errors.free_delivery_over}
                        hint="Leave empty to always charge."
                    >
                        <Input
                            value={form.free_delivery_over}
                            onChange={(e) => set("free_delivery_over", e.target.value)}
                            inputMode="decimal"
                            className="h-10 font-mono"
                            placeholder="—"
                        />
                    </Field>
                    <Field
                        label="Minimum order (৳)"
                        error={errors.min_order_amount}
                        hint="0 means no minimum."
                    >
                        <Input
                            value={form.min_order_amount}
                            onChange={(e) => set("min_order_amount", e.target.value)}
                            inputMode="decimal"
                            className="h-10 font-mono"
                        />
                    </Field>
                </div>

                <div className="mt-4 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
                    Payment is cash on delivery only. Customers pay the rider when the order
                    arrives, and the sale is recorded in zPOS when you mark it delivered.
                </div>
            </SettingsSection>

            <SettingsSection
                title="Status"
                description="Switch the storefront off while you restock or go on holiday."
            >
                <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3.5">
                    <div className="flex items-start gap-3">
                        <Power
                            className={`mt-0.5 h-5 w-5 shrink-0 ${
                                form.is_active ? "text-success" : "text-muted-foreground"
                            }`}
                        />
                        <div>
                            <p className="text-sm font-medium">
                                {form.is_active ? "Storefront is live" : "Storefront is off"}
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                                {form.is_active
                                    ? "Customers can browse and place orders."
                                    : "Visitors see a closed-shop page. Existing orders are unaffected."}
                            </p>
                        </div>
                    </div>
                    <Switch
                        checked={form.is_active}
                        onCheckedChange={(checked) => set("is_active", checked)}
                        aria-label="Storefront live"
                    />
                </div>
            </SettingsSection>

            <div className="flex justify-end pb-2">
                <Button type="submit" disabled={isPending} className="h-11 w-full gap-2 sm:w-auto">
                    {isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                        <Save className="h-4 w-4" />
                    )}
                    Save changes
                </Button>
            </div>
        </form>
    );
}

function Field({
    label,
    hint,
    error,
    children,
}: {
    label: string;
    hint?: string;
    error?: string;
    children: React.ReactNode;
}) {
    return (
        <div>
            <label className="text-sm font-medium">{label}</label>
            <div className="mt-1.5">{children}</div>
            {error ? (
                <p className="mt-1 text-xs text-destructive">{error}</p>
            ) : hint ? (
                <p className="mt-1 break-all text-xs text-muted-foreground">{hint}</p>
            ) : null}
        </div>
    );
}
