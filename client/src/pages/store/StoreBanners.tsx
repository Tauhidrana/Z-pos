import { useState } from "react";
import { Link } from "wouter";
import {
    ArrowDown,
    ArrowUp,
    ChevronLeft,
    ImagePlus,
    Loader2,
    Pencil,
    Trash2,
} from "lucide-react";
import { toast } from "sonner";
import type { BasicDataResponse, MerchantBanner } from "@/types";
import {
    BANNER_ASPECT_RATIO,
    BANNER_ASPECT_TOLERANCE,
    BANNER_MIN_WIDTH,
    MAX_STORE_BANNERS,
    createBannerSchema,
} from "@myapp/shared/schemas/store.schema";
import { useGetData } from "@/lib/api-request";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { imageSrc } from "@/lib/image-upload";
import { Field, SettingsSection, StorePageHeader } from "./store-common";
import { BannerImagePicker } from "@/components/banner-image-picker";
import { useBannerMutations } from "./use-banner-mutations";

/**
 * Hero banners for the storefront.
 *
 * Reordering is up/down buttons rather than drag-and-drop. With at most five
 * slides a drag surface buys very little, and it costs a lot: dragging is
 * fiddly on the phone most merchants actually run the shop from, and it is
 * invisible to a keyboard or a screen reader. Two buttons work everywhere.
 */

export default function StoreBannersPage() {
    const { data, isPending } = useGetData<BasicDataResponse<MerchantBanner[]>>(
        "/store/banners",
        ["store", "banners"],
    );

    const banners = data?.data ?? [];

    return (
        <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
            <div>
                <Link href="/store">
                    <Button variant="ghost" size="sm" className="-ml-2 gap-1 text-muted-foreground">
                        <ChevronLeft className="h-4 w-4" />
                        Online store
                    </Button>
                </Link>
            </div>

            <StorePageHeader
                title="Banners"
                description={`The slides at the top of your shop front. Up to ${MAX_STORE_BANNERS}.`}
            />

            {isPending ? (
                <div className="space-y-3">
                    {Array.from({ length: 2 }).map((_, i) => (
                        <Skeleton key={i} className="h-40 w-full rounded-xl" />
                    ))}
                </div>
            ) : (
                <BannerList banners={banners} />
            )}
        </div>
    );
}

function BannerList({ banners }: { banners: MerchantBanner[] }) {
    const { create, update, remove, reorder, busy } = useBannerMutations();
    const [adding, setAdding] = useState(false);
    const atLimit = banners.length >= MAX_STORE_BANNERS;

    const move = (index: number, direction: -1 | 1) => {
        const next = [...banners];
        const target = index + direction;
        if (target < 0 || target >= next.length) return;
        const a = next[index];
        const b = next[target];
        if (!a || !b) return;
        next[index] = b;
        next[target] = a;
        reorder(next.map((banner) => banner.id));
    };

    return (
        <>
            {banners.length === 0 && !adding && (
                <SettingsSection title="No banners yet">
                    <div className="flex flex-col items-start gap-3">
                        <p className="text-sm text-muted-foreground">
                            Your shop front currently shows your store name. Add a banner to
                            put your own artwork, a seasonal offer or a new arrival at the
                            top of the page.
                        </p>
                        <Button onClick={() => setAdding(true)} className="gap-1.5">
                            <ImagePlus className="h-4 w-4" />
                            Add your first banner
                        </Button>
                    </div>
                </SettingsSection>
            )}

            <div className="space-y-3">
                {banners.map((banner, index) => (
                    <BannerCard
                        key={banner.id}
                        banner={banner}
                        index={index}
                        total={banners.length}
                        busy={busy}
                        onMove={move}
                        onUpdate={update}
                        onRemove={remove}
                    />
                ))}
            </div>

            {adding && (
                <NewBannerCard
                    onCancel={() => setAdding(false)}
                    onCreate={async (payload) => {
                        await create(payload);
                        setAdding(false);
                    }}
                    busy={busy}
                />
            )}

            {banners.length > 0 && !adding && (
                <Button
                    variant="outline"
                    className="w-full gap-1.5"
                    disabled={atLimit || busy}
                    onClick={() => setAdding(true)}
                >
                    <ImagePlus className="h-4 w-4" />
                    {atLimit ? `Maximum of ${MAX_STORE_BANNERS} banners` : "Add banner"}
                </Button>
            )}
        </>
    );
}

