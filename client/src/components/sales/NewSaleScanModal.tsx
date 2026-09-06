import { useCallback, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Check,
  X,
  Plus,
  Minus,
  Trash2,
  ScanLine,
  ShoppingCart,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@clerk/react";
import { cn } from "@/lib/utils";
import { usePostData } from "@/lib/api-request";
import { getProductByBarcode } from "@/lib/barcode-lookup";
import { playSoundWithCacheInstance } from "@/lib/sound";
import { CameraScanner } from "@/components/sales/CameraScanner";
import { CheckoutModal } from "@/components/pos/checkout-modal";
import type { CartEntryProduct, CheckoutPayload } from "@/types";

const BDT = (n: number) =>
  "৳" +
  n.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type SaleLine = { product: CartEntryProduct; qty: number };

type NewSaleScanModalProps = {
  open: boolean;
  onClose: () => void;
  /** Called after the sale is persisted, so the page can refetch its panels. */
  onCreated: () => void;
};

/**
 * Scan-to-sale dialog behind the Sales page's "New Sale" button.
 *
 * Every scan lands in a one-item approval slot rather than going straight into
 * the sale. A camera pointed at a shelf will happily decode a neighbouring
 * label, and a mis-scanned item is only noticed once the customer is charged,
 * so nothing joins the sale until it is explicitly approved.
 */
export function NewSaleScanModal({ open, onClose, onCreated }: NewSaleScanModalProps) {
  const { getToken } = useAuth();
  const [lines, setLines] = useState<SaleLine[]>([]);
  const [pending, setPending] = useState<CartEntryProduct | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  const manualRef = useRef<HTMLInputElement>(null);

  const {
    mutate: createSale,
    isPending: creating,
    isSuccess: created,
    reset: resetCreateSale,
  } = usePostData<unknown, unknown>("/sales/create");

  const total = lines.reduce((sum, l) => sum + l.product.price * l.qty, 0);
  const itemCount = lines.reduce((sum, l) => sum + l.qty, 0);

  // No reset effect is needed: the Sales page only mounts this dialog while it
  // is open, so closing unmounts it and every field starts empty next time. A
  // dialog that reopened holding the previous customer's items would be a real
  // way to charge the wrong person, so that unmount is load-bearing.

  const lookup = useCallback(
    async (code: string) => {
      const trimmed = code.trim();
      if (!trimmed || lookingUp) return;

      setLookingUp(true);
      try {
        const product = await getProductByBarcode(trimmed, getToken);
        if (!product) {
          playSoundWithCacheInstance("error_beep");
          toast.error(`No product found for barcode ${trimmed}`);
          return;
        }
        playSoundWithCacheInstance("beep");
        setPending(product);
      } finally {
        setLookingUp(false);
      }
    },
    [getToken, lookingUp],
  );

  const approvePending = useCallback(() => {
    if (!pending) return;
    setLines((prev) => {
      const existing = prev.find((l) => l.product.variantId === pending.variantId);
      if (existing) {
        return prev.map((l) =>
          l.product.variantId === pending.variantId ? { ...l, qty: l.qty + 1 } : l,
        );
      }
      return [...prev, { product: pending, qty: 1 }];
    });
    playSoundWithCacheInstance("dual_beep");
    setPending(null);
    manualRef.current?.focus();
  }, [pending]);

  const changeQty = (variantId: string, delta: number) =>
    setLines((prev) =>
      prev.flatMap((l) => {
        if (l.product.variantId !== variantId) return [l];
        const next = l.qty + delta;
        return next <= 0 ? [] : [{ ...l, qty: next }];
      }),
    );

  const removeLine = (variantId: string) =>
    setLines((prev) => prev.filter((l) => l.product.variantId !== variantId));

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const code = manualCode.trim();
    if (!code) return;
    setManualCode("");
    void lookup(code);
  };

  const handleConfirmPayment = (payload: CheckoutPayload) => {
    createSale(
      {
        checkout: payload,
        totalAmount: total,
        cartItems: lines.map((l) => ({
          variantId: l.product.variantId,
          quantity: l.qty,
          barcode: l.product.barcode,
          discount: { type: "fixed" as const, amount: 0 },
        })),
      },
      {
        onSuccess: () => {
          playSoundWithCacheInstance("dual_beep");
          toast.success("Sale created");
          setCheckoutOpen(false);
          onCreated();
          onClose();
        },
        onError: (error) => {
          playSoundWithCacheInstance("error_beep");
          toast.error(error.message);
        },
      },
    );
  };

  // A line that outruns its stock is rejected by the server, so flag it here
  // rather than letting the user reach the payment step and fail there.
  const overstocked = lines.filter((l) => l.qty > l.product.availableStock);

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
        <DialogContent className="max-w-3xl gap-0 p-0 sm:p-0">
          <DialogHeader className="border-b px-4 sm:px-6 py-4 text-left">
            <DialogTitle className="flex items-center gap-2">
              <ScanLine className="h-5 w-5 text-primary" />
              New sale — scan items
            </DialogTitle>
            <DialogDescription>
              Scan a barcode with the camera or a USB scanner. Each scan waits for
              your approval before it joins the sale.
            </DialogDescription>
          </DialogHeader>

          <div className="grid max-h-[60dvh] gap-5 sm:gap-6 overflow-y-auto p-4 sm:p-6 md:grid-cols-2">
            {/* ── Scanner column ─────────────────────────────────────────── */}
            <div className="flex flex-col gap-4">
              <CameraScanner onDecode={(code) => void lookup(code)} paused={pending !== null} />

              <form onSubmit={handleManualSubmit} className="flex gap-2">
                <Input
                  ref={manualRef}
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                  placeholder="Or type / scan a barcode…"
                  inputMode="numeric"
                  autoComplete="off"
                  aria-label="Barcode"
                />
                <Button type="submit" variant="secondary" disabled={!manualCode.trim() || lookingUp}>
                  {lookingUp ? <Loader2 className="h-4 w-4 animate-spin" /> : "Find"}
                </Button>
              </form>

              {/* ── Approval slot ────────────────────────────────────────── */}
              {pending ? (
                <div className="rounded-lg border-2 border-primary bg-primary/5 p-4">
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-primary">
                    Scanned — approve to add
                  </p>
                  <p className="font-semibold leading-tight">{pending.name}</p>
                  <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                    {pending.barcode}
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="font-semibold">{BDT(pending.price)}</span>
                    <Badge variant={pending.availableStock > 0 ? "secondary" : "destructive"}>
                      {pending.availableStock > 0
                        ? `${pending.availableStock} in stock`
                        : "Out of stock"}
                    </Badge>
                  </div>

                  <div className="mt-4 flex gap-2">
                    <Button
                      onClick={approvePending}
                      disabled={pending.availableStock <= 0}
                      className="flex-1"
                    >
                      <Check className="mr-2 h-4 w-4" />
                      Approve
                    </Button>
                    <Button variant="outline" onClick={() => setPending(null)} className="flex-1">
                      <X className="mr-2 h-4 w-4" />
                      Discard
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                  Scanned items appear here for approval.
                </div>
              )}
            </div>

            {/* ── Sale lines column ──────────────────────────────────────── */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Items in this sale</h3>
                {itemCount > 0 && (
                  <Badge variant="secondary">
                    {itemCount} item{itemCount === 1 ? "" : "s"}
                  </Badge>
                )}
              </div>

              {lines.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-10 text-center">
                  <ShoppingCart className="h-7 w-7 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Nothing scanned yet</p>
                </div>
              ) : (
                <ul className="flex flex-col gap-2">
                  {lines.map((line) => {
                    const over = line.qty > line.product.availableStock;
                    return (
                      <li
                        key={line.product.variantId}
                        className={cn(
                          "rounded-lg border p-3",
                          over && "border-destructive/50 bg-destructive/5",
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{line.product.name}</p>
                            <p className="font-mono text-[11px] text-muted-foreground">
                              {line.product.barcode}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeLine(line.product.variantId)}
                            className="text-muted-foreground transition hover:text-destructive"
                            aria-label={`Remove ${line.product.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>

                        <div className="mt-2 flex items-center justify-between">
                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => changeQty(line.product.variantId, -1)}
                              aria-label="Decrease quantity"
                            >
                              <Minus className="h-3 w-3" />
                            </Button>
                            <span className="w-8 text-center text-sm font-medium">{line.qty}</span>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => changeQty(line.product.variantId, 1)}
                              aria-label="Increase quantity"
                            >
                              <Plus className="h-3 w-3" />
                            </Button>
                          </div>
                          <span className="text-sm font-semibold">
                            {BDT(line.product.price * line.qty)}
                          </span>
                        </div>

                        {over && (
                          <p className="mt-2 flex items-center gap-1 text-[11px] text-destructive">
                            <AlertTriangle className="h-3 w-3" />
                            Only {line.product.availableStock} in stock
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          {/* ── Footer ───────────────────────────────────────────────────── */}
          <div className="flex flex-col gap-3 border-t bg-muted/30 px-4 sm:px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="flex items-baseline justify-between gap-2 sm:block">
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-xl font-bold">{BDT(total)}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose} className="flex-1 sm:flex-none">
                Cancel
              </Button>
              <Button
                onClick={() => {
                  resetCreateSale();
                  setCheckoutOpen(true);
                }}
                disabled={lines.length === 0 || overstocked.length > 0}
                className="flex-1 sm:flex-none"
              >
                Continue to payment
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <CheckoutModal
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        total={total}
        confirming={creating}
        done={created}
        onConfirm={handleConfirmPayment}
      />
    </>
  );
}
