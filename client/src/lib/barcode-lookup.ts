import { server_URI } from "@/lib/api-request";
import type { CartEntryProduct } from "@/types";

/**
 * Resolve a scanned barcode to the cart entry it represents.
 *
 * Returns `null` when the code is not a live, allocated barcode — the caller
 * decides how to surface that, since the POS grid and the scan-to-sale dialog
 * report it differently.
 */
export async function getProductByBarcode(
  barcode: string,
  getToken: () => Promise<string | null>,
): Promise<CartEntryProduct | null> {
  try {
    const token = await getToken();
    const res = await fetch(
      `${server_URI}/products/get/by-barcode/${encodeURIComponent(barcode)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return null;
    const result: { data: CartEntryProduct } = await res.json();
    return result.data ?? null;
  } catch {
    return null;
  }
}
