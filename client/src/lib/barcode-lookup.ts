import { server_URI } from "@/lib/api-request";
import type { CartEntryProduct } from "@/types";

/**
 * What a barcode lookup can come back as.
 *
 * The three outcomes are genuinely different to the person holding the scanner
 * and must not collapse into one "no product" case: a code the shop does not
 * stock is a fact about the label and the scan is finished, whereas a failed
 * request is a fact about the network and the same scan is worth repeating.
 */
export type BarcodeLookup =
  | { status: "found"; product: CartEntryProduct }
  /** Decoded fine, but no product in this shop carries it. */
  | { status: "unknown"; code: string; message: string }
  /** The catalog could not be reached, or the product has no price to sell at. */
  | { status: "error"; code: string; message: string };

/** Resolve a scanned barcode to the cart entry it represents. */
export async function lookupBarcode(
  barcode: string,
  getToken: () => Promise<string | null>,
): Promise<BarcodeLookup> {
  const code = barcode.trim();

  try {
    const token = await getToken();
    const res = await fetch(
      `${server_URI}/products/get/by-barcode/${encodeURIComponent(code)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    const body = (await res.json().catch(() => null)) as
      | { data?: CartEntryProduct; message?: string }
      | null;

    if (res.ok && body?.data) {
      return { status: "found", product: body.data };
    }

    if (res.status === 404) {
      return {
        status: "unknown",
        code,
        message: body?.message ?? `Barcode ${code} is not in your catalog.`,
      };
    }

    return {
      status: "error",
      code,
      message: body?.message ?? "Could not look that barcode up. Try again.",
    };
  } catch {
    return {
      status: "error",
      code,
      message: "Could not reach the catalog. Check your connection and scan again.",
    };
  }
}

/**
 * The cart entry for a barcode, or null for anything else.
 *
 * Kept for callers that only branch on "did this scan produce an item"; anything
 * that reports *why* a scan failed should use `lookupBarcode` directly.
 */
export async function getProductByBarcode(
  barcode: string,
  getToken: () => Promise<string | null>,
): Promise<CartEntryProduct | null> {
  const result = await lookupBarcode(barcode, getToken);
  return result.status === "found" ? result.product : null;
}
