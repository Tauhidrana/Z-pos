import type { Sale } from "@/types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { RotateCcw, CreditCard } from "lucide-react";
import { formatCurrencyInBDT } from "@/lib/utils";
import { StatusBadgeSales } from "@/components/status-badge";
import Pagination from "../pagination";

interface UrgentTableProps {
  sales: Sale[] | undefined;
  isLoading: boolean;
  page: number;
  limit: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
  onCollectPayment: (sale: Sale) => void;
  onReturn?: (sale: Sale) => void;
}

export function UrgentTable({
  sales,
  isLoading,
  onCollectPayment,
  onPageChange,
  page,
  totalPages,
  limit,
  onLimitChange,
  onReturn,
}: UrgentTableProps) {
  const displaySales = sales || [];

  return (
    <Card className="bg-card">
      <CardHeader>
        <CardTitle className="text-lg font-semibold">
          Urgent Transactions
        </CardTitle>
        <CardDescription>Showing all urgent transactions</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-12 rounded bg-muted animate-pulse" />
            ))}
          </div>
        ) : displaySales.length === 0 ? (
          <p className="py-6 text-center text-muted-foreground">
            No urgent transactions
          </p>
        ) : (
          <div className="">
            {/* Mobile list — the money columns are the point of this panel and
                they are the first thing lost to a sideways scroll. */}
            <div className="space-y-2.5 md:hidden">
              {displaySales.map((sale) => (
                <div
                  key={sale.id}
                  className={`rounded-lg border border-border p-3.5 ${
                    sale.status === "DUE" ? "border-l-4 border-l-red-600" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium leading-tight">
                        {sale.invoiceNumber}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {sale.customerName}
                      </p>
                    </div>
                    <StatusBadgeSales status={sale.status} />
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2 border-t pt-2.5 text-sm">
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

                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onCollectPayment(sale)}
                      className="flex-1"
                    >
                      <CreditCard className="h-3.5 w-3.5 mr-1.5" />
                      Collect
                    </Button>
                    {sale.type === "SALE" && onReturn && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onReturn(sale)}
                        className="flex-1"
                      >
                        <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                        Return
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="overflow-x-auto hidden md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-3 font-semibold">
                      Invoice #
                    </th>
                    <th className="text-left py-2 px-3 font-semibold">
                      Customer
                    </th>
                    <th className="text-right py-2 px-3 font-semibold">
                      Total
                    </th>
                    <th className="text-right py-2 px-3 font-semibold">Paid</th>
                    <th className="text-right py-2 px-3 font-semibold">Due</th>
                    <th className="text-left py-2 px-3 font-semibold">
                      Status
                    </th>
                    <th className="text-center py-2 px-3 font-semibold">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {displaySales.map((sale) => (
                    <tr
                      key={sale.id}
                      className={`border-b border-border hover:bg-muted/50 transition-colors ${
                        sale.status === "DUE"
                          ? "border-l-4 border-l-red-600"
                          : ""
                      }`}
                    >
                      <td className="py-3 px-3 font-medium">
                        {sale.invoiceNumber}
                      </td>
                      <td className="py-3 px-3">{sale.customerName}</td>
                      <td className="py-3 px-3 text-right">
                        {formatCurrencyInBDT(sale.total)}
                      </td>
                      <td className="py-3 px-3 text-right font-medium text-green-600 dark:text-green-400">
                        {formatCurrencyInBDT(sale.paid)}
                      </td>
                      <td className="py-3 px-3 text-right font-medium text-red-600 dark:text-red-400">
                        {formatCurrencyInBDT(sale.due)}
                      </td>
                      <td className="py-3 px-3">
                        <StatusBadgeSales status={sale.status} />
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex flex-wrap justify-center gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onCollectPayment(sale)}
                            className="text-xs"
                            title="Collect Payment"
                          >
                            <CreditCard className="h-3 w-3" />
                          </Button>
                          {sale.type === "SALE" && onReturn && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => onReturn(sale)}
                              className="text-xs"
                              title="Return"
                            >
                              <RotateCcw className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              totalPages={totalPages}
              onPageChange={onPageChange}
              limit={limit}
              onLimitChange={onLimitChange}
              canChangeLimit={false}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
