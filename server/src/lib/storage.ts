/**
 * Where uploaded images live.
 *
 * Two backends, chosen per upload rather than per deployment:
 *
 *   • Blob storage (Vercel Blob) when `BLOB_READ_WRITE_TOKEN` is set. The image
 *     is served from a CDN, so a storefront homepage full of product
 *     photographs costs this API nothing at all.
 *
 *   • The database, otherwise. That is how every image before this worked, and
 *     it is what keeps local development and self-hosting running with no
 *     object store to configure.
 *
 * The fallback is deliberate rather than a failure mode: a deployment without a
 * blob token still uploads, still serves, and can be switched over later just
 * by setting the variable — old rows keep working either way, because the
 * `media:<id>` reference never encoded which backend held the bytes.
 */

import { put, del } from "@vercel/blob";

export type StoredImage = {
    /** Absolute CDN URL, when the image went to blob storage. */
    url: string | null;
    /** Key within the blob store, kept so the object can be deleted. */
    pathname: string | null;
    /** Bytes, when the image went to the database instead. */
    data: Uint8Array | null;
};

/** Blob storage is available only when a write token is configured. */
export function blobStorageEnabled(): boolean {
    return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

const EXTENSION_BY_MIME: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
};

/**
 * Store one image and say where it went.
 *
 * The key is namespaced by shop so the blob store stays browsable and a shop's
 * objects can be found without consulting the database. `addRandomSuffix` keeps
 * two uploads of the same filename from overwriting each other — and, more
 * importantly, means a key is never guessable from a shop id alone.
 */
export async function storeImage(
    shopId: string,
    mime: string,
    bytes: Buffer,
): Promise<StoredImage> {
    if (!blobStorageEnabled()) {
        return { url: null, pathname: null, data: new Uint8Array(bytes) };
    }

    const extension = EXTENSION_BY_MIME[mime] ?? "bin";
    const result = await put(`shops/${shopId}/${Date.now()}.${extension}`, bytes, {
        access: "public",
        contentType: mime,
        addRandomSuffix: true,
        // The bytes at a key never change — a re-upload writes a new key — so
        // this is safe to cache for as long as the CDN will hold it.
        cacheControlMaxAge: 31_536_000,
    });

    return { url: result.url, pathname: result.pathname, data: null };
}

/**
 * Remove a stored object. Best-effort: a blob that outlives its row costs a
 * little storage, while an error here would fail a merchant's delete for a
 * reason they cannot act on.
 */
export async function deleteStoredImage(url: string | null): Promise<void> {
    if (!url || !blobStorageEnabled()) return;
    try {
        await del(url);
    } catch (err) {
        console.error("[storage] failed to delete blob:", err);
    }
}

/**
 * True when a URL points at our own blob store.
 *
 * Used to decide whether an absolute image reference has to prove ownership.
 * Vercel Blob serves from `<store-id>.public.blob.vercel-storage.com`, and
 * matching the suffix rather than a specific host keeps this correct if the
 * store is ever recreated.
 */
export function isBlobUrl(url: string): boolean {
    try {
        return new URL(url).hostname.endsWith(".blob.vercel-storage.com");
    } catch {
        return false;
    }
}