type BannerDraft = {
    image_url: string;
    title: string;
    subtitle: string;
    button_text: string;
    button_link: string;
};

const EMPTY_DRAFT: BannerDraft = {
    image_url: "",
    title: "",
    subtitle: "",
    button_text: "",
    button_link: "",
};

/** Validate a draft through the same schema the server enforces. */
function validateDraft(draft: BannerDraft): Record<string, string> {
    const parsed = createBannerSchema.safeParse(draft);
    if (parsed.success) return {};

    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "");
        if (key && !errors[key]) errors[key] = issue.message;
    }
    return errors;
}

function BannerCard({
    banner,
    index,
    total,
    busy,
    onMove,
    onUpdate,
    onRemove,
}: {
    banner: MerchantBanner;
    index: number;
    total: number;
    busy: boolean;
    onMove: (index: number, direction: -1 | 1) => void;
    onUpdate: (payload: Partial<BannerDraft> & { id: string; is_active?: boolean }) => void;
    onRemove: (id: string) => void;
}) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState<BannerDraft>({
        image_url: banner.imageUrl,
        title: banner.title ?? "",
        subtitle: banner.subtitle ?? "",
        button_text: banner.buttonText ?? "",
        button_link: banner.buttonLink ?? "",
    });
    const [errors, setErrors] = useState<Record<string, string>>({});

    const src = imageSrc(banner.imageUrl);

    return (
        <section className="overflow-hidden rounded-xl border border-card-border bg-card">
            <div className="relative">
                {/* The preview is the real 3:1 hero shape, so what the merchant
                    approves here is what a shopper will actually see. */}
                <div className="aspect-[3/1] w-full bg-muted">
                    {src && (
                        <img
                            src={src}
                            alt={banner.title ?? "Banner"}
                            className="h-full w-full object-cover"
                        />
                    )}
                </div>

                {(banner.title || banner.subtitle || banner.buttonText) && (
                    <div className="pointer-events-none absolute inset-0 flex flex-col justify-center bg-gradient-to-r from-black/55 via-black/25 to-transparent p-4 text-white">
                        {banner.title && (
                            <p className="font-serif text-lg font-semibold leading-tight sm:text-2xl">
                                {banner.title}
                            </p>
                        )}
                        {banner.subtitle && (
                            <p className="mt-1 max-w-sm text-xs leading-snug text-white/85 sm:text-sm">
                                {banner.subtitle}
                            </p>
                        )}
                        {banner.buttonText && (
                            <span className="mt-2 w-fit rounded-md bg-white px-2.5 py-1 text-xs font-medium text-black">
                                {banner.buttonText}
                            </span>
                        )}
                    </div>
                )}

                {!banner.isActive && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/70">
                        <span className="rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background">
                            Hidden
                        </span>
                    </div>
                )}
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-border p-3">
                <span className="font-mono text-xs text-muted-foreground">
                    {index + 1}/{total}
                </span>

                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Move up"
                    disabled={index === 0 || busy}
                    onClick={() => onMove(index, -1)}
                >
                    <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Move down"
                    disabled={index === total - 1 || busy}
                    onClick={() => onMove(index, 1)}
                >
                    <ArrowDown className="h-4 w-4" />
                </Button>

                <div className="ml-auto flex items-center gap-2">
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Switch
                            checked={banner.isActive}
                            disabled={busy}
                            onCheckedChange={(checked) =>
                                onUpdate({ id: banner.id, is_active: checked })
                            }
                            aria-label="Show this banner"
                        />
                        Shown
                    </label>

                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Edit banner"
                        onClick={() => setEditing((open) => !open)}
                    >
                        <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Delete banner"
                        className="text-destructive"
                        disabled={busy}
                        onClick={() => {
                            if (confirm("Remove this banner from your shop front?")) {
                                onRemove(banner.id);
                            }
                        }}
                    >
                        <Trash2 className="h-4 w-4" />
                    </Button>
                </div>
            </div>

            {editing && (
                <div className="space-y-4 border-t border-border p-4">
                    <BannerFields draft={draft} errors={errors} onChange={setDraft} />
                    <div className="flex gap-2">
                        <Button
                            size="sm"
                            disabled={busy}
                            onClick={() => {
                                const found = validateDraft(draft);
                                setErrors(found);
                                if (Object.keys(found).length > 0) return;
                                onUpdate({ id: banner.id, ...draft });
                                setEditing(false);
                            }}
                        >
                            Save
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                                setEditing(false);
                                setErrors({});
                            }}
                        >
                            Cancel
                        </Button>
                    </div>
                </div>
            )}
        </section>
    );
}

