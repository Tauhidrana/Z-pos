import { TrendingDown } from "lucide-react";
import type { PurchaseHistory } from "@/types";
import { Skeleton } from "../ui/skeleton";
import { DeleteItemModal } from "../delete-item-model";
import { formatCurrencyInBDT } from "@/lib/utils";

export default function PurchaseHistory({
  purchases,
  isFetching,
  isDeletePending,
  handleDelete,
}: {
  purchases: PurchaseHistory[];
  isFetching: boolean;
  isDeletePending: boolean;
  handleDelete: (id: string) => void;
}) {
  return (
    <div>
      {purchases.length > 0 ? (
        <>
        {/* Mobile list — the six-column table can only scroll sideways here. */}
        <div className="space-y-2.5 md:hidden">
          {isFetching && purchases.length === 0
            ? Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="rounded-lg border border-border p-4 space-y-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              ))
            : purchases.map((p) => (
                <div key={p.id} className="rounded-lg border border-border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium leading-tight break-words">
                        {p.supplier}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {new Date(p.date).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "2-digit",
                        })}
                        {" · "}
                        {p.invoiceNo || "No invoice"}
                      </p>
                    </div>
                    <DeleteItemModal
                      isPending={isDeletePending}
                      handleDelete={handleDelete}
                      id={p.id}
                    />
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t pt-2.5 text-sm">
                    <span className="text-muted-foreground">
                      Items <span className="font-medium text-foreground">{p.items}</span>
                    </span>
                    <span className="font-bold">{formatCurrencyInBDT(p.total)}</span>
                  </div>
                </div>
              ))}
        </div>

        <div className="border border-border rounded-lg overflow-hidden hidden md:block">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">
                    Supplier
                  </th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">
                    Date
                  </th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">
                    Purchased Items
                  </th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">
                    Invoice No
                  </th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">
                    Total
                  </th>

                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {!isFetching &&
                  purchases.length > 0 &&
                  purchases.map((p, idx) => {
                    return (
                      <tr
                        key={p.id}
                        className={`border-b border-border hover:bg-background/50 ${
                          idx % 2 === 0 ? "bg-card/30" : ""
                        }`}
                      >
                        <td className="px-4 py-3 text-sm font-medium">
                          {p.supplier}
                        </td>

                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {new Date(p.date).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "2-digit",
                          })}
                        </td>

                        <td className="px-4 py-3 text-sm text-center font-semibold">
                          {p.items}
                        </td>

                        <td className="px-4 py-3 text-sm text-center font-semibold">
                          {p.invoiceNo || "N/A"}
                        </td>

                        <td className="px-4 py-3 text-sm text-right font-bold">
                          {formatCurrencyInBDT(p.total)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <DeleteItemModal
                            isPending={isDeletePending}
                            handleDelete={handleDelete}
                            id={p.id}
                          />
                        </td>
                      </tr>
                    );
                  })}

                {isFetching &&
                  purchases.length === 0 &&
                  Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i} className="hover:bg-muted/20 transition-colors">
                      {Array.from({ length: 6 }).map((_, idx) => (
                        <td key={idx} className="px-4 py-3">
                          <Skeleton className="h-4 w-20" />
                        </td>
                      ))}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 border border-dashed rounded-lg">
          <TrendingDown className="w-10 h-10 opacity-40 mb-3" />
          <p className="text-muted-foreground">No purchase records found</p>
        </div>
      )}
    </div>
  );
}
