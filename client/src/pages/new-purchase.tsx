import { Button } from "@/components/ui/button";
import { Check, ChevronLeft } from "lucide-react";
import BasicDetailsSection from "@/components/purchases/new/basic-details";
import ProductDetailsTable from "@/components/purchases/new/product-details";
import { Link } from "wouter";
import { useForm, type FieldErrors } from "react-hook-form";
import {
  newPurchaseSchema,
  type NewPurchase,
} from "@myapp/shared/schemas/purchase.schema";
import { zodResolver } from "@hookform/resolvers/zod";
import { useGetData, usePostData } from "@/lib/api-request";
import { Form } from "@/components/ui/form";
import { useEffect, useMemo, useState } from "react";
import type { BarcodePrintData, RowData } from "@/types";
import { toast } from "sonner";
import { Spinner } from "@/components/ui/spinner";
import { formatCurrencyInBDT } from "@/lib/utils";

import { DownloadBarcodePDFModal } from "@/components/purchases/download-barcode-modal";

/**
 * The first thing wrong with the order, in words the user can act on.
 *
 * react-hook-form nests errors to mirror the form shape, so `products.0.unitCost`
 * lives three levels down. Without this walk a failed submit was silent: the
 * offending field is inside the items table, which renders no `FormMessage`, so
 * the button looked broken rather than blocked.
 */
function firstErrorMessage(errors: FieldErrors<NewPurchase>): string | null {
  const walk = (node: unknown): string | null => {
    if (!node || typeof node !== "object") return null;
    const record = node as Record<string, unknown>;
    if (typeof record.message === "string" && record.message) return record.message;
    for (const value of Object.values(record)) {
      const found = walk(value);
      if (found) return found;
    }
    return null;
  };
  return walk(errors);
}

export default function NewPurchaseOrderPage() {
  const [open, setOpen] = useState(false);
  const [rowData, setRowData] = useState<RowData[]>([]);
  const { data: itemsData } = useGetData<{
    data: {
      id: string;
      name: string;
      category: {
        id: string;
        name: string;
      };
    }[];
  }>("/products/purchase");

  const {
    mutate: createPurchase,
    isPending: isCreatingPurchase,
    data: barcodeData,
  } = usePostData("/purchase/create");

  const barcodes =
    (barcodeData as { data: { barcodeData: BarcodePrintData[] } })?.data
      ?.barcodeData || [];

  const itemsList = itemsData?.data || [];
  const form = useForm<NewPurchase>({
    resolver: zodResolver(newPurchaseSchema),
    defaultValues: {
      date: new Date(),
      invoiceNo: "",
      supplier: "",
      email: "",
      phone: "",
      note: "",
      products: [],
    },
  });

  useEffect(() => {
    const products = rowData.map((r) => ({
      variantId: r.variantId!,
      quantity: r.quantity,
      unitCost: r.unitCost,
      sellingPrice: r.sellingPrice,
    }));

    form.setValue("products", products, { shouldValidate: true });
  }, [rowData, form]);

  // Mirrors the table's own total, so the figure the user confirms against in
  // the action bar is the one they have been watching while typing.
  const grandTotal = useMemo(
    () =>
      rowData.reduce(
        (sum, r) => sum + (Number(r.quantity) || 0) * (Number(r.unitCost) || 0),
        0,
      ),
    [rowData],
  );

  function onSubmit(data: NewPurchase) {
    createPurchase(data, {
      onSuccess: () => {
        toast.success("Purchase created successfully");
        setOpen(true);
        form.reset();
        setRowData([]);
      },
      onError: (error) => {
        toast.error(error.message || "Failed to create purchase");
      },
    });
  }

  /**
   * Say why the order was not created.
   *
   * A rejected submit is the commonest way this page fails, and react-hook-form
   * resolves it by doing nothing at all — no request, no message. Surfacing the
   * reason here is what stops "Create Purchase Order" reading as a dead button.
   */
  function onInvalid(errors: FieldErrors<NewPurchase>) {
    toast.error(
      firstErrorMessage(errors) ?? "Please check the highlighted fields.",
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit, onInvalid)}>
          {/* Header */}
          <div className="border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 sticky top-0 z-20">
            <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6 sm:py-5">
              <div className="flex items-center gap-3 sm:gap-4">
                <Link href="/purchases">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 shrink-0 -ml-2"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    <span className="hidden sm:inline">Back</span>
                  </Button>
                </Link>
                <div className="min-w-0">
                  <h1 className="truncate text-lg font-bold tracking-tight text-foreground sm:text-2xl">
                    New Purchase Order
                  </h1>
                  <p className="mt-0.5 hidden text-sm text-muted-foreground sm:block">
                    Create a new purchase order for your suppliers
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Main Content */}
          <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-8">
            <div className="space-y-5 sm:space-y-6">
              {/* Section 1: Basic Details */}
              <BasicDetailsSection form={form} />

              {/* Section 2: Product Details */}
              <ProductDetailsTable
                itemsList={itemsList}
                onChange={setRowData}
                value={rowData}
              />

              {/*
                Footer actions.

                Sticks to the bottom of the viewport on a phone: the items table
                grows without limit, and a submit button that scrolls away below
                twenty rows is a button the user has to go looking for.
              */}
              <div className="sticky bottom-0 -mx-4 border-t border-border bg-card/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-card/80 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:pt-2 sm:backdrop-blur-none">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-baseline justify-between gap-2 sm:justify-start sm:gap-3">
                    <span className="text-sm text-muted-foreground">
                      {rowData.length === 0
                        ? "No items yet"
                        : `${rowData.length} item${rowData.length === 1 ? "" : "s"}`}
                    </span>
                    {grandTotal > 0 && (
                      <span className="text-base font-semibold tabular-nums sm:text-lg">
                        {formatCurrencyInBDT(grandTotal)}
                      </span>
                    )}
                  </div>

                  <div className="flex gap-3">
                    <Link href="/purchases" className="flex-1 sm:flex-none">
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full sm:w-auto"
                      >
                        Cancel
                      </Button>
                    </Link>
                    <Button
                      type="submit"
                      className="flex-1 gap-2 font-medium sm:flex-none"
                      disabled={isCreatingPurchase}
                    >
                      {isCreatingPurchase ? (
                        <>
                          <Spinner /> Creating…
                        </>
                      ) : (
                        <>
                          <Check className="h-4 w-4" />
                          Create Purchase Order
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </form>
      </Form>
      <DownloadBarcodePDFModal
        open={open}
        onClose={() => setOpen(false)}
        data={barcodes}
      />
    </div>
  );
}