function NewBannerCard({
    onCreate,
    onCancel,
    busy,
}: {
    onCreate: (draft: BannerDraft) => Promise<void>;
    onCancel: () => void;
    busy: boolean;
}) {
    const [draft, setDraft] = useState<BannerDraft>(EMPTY_DRAFT);
    const [errors, setErrors] = useState<Record<string, string>>({});

    return (
        <SettingsSection
            title="New banner"
            description="Artwork is required. Everything else is optional — many shops use a banner with the wording already in the image."
        >
            <div className="space-y-4">
                <BannerFields draft={draft} errors={errors} onChange={setDraft} />
                <div className="flex gap-2">
                    <Button
                        disabled={busy}
                        onClick={() => {
                            const found = validateDraft(draft);
                            setErrors(found);
                            if (Object.keys(found).length > 0) {
                                if (found.image_url) toast.error("Upload the banner image first.");
                                return;
                            }
                            void onCreate(draft);
                        }}
                        className="gap-1.5"
                    >
                        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                        Add banner
                    </Button>
                    <Button variant="ghost" onClick={onCancel}>
                        Cancel
                    </Button>
                </div>
            </div>
        </SettingsSection>
    );
}

function BannerFields({
    draft,
    errors,
    onChange,
}: {
    draft: BannerDraft;
    errors: Record<string, string>;
    onChange: (next: BannerDraft) => void;
}) {
    const set = <K extends keyof BannerDraft>(key: K, value: BannerDraft[K]) =>
        onChange({ ...draft, [key]: value });

    return (
        <>
            <BannerImagePicker
                value={draft.image_url}
                onChange={(next) => set("image_url", next)}
                error={errors.image_url}
                expect={{
                    ratio: BANNER_ASPECT_RATIO,
                    tolerance: BANNER_ASPECT_TOLERANCE,
                    minWidth: BANNER_MIN_WIDTH,
                    label: "Banners",
                }}
            />

            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Title" error={errors.title} hint="Optional — leave empty if your artwork already has wording.">
                    <Input
                        value={draft.title}
                        maxLength={80}
                        onChange={(e) => set("title", e.target.value)}
                        placeholder="Eid collection"
                    />
                </Field>
                <Field label="Subtitle" error={errors.subtitle}>
                    <Input
                        value={draft.subtitle}
                        maxLength={160}
                        onChange={(e) => set("subtitle", e.target.value)}
                        placeholder="Up to 40% off"
                    />
                </Field>
                <Field label="Button text" error={errors.button_text}>
                    <Input
                        value={draft.button_text}
                        maxLength={30}
                        onChange={(e) => set("button_text", e.target.value)}
                        placeholder="Shop now"
                    />
                </Field>
                <Field
                    label="Button link"
                    error={errors.button_link}
                    hint="A shop page like /category/shoes, or a full https:// link."
                >
                    <Input
                        value={draft.button_link}
                        onChange={(e) => set("button_link", e.target.value)}
                        placeholder="/shop"
                    />
                </Field>
            </div>
        </>
    );
}
