/**
 * Turning a photograph from a merchant's phone into something worth storing.
 *
 * A picture straight off a camera is 4-6 MB and 4000px wide. Sending that as-is
 * would blow past the serverless body limit, sit in the database forever, and
 * take a shopper on a slow connection several seconds to download — for an
 * image rendered at 400px. So every upload is resized and re-encoded in the
 * browser first, which is also the only place the work is free.
 */

const MAX_EDGE = 1400;
/** Aim well under the server's own ceiling, leaving room for base64 overhead. */
const TARGET_BYTES = 400_000;
const MIN_QUALITY = 0.5;

export const ACCEPTED_IMAGE_TYPES = "image/jpeg,image/png,image/webp";

export type UploadedImage = {
    /** `media:<uuid>` — what gets stored and passed around. */
    ref: string;
    width: number | null;
    height: number | null;
};

export class ImageUploadError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ImageUploadError";
    }
}

function readAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new ImageUploadError("That file could not be read."));
        reader.readAsDataURL(file);
    });
}

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () =>
            reject(new ImageUploadError("That file is not an image we can read."));
        img.src = src;
    });
}

/**
 * Resize to fit within MAX_EDGE and re-encode, stepping the quality down until
 * the result is small enough. WebP where the browser supports it, JPEG
 * otherwise — both are a fraction of the size of the PNG a screenshot produces.
 */
export async function compressImage(
    file: File,
): Promise<{ dataUrl: string; width: number; height: number }> {
    if (!file.type.startsWith("image/")) {
        throw new ImageUploadError("Please choose an image file.");
    }
    // A guard before decoding: a 50 MB file would otherwise be read into memory
    // in full just to be rejected.
    if (file.size > 25 * 1024 * 1024) {
        throw new ImageUploadError("That image is too large. Please choose one under 25 MB.");
    }

    const source = await loadImage(await readAsDataUrl(file));

    const scale = Math.min(1, MAX_EDGE / Math.max(source.width, source.height));
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new ImageUploadError("Your browser could not process that image.");

    // A photo scaled down without smoothing looks visibly worse than one that
    // was simply left large, which defeats the point.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, width, height);

    const webpSupported = canvas.toDataURL("image/webp").startsWith("data:image/webp");
    const mime = webpSupported ? "image/webp" : "image/jpeg";

    let quality = 0.86;
    let dataUrl = canvas.toDataURL(mime, quality);

    while (approximateBytes(dataUrl) > TARGET_BYTES && quality > MIN_QUALITY) {
        quality -= 0.12;
        dataUrl = canvas.toDataURL(mime, quality);
    }

    return { dataUrl, width, height };
}

/** base64 length → decoded byte length, close enough for a size check. */
function approximateBytes(dataUrl: string): number {
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    return Math.floor((base64.length * 3) / 4);
}

/**
 * Where an image reference actually points.
 *
 * Uploads are stored as `media:<id>` rather than a URL, so that the database
 * holds no hostname and the same row renders correctly from localhost, from the
 * dashboard, and from any storefront subdomain. This is the one place that
 * turns a stored reference into something an `<img src>` can use.
 */
export function imageSrc(ref: string | null | undefined): string | null {
    if (!ref) return null;
    if (ref.startsWith("media:")) {
        const base = (import.meta.env.VITE_API_URL as string) ?? "/api";
        return `${base}/media/${ref.slice("media:".length)}`;
    }
    // Absolute URLs predate uploads; still rendered, no longer offered.
    return /^https?:\/\//i.test(ref) ? ref : null;
}
