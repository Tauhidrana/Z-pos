import type { Sale, PaymentStatus } from "@/types";
// import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
// import { Trash2 } from "lucide-react";
import { formatCurrencyInBDT } from "@/lib/utils";
import { StatusBadgeSales } from "@/components/status-badge";
import Pagination from "../pagination";
import { formatDate } from "date-fns";

interface SalesHistoryTableProps {
  sales: Sale[] | undefined;
  page: number;
  isLoading: boolean;
  onSearchChange: (search: string) => void;
  onPageChange: (page: number) => void;
  onStatusChange: (status: PaymentStatus | "ALL") => void;
  onExport: () => void;
  onView: (sale: Sale) => void;
  onDelete: (sale: Sale) => void;
  currentSearch?: string;
  currentStatus?: PaymentStatus | "ALL";
  totalPages: number;
  limit: number;
  onLimitChange: (limit: number) => void;
}

export function SalesHistoryTable({
  sales,
  page,
  totalPages,
  limit,
  onLimitChange,
  isLoading,
  onSearchChange,
  onPageChange,
  onStatusChange,
  onView,
  // onExport,
  // onDelete,
  currentSearch,
  currentStatus,
}: SalesHistoryTableProps) {
  const displaySales = sales || [];

  return (
    <Card className="bg-card">
      <CardHeader>
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base sm:text-lg font-semibold">
              Sales History
            </CardTitle>
            {/* <Button
              size="sm"
              variant="outline"
              onClick={onExport}
              className="flex items-center gap-2"
              disabled={!displaySales.length}
            >
              <Download className="h-4 w-4" />
              Export CSV
            </Button> */}
          </div>

          {/* Filters */}
          <div className="grid gap-3 grid-cols-1 lg:grid-cols-4">
            <div className="lg:col-span-3">
              <Input
                placeholder="Search by customer or invoice..."
                value={currentSearch || ""}
                onChange={(e) => onSearchChange(e.target.value)}
                className="text-xs sm:text-sm"
                disabled={isLoading}
              />
            </div>
            <Select
              value={currentStatus || "ALL"}
              onValueChange={(v) => onStatusChange(v as PaymentStatus | "ALL")}
            >
              <SelectTrigger
                className="text-xs sm:text-sm"
                disabled={isLoading}
              >
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Statuses</SelectItem>
                <SelectItem value="PAID">Paid</SelectItem>
                <SelectItem value="PARTIAL">Partial</SelectItem>
                <SelectItem value="DUE">DUE</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-12 rounded bg-muted animate-pulse" />
            ))}
          </div>
        ) : displaySales.length === 0 ? (
          <p className="py-6 text-center text-muted-foreground">
            No sales found
          </p>
        ) : (
          <div className="space-y-4">
            {/* Mobile list — eight columns of currency cannot be read on a
                phone. Tapping a card opens the same detail view. */}
            <div className="space-y-2.5 md:hidden">
              {displaySales.map((sale) => (
                <button
                  key={sale.id}
                  type="button"
                  onClick={() => onView(sale)}
                  className="w-full rounded-lg border border-border p-3.5 text-left transition-colors hover:bg-muted/50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium leading-tight">
                        {sale.invoiceNumber}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {sale.customerName} ·{" "}
                        {formatDate(new Date(sale.date), "MMM dd, yyyy")}
                      </p>
                    </div>
                    <StatusBadgeSales status={sale.status} />
                  </div>

                  <div className="mt-3 grid grid-cols-4 gap-2 border-t pt-2.5 text-sm">
                    <div>
                      <p className="text-[11px] text-muted-foreground">Items</p>
                      <p className="font-medium">{sale.items}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground">Total</p>
                      <p className="font-medium">
                        {formatCurrencyInBDT(sale.total)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground">Paid</p>
                      <p className="font-medium text-green-600 dark:text-green-400">
                        {formatCurrencyInBDT(sale.paid)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground">Due</p>
                      <p className="font-medium text-red-600 dark:text-red-400">
                        {formatCurrencyInBDT(sale.due)}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            <div className="overflow-x-auto hidden md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-3 font-semibold">
                      Invoice #
                    </th>
                    <th className="text-left py-2 px-3 font-semibold">Date</th>
                    <th className="text-left py-2 px-3 font-semibold">
                      Customer
                    </th>
                    <th className="text-center py-2 px-3 font-semibold">
                      Items
                    </th>
                    <th className="text-right py-2 px-3 font-semibold">
                      Total
                    </th>
                    <th className="text-right py-2 px-3 font-semibold">Paid</th>
                    <th className="text-right py-2 px-3 font-semibold">Due</th>
                    <th className="text-left py-2 px-3 font-semibold">
                      Status
                    </th>
                    {/* <th className="text-center py-2 px-3 font-semibold">
                      Actions
                    </th> */}
                  </tr>
                </thead>
                <tbody>
                  {displaySales.map((sale) => (
                    <tr
                      key={sale.id}
                      onClick={() => onView(sale)}
                      className="border-b border-border hover:bg-muted/50 transition-colors cursor-pointer"
                    >
                      <td className="py-3 px-3 font-medium">
                        {sale.invoiceNumber}
                      </td>
                      <td className="py-3 px-3">
                        {formatDate(new Date(sale.date), "MMM dd, yyyy")}
                      </td>
                      <td className="py-3 px-3">{sale.customerName}</td>
                      <td className="py-3 px-3 text-center">{sale.items}</td>
                      <td className="py-3 px-3 text-right font-medium">
                        {formatCurrencyInBDT(sale.total)}
                      </td>
                      <td className="py-3 px-3 text-right text-green-600 dark:text-green-400">
                        {formatCurrencyInBDT(sale.paid)}
                      </td>
                      <td className="py-3 px-3 text-right text-red-600 dark:text-red-400">
                        {formatCurrencyInBDT(sale.due)}
                      </td>
                      <td className="py-3 px-3">
                        <StatusBadgeSales status={sale.status} />
                      </td>
                      {/* <td className="py-3 px-3">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onDelete(sale)}
                          className="text-xs text-destructive hover:text-destructive"
                          title="Delete"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </td> */}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <Pagination
              page={page}
              onPageChange={onPageChange}
              totalPages={totalPages}
              limit={limit}
              onLimitChange={onLimitChange}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
