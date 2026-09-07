/**
 * Image uploads.
 *
 * Two halves with deliberately different access rules: uploading requires a
 * session and is scoped to that session's shop, while serving is public,
 * because a storefront visitor has no account and still has to see the product
 * photographs.
 *
 * Uploads arrive as base64 inside a JSON body rather than as multipart form
 * data. That is not the obvious choice, but it is the reliable one here: this
 * API runs behind a hand-written serverless bridge (`api/[...route].ts`) that
 * re-serialises whatever Vercel's body helper left behind, and multipart is
 * exactly the shape that has already broken once on that path. JSON is the
 * route every other mutation in this app takes, so it is the route that is
 * known to work.
 */

import type { Context } from "hono";
import prisma from "@/lib/prisma";
import { sendError, sendSuccess } from "@/utils/response";
import type { UploadImage } from "@myapp/shared/schemas/media.schema";
import { MAX_IMAGE_BYTES, ALLOWED_IMAGE_MIMES } from "@myapp/shared/schemas/media.schema";
import { isBlobUrl, storeImage } from "@/lib/storage";

/** `data:image/webp;base64,AAAA…` → mime + raw bytes. */
function decodeDataUrl(
    dataUrl: string,
): { mime: string; bytes: Buffer } | { error: string } {
    const match = /^data:([a-z0-9.+/-]+);base64,(.+)$/i.exec(dataUrl);
    if (!match?.[1] || !match[2]) {
        return { error: "That does not look like an image file." };
    }

    const mime = match[1].toLowerCase();
    if (!ALLOWED_IMAGE_MIMES.includes(mime as (typeof ALLOWED_IMAGE_MIMES)[number])) {
        return { error: "Only JPEG, PNG and WebP images are supported." };
    }

    let bytes: Buffer;
    try {
        bytes = Buffer.from(match[2], "base64");
    } catch {
        return { error: "The image could not be read. Please try another file." };
    }

    if (bytes.length === 0) return { error: "That image file is empty." };
    if (bytes.length > MAX_IMAGE_BYTES) {
        return {
            error: `That image is too large. Please use one under ${Math.round(
                MAX_IMAGE_BYTES / 1024,
            )} kB.`,
        };
    }

    // Trust the bytes, not the declared type: a `data:image/png` header on a
    // PDF would otherwise be stored and later served as an image.
    const sniffed = sniffImageMime(bytes);
    if (!sniffed) return { error: "That file is not a JPEG, PNG or WebP image." };
    if (sniffed !== mime) {
        // Not an error — a browser canvas can legitimately label its output
        // loosely — but the sniffed type is the one we serve with.
        return { mime: sniffed, bytes };
    }

    return { mime, bytes };
}

/** Magic-number check for the three formats we accept. */
function sniffImageMime(bytes: Buffer): string | null {
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return "image/jpeg";
    }
    if (
        bytes.length >= 8 &&
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47
    ) {
        return "image/png";
    }
    if (
        bytes.length >= 12 &&
        bytes.toString("ascii", 0, 4) === "RIFF" &&
        bytes.toString("ascii", 8, 12) === "WEBP"
    ) {
        return "image/webp";
    }
    return null;
}

