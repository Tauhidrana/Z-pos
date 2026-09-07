import { useId, useState } from "react";
import { useAuth } from "@clerk/react";
import { ImagePlus, Loader2, TriangleAlert, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
    ACCEPTED_IMAGE_TYPES,
    ImageUploadError,
    checkImageShape,
    compressImage,
    imageSrc,
} from "@/lib/image-upload";

/**
 * An image slot that knows what shape it expects.
 *
 * The plain `ImageUploadField` is right for a logo or a favicon, where almost
 * any picture works. A banner is different: it is rendered in a fixed 3:1 hero,
 * so a portrait photograph becomes a horizontal strip of whatever happened to
 * be in the middle, and the merchant only finds out by visiting their own shop.
 *
 * So the file is measured before it is uploaded and a mismatch is reported as a
 * warning the merchant can read and act on — not as a refusal. It is their
 * artwork; the job here is to make sure the cropping is not a surprise.
 */

const API_URL = import.meta.env.VITE_API_URL as string;

export function BannerImagePicker({
    value,
    onChange,
    error,
    expect,
    aspectClass = "aspect-[3/1]",
    label = "Banner image",
}: {
    value: string;
    onChange: (next: string) => void;
    error?: string;
    expect: { ratio: number; tolerance: number; minWidth: number; label: string };
    aspectClass?: string;
    label?: string;
}) {
    const { getToken } = useAuth();
    const inputId = useId();
    const [busy, setBusy] = useState(false);
    const [warning, setWarning] = useState<string | null>(null);

    const src = imageSrc(value);

    const handleFile = async (file: File | undefined) => {
        if (!file) return;

        setBusy(true);
        setWarning(null);
        try {
            // Measured first, so the warning is on screen next to the preview
            // the moment the upload lands rather than a beat later.
            const shapeWarning = await checkImageShape(file, expect);

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

            onChange((body as { data: { ref: string } }).data.ref);
            setWarning(shapeWarning);
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

            <div
                className={`relative mt-1.5 w-full overflow-hidden rounded-lg border bg-muted ${aspectClass} ${
                    error ? "border-destructive" : "border-border"
                }`}
            >
                {src ? (
                    <img src={src} alt="" className="h-full w-full object-cover" />
                ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground/50">
                        <ImagePlus className="h-6 w-6" strokeWidth={1.5} />
                        <span className="text-xs">
                            {expect.minWidth}px wide or more works best
                        </span>
                    </div>
                )}
                {busy && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/70">
                        <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    </div>
                )}
            </div>

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

            <div className="mt-2 flex flex-wrap gap-2">
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
                    {src ? "Replace image" : "Upload image"}
                </Button>
            </div>

            {error && <p className="mt-1 text-xs text-destructive">{error}</p>}

            {warning && !error && (
                <p className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground">
                    <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0 text-amber-600" />
                    <span>{warning}</span>
                </p>
            )}
        </div>
    );
}
