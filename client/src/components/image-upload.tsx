import { useCallback, useId, useRef, useState } from "react";
import { useAuth } from "@clerk/react";
import { ImagePlus, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
    ACCEPTED_IMAGE_TYPES,
    ImageUploadError,
    compressImage,
    imageSrc,
} from "@/lib/image-upload";

/**
 * Picking a photograph, from the merchant's side.
 *
 * Deliberately not a URL box: a shopkeeper's product photos are on their phone,
 * not on a public web server, so asking for a link asks them to solve a hosting
 * problem before they can list anything.
 *
 * The upload is posted directly rather than through the shared api-request
 * hooks, because those are query/mutation shaped and this needs to run inside
 * an event handler for one file at a time, reporting per-file failure.
 */

const API_URL = import.meta.env.VITE_API_URL as string;

function useUploader() {
    const { getToken } = useAuth();

    return useCallback(
        async (file: File): Promise<string> => {
            const { dataUrl, width, height } = await compressImage(file);
            const token = await getToken();

            const res = await fetch(`${API_URL}/media`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({ data: dataUrl, width, height }),
            });

            const body = await res.json().catch(() => null);
            if (!res.ok) {
                throw new ImageUploadError(
                    (body as { message?: string })?.message ??
                        "The image could not be uploaded.",
                );
            }
            return (body as { data: { ref: string } }).data.ref;
        },
        [getToken],
    );
}

/** A single image — a logo, a banner, a favicon. */
export function ImageUploadField({
    label,
    hint,
    value,
    onChange,
    aspect = "square",
    error,
}: {
    label: string;
    hint?: string;
    /** A `media:<id>` reference, or "" for none. */
    value: string;
    onChange: (next: string) => void;
    aspect?: "square" | "wide";
    error?: string;
}) {
    const upload = useUploader();
    const inputId = useId();
    const [busy, setBusy] = useState(false);
    const src = imageSrc(value);

    const handleFile = async (file: File | undefined) => {
        if (!file) return;
        setBusy(true);
        try {
            onChange(await upload(file));
        } catch (err) {
            toast.error(
                err instanceof Error ? err.message : "The image could not be uploaded.",
            );
        } finally {
            setBusy(false);
        }
    };

    return (
        <div>
            <label htmlFor={inputId} className="text-sm font-medium">
                {label}
            </label>
            {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}

            <div className="mt-2 flex items-start gap-3">
                <div
                    className={cn(
                        "relative shrink-0 overflow-hidden rounded-lg border border-border bg-muted",
                        aspect === "wide" ? "h-16 w-28" : "h-16 w-16",
                    )}
                >
                    {src ? (
                        <img src={src} alt="" className="h-full w-full object-cover" />
                    ) : (
                        <div className="flex h-full w-full items-center justify-center text-muted-foreground/40">
                            <ImagePlus className="h-5 w-5" strokeWidth={1.5} />
                        </div>
                    )}
                    {busy && (
                        <div className="absolute inset-0 flex items-center justify-center bg-background/70">
                            <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        </div>
                    )}
                </div>

                <div className="min-w-0 flex-1">
                    <input
                        id={inputId}
                        type="file"
                        accept={ACCEPTED_IMAGE_TYPES}
                        disabled={busy}
                        className="sr-only"
                        onChange={(e) => {
                            void handleFile(e.target.files?.[0]);
                            // Reset so choosing the same file twice still fires.
                            e.target.value = "";
                        }}
                    />
                    <div className="flex flex-wrap gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            className="gap-1.5"
                            onClick={() => document.getElementById(inputId)?.click()}
                        >
                            {busy ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <Upload className="h-3.5 w-3.5" />
                            )}
                            {src ? "Replace" : "Upload"}
                        </Button>
                        {src && (
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={busy}
                                className="gap-1.5 text-destructive"
                                onClick={() => onChange("")}
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                                Remove
                            </Button>
                        )}
                    </div>
                    {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
                </div>
            </div>
        </div>
    );
}

/**
 * A product's gallery. Multiple files at once, reorderable by removal, with the
 * first image being the one every listing shows as the thumbnail.
 */
export function ImageGalleryField({
    value,
    onChange,
    max = 8,
    label = "Photos",
    hint,
}: {
    value: string[];
    onChange: (next: string[]) => void;
    max?: number;
    label?: string;
    hint?: string;
}) {
    const upload = useUploader();
    const inputId = useId();
    const [busy, setBusy] = useState(0);
    const dropRef = useRef<HTMLDivElement>(null);
    const [dragging, setDragging] = useState(false);

    const addFiles = async (files: FileList | File[] | null) => {
        if (!files) return;
        const chosen = Array.from(files).slice(0, Math.max(0, max - value.length));
        if (chosen.length === 0) {
            toast.error(`Up to ${max} photos.`);
            return;
        }

        setBusy((n) => n + chosen.length);
        // Sequential rather than parallel: several full-size images encoding at
        // once will stall a mid-range phone's main thread.
        const added: string[] = [];
        for (const file of chosen) {
            try {
                added.push(await upload(file));
            } catch (err) {
                toast.error(
                    err instanceof Error ? err.message : `${file.name} could not be uploaded.`,
                );
            } finally {
                setBusy((n) => n - 1);
            }
        }
        if (added.length) onChange([...value, ...added]);
    };

    return (
        <div>
            <div className="flex items-baseline justify-between gap-2">
                <label className="text-sm font-medium">{label}</label>
                <span className="font-mono text-xs text-muted-foreground">
                    {value.length}/{max}
                </span>
            </div>
            {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}

            <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {value.map((ref, index) => (
                    <div
                        key={`${ref}-${index}`}
                        className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted"
                    >
                        <img
                            src={imageSrc(ref) ?? ""}
                            alt=""
                            loading="lazy"
                            className="h-full w-full object-cover"
                        />
                        {index === 0 && (
                            <span className="absolute left-1 top-1 rounded bg-foreground/80 px-1.5 py-0.5 text-[10px] font-medium text-background">
                                Main
                            </span>
                        )}
                        <button
                            type="button"
                            aria-label="Remove photo"
                            onClick={() => onChange(value.filter((_, i) => i !== index))}
                            className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-md bg-background/90 text-destructive"
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                        </button>
                    </div>
                ))}

                {Array.from({ length: busy }).map((_, i) => (
                    <div
                        key={`busy-${i}`}
                        className="flex aspect-square items-center justify-center rounded-lg border border-border bg-muted"
                    >
                        <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    </div>
                ))}

                {value.length + busy < max && (
                    <div
                        ref={dropRef}
                        onDragOver={(e) => {
                            e.preventDefault();
                            setDragging(true);
                        }}
                        onDragLeave={() => setDragging(false)}
                        onDrop={(e) => {
                            e.preventDefault();
                            setDragging(false);
                            void addFiles(e.dataTransfer.files);
                        }}
                        className={cn(
                            "flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed transition-colors",
                            dragging ? "border-primary bg-primary/5" : "border-border",
                        )}
                    >
                        <input
                            id={inputId}
                            type="file"
                            accept={ACCEPTED_IMAGE_TYPES}
                            multiple
                            className="sr-only"
                            onChange={(e) => {
                                void addFiles(e.target.files);
                                e.target.value = "";
                            }}
                        />
                        <button
                            type="button"
                            onClick={() => document.getElementById(inputId)?.click()}
                            className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground"
                        >
                            <ImagePlus className="h-5 w-5" strokeWidth={1.5} />
                            <span className="text-[11px] leading-tight">Add photo</span>
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
