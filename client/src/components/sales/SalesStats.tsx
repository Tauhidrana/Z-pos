import type { SaleMetrics } from "@/types";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrencyInBDT } from "@/lib/utils";
import {
  DollarSign,
  Package,
  ShoppingBag,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";

interface StatCardsProps {
  metrics: SaleMetrics;
  isLoading: boolean;
}

export function StatCards({ metrics, isLoading }: StatCardsProps) {
  const stats = [
    {
      label: "Total Revenue",
      value: formatCurrencyInBDT(metrics?.totalRevenue.value || 0),
      change: `${(metrics?.totalRevenue.trend.delta || 0).toFixed(2)}%`,
      up: metrics?.totalRevenue.trend.isPositive,
      icon: DollarSign,
      color:
        "bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400",
    },
    {
      label: "Total Sales",
      value: metrics?.totalSales.value || 0,
      change: `${(metrics?.totalSales.trend.delta || 0).toFixed(2)}%`,
      up: metrics?.totalSales.trend.isPositive,
      icon: ShoppingBag,
      color: "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
    },
    {
      label: "Uncollected Revenue",
      value: formatCurrencyInBDT(metrics?.uncollectedRevenue.value || 0),
      change: `${(metrics?.uncollectedRevenue.trend.delta || 0).toFixed(2)}%`,
      up: metrics?.uncollectedRevenue.trend.isPositive,
      icon: Users,
      color:
        "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400",
    },
    {
      label: "Voided Sales",
      value: metrics?.voidedSales.value || 0,
      change: `${(metrics?.voidedSales.trend.delta || 0).toFixed(2)}%`,
      up: metrics?.voidedSales.trend.isPositive,
      icon: Package,
      color:
        "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400",
    },
  ];

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i} className="bg-card">
            <CardContent className="p-4 sm:p-6">
              <Skeleton className="h-6 w-24 mb-2" />
              <Skeleton className="h-8 w-32 mb-2" />
              <Skeleton className="h-4 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {stats?.map((stat) => (
          <Card key={stat.label} className="border border-border">
            <CardContent className="p-4 sm:p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm text-muted-foreground leading-tight">
                    {stat.label}
                  </p>
                  <p className="text-lg sm:text-2xl font-bold text-foreground mt-1 break-all">
                    {stat.value}
                  </p>
                  <div className="flex items-center gap-1 mt-1.5">
                    {stat.up ? (
                      <TrendingUp className="w-3.5 h-3.5 text-green-500" />
                    ) : (
                      <TrendingDown className="w-3.5 h-3.5 text-red-500" />
                    )}
                    <span
                      className={`text-xs font-medium ${stat.up ? "text-green-600" : "text-red-600"}`}
                    >
                      {stat.change}
                    </span>
                    {/* The comparison label is the first thing to go when a
                        card is only half a phone wide. */}
                    <span className="hidden sm:inline text-xs text-muted-foreground">
                      vs last period
                    </span>
                  </div>
                </div>
                <div className={`hidden sm:block p-2.5 rounded-xl shrink-0 ${stat.color}`}>
                  <stat.icon className="w-5 h-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