export const MediaController = {
    /** Store one image against the caller's shop and hand back its token. */
    async upload(c: Context) {
        const shopId = c.get("shopId") as string;
        const body = c.get("validatedBody") as UploadImage;

        const decoded = decodeDataUrl(body.data);
        if ("error" in decoded) {
            return sendError(c, decoded.error, "INVALID_IMAGE", 422);
        }

        // Blob storage when it is configured, the database otherwise. Either
        // way a row is written: it is what records which shop owns the image.
        const stored = await storeImage(shopId, decoded.mime, decoded.bytes);

        const asset = await prisma.mediaAsset.create({
            data: {
                shop_id: shopId,
                mime: decoded.mime,
                size: decoded.bytes.length,
                width: body.width ?? null,
                height: body.height ?? null,
                url: stored.url,
                pathname: stored.pathname,
                // Prisma's Bytes field wants a plain Uint8Array; a Node Buffer
                // is one structurally but carries a wider ArrayBufferLike.
                data: stored.data,
            },
            select: { id: true, mime: true, size: true, width: true, height: true, url: true },
        });

        return sendSuccess(
            c,
            {
                // What the rest of the app stores and passes around.
                //
                // For a blob-backed asset this is the CDN URL itself, so a
                // storefront loads the picture straight from the edge instead of
                // routing every product photograph through this function. It is
                // still ownership-checked on write — see `resolveImageRefs`,
                // which looks the URL up in this table.
                //
                // For a database-backed asset it stays `media:<id>`, which
                // carries no hostname: baking one in would break every image the
                // day the domain changes, and the same row has to render from
                // localhost, the dashboard and every storefront subdomain.
                ref: asset.url ?? `media:${asset.id}`,
                id: asset.id,
                mime: asset.mime,
                size: asset.size,
                width: asset.width,
                height: asset.height,
            },
            "Image uploaded",
            201,
        );
    },

    /**
     * Serve an image. Public and unauthenticated — storefront shoppers have no
     * session, and a product photo is public information by definition.
     *
     * Ids are random UUIDs, so this is not enumerable, and the response carries
     * nothing but the image itself.
     */
    async serve(c: Context) {
        const id = c.req.param("id") ?? "";
        if (!id) return sendError(c, "Not found", "NOT_FOUND", 404);

        const asset = await prisma.mediaAsset.findUnique({
            where: { id },
            select: { mime: true, data: true, size: true, url: true },
        });

        if (!asset) return sendError(c, "Not found", "NOT_FOUND", 404);

        // Blob-backed asset reached through its id rather than its URL. Nothing
        // written today produces such a link, but one may still be sitting in a
        // cache or an old page, so send it on to where the bytes actually are.
        if (asset.url) {
            return c.redirect(asset.url, 301);
        }

        if (!asset.data) return sendError(c, "Not found", "NOT_FOUND", 404);

        const bytes = new Uint8Array(asset.data);

        // The bytes at an id never change — a re-upload gets a new id — so this
        // is safe to cache forever, which keeps a catalog of photographs off the
        // database on every page view.
        return new Response(bytes, {
            status: 200,
            headers: {
                "Content-Type": asset.mime,
                "Content-Length": String(bytes.byteLength),
                "Cache-Control": "public, max-age=31536000, immutable",
                "X-Content-Type-Options": "nosniff",
                // Images are embedded by storefronts on other hostnames.
                "Access-Control-Allow-Origin": "*",
                // CORS alone is not enough for an <img>. `secureHeaders` sets a
                // blanket `Cross-Origin-Resource-Policy: same-origin` and a
                // browser refuses a cross-origin image on that header before it
                // looks at CORS at all. Setting it here is not sufficient
                // either — that middleware runs after this handler and would
                // overwrite it — so app.ts re-sets it from outside. Kept here
                // too so the header is right if this response is used directly.
                "Cross-Origin-Resource-Policy": "cross-origin",
            },
        });
    },
};

/**
 * Confirm every `media:<id>` reference belongs to this shop, and return the
 * values to store. Absolute URLs are passed through so images that predate
 * uploads keep working; anything else is rejected.
 *
 * Without this a caller could attach another shop's uploaded photograph to
 * their own product simply by guessing — or leaking — its id.
 */
export async function resolveImageRefs(
    refs: string[],
    shopId: string,
): Promise<{ ok: true; values: string[] } | { ok: false; error: string }> {
    const ids: string[] = [];
    const blobUrls: string[] = [];

    for (const ref of refs) {
        if (ref.startsWith("media:")) {
            ids.push(ref.slice("media:".length));
        } else if (isBlobUrl(ref)) {
            // An upload of ours, referenced by its CDN URL. Ownership is
            // checked below exactly as it is for `media:<id>` — a blob URL is
            // guessable in principle and belongs to a specific shop.
            blobUrls.push(ref);
        } else if (!/^https?:\/\/\S+$/i.test(ref)) {
            return { ok: false, error: "One of the images is not a valid upload." };
        }
        // Any other absolute URL passes through unchecked. Those predate
        // uploads (seeded catalogues point at external image hosts) and nothing
        // in the UI produces one; they are somebody else's public URL, not one
        // of our assets, so there is no ownership to assert.
    }

    if (ids.length > 0) {
        const owned = await prisma.mediaAsset.findMany({
            where: { id: { in: ids }, shop_id: shopId },
            select: { id: true },
        });
        if (owned.length !== new Set(ids).size) {
            return { ok: false, error: "One of the images could not be found." };
        }
    }

    if (blobUrls.length > 0) {
        const owned = await prisma.mediaAsset.findMany({
            where: { url: { in: blobUrls }, shop_id: shopId },
            select: { url: true },
        });
        if (owned.length !== new Set(blobUrls).size) {
            return { ok: false, error: "One of the images could not be found." };
        }
    }

    return { ok: true, values: refs };
}

/**
 * Turn a stored image reference into a URL a browser can load.
 *
 * Resolved here, on the way out, rather than in each client: the database holds
 * `media:<id>` with no hostname in it, so the same row has to render correctly
 * from localhost, from the dashboard, and from every storefront subdomain. The
 * request's own host is the right answer in all three cases.
 *
 * Absolute URLs are returned untouched — those predate uploads.
 */
export function mediaUrlResolver(c: Context): (ref: string | null | undefined) => string | null {
    const forwardedProto = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim();
    const forwardedHost = c.req.header("x-forwarded-host") ?? c.req.header("host");

    let origin: string;
    if (forwardedHost) {
        const proto = forwardedProto ?? (forwardedHost.startsWith("localhost") ? "http" : "https");
        origin = `${proto}://${forwardedHost}`;
    } else {
        origin = new URL(c.req.url).origin;
    }

    return (ref) => {
        if (!ref) return null;
        if (ref.startsWith("media:")) return `${origin}/api/media/${ref.slice("media:".length)}`;
        return /^https?:\/\//i.test(ref) ? ref : null;
    };
}
