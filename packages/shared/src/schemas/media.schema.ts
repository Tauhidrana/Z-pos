import { z } from "zod";

/**
 * The formats a browser canvas can produce and every phone can display.
 */
export const ALLOWED_IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;

/**
 * Hard ceiling on a stored image, after the client has shrunk it.
 *
 * The client targets well under this (see `compressImage`), so hitting it means
 * something went wrong rather than that a merchant took a big photograph. It
 * also keeps every upload comfortably inside the ~4.5 MB body limit a Vercel
 * function accepts, base64 overhead included.
 */
export const MAX_IMAGE_BYTES = 1_500_000;

/** What the browser posts after resizing and re-encoding the chosen file. */
export const uploadImageSchema = z.object({
    /** `data:image/webp;base64,…` */
    data: z
        .string()
        .min(32, "No image data")
        // ~4/3 base64 overhead, plus the header. Checked here so an oversized
        // payload is refused before it is decoded into memory.
        .max(Math.ceil(MAX_IMAGE_BYTES * 1.4), "That image is too large"),
    width: z.number().int().positive().max(20000).optional(),
    height: z.number().int().positive().max(20000).optional(),
});

export type UploadImage = z.infer<typeof uploadImageSchema>;

/**
 * An image reference as stored in the database: either an upload token or a
 * legacy absolute URL. Written once here so the product, gallery and store
 * settings schemas all agree on what they accept.
 */
export const imageRefSchema = z
    .string()
    .trim()
    .max(2048)
    .refine(
        (v) => /^media:[0-9a-f-]{36}$/i.test(v) || /^https?:\/\/\S+$/i.test(v),
        "Upload an image first",
    );
