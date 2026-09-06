import { useState } from "react";
import { Link } from "wouter";
import {
    Ban,
    CheckCircle2,
    ChevronLeft,
    Clock,
    Loader2,
    MapPin,
    Package,
    PackageCheck,
    Phone,
    Receipt,
    Search,
    ShoppingBag,
    Truck,
} from "lucide-react";
import { toast } from "sonner";
import type {
    BasicDataResponse,
    MerchantOrderDetail,
    MerchantOrderRow,
    MerchantOrderStats,
    OnlineOrderStatus,
} from "@/types";
import { useGetData, useListData, usePatchData } from "@/lib/api-request";
import { useDebounce } from "@/hooks/useDebounce";
import { queryClient } from "@/lib/query-client";
import { cn, formatCurrencyInBDT } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { StorePageHeader } from "./store-common";

/**
 * Online orders, in the merchant's dashboard.
 *
 * The status buttons are driven by the same forward-only transition table the
 * server enforces, so the UI cannot offer a move the API will reject — and the
 * two consequential ones say what they will do before they do it: cancelling
 * puts the stock back, and marking delivered writes the sale into the books.
 */

type ListResponse = {
    items: MerchantOrderRow[];
    total: number;
    page: number;
    totalPages: number;
};

const STATUS_META: Record<
    OnlineOrderStatus,
    { label: string; className: string; icon: typeof Clock }
> = {
    PENDING: { label: "Pending", className: "bg-warning/12 text-warning", icon: Clock },
    CONFIRMED: {
        label: "Confirmed",
        className: "bg-primary/12 text-primary",
        icon: CheckCircle2,
    },
    PROCESSING: { label: "Packing", className: "bg-primary/12 text-primary", icon: Package },
    SHIPPED: { label: "Shipped", className: "bg-chart-4/15 text-chart-4", icon: Truck },
    DELIVERED: {
        label: "Delivered",
        className: "bg-success/12 text-success",
        icon: PackageCheck,
    },
    CANCELLED: {
        label: "Cancelled",
        className: "bg-muted text-muted-foreground",
        icon: Ban,
    },
};

/** Mirrors ALLOWED_TRANSITIONS on the server. */
const NEXT_STATUSES: Record<OnlineOrderStatus, OnlineOrderStatus[]> = {
    PENDING: ["CONFIRMED", "PROCESSING", "CANCELLED"],
    CONFIRMED: ["PROCESSING", "SHIPPED", "CANCELLED"],
    PROCESSING: ["SHIPPED", "CANCELLED"],
    SHIPPED: ["DELIVERED", "CANCELLED"],
    DELIVERED: [],
    CANCELLED: [],
};

const TABS = [
    { value: "OPEN", label: "Open" },
    { value: "PENDING", label: "Pending" },
    { value: "SHIPPED", label: "Shipped" },
    { value: "DELIVERED", label: "Delivered" },
    { value: "CANCELLED", label: "Cancelled" },
    { value: "ALL", label: "All" },
] as const;

export function StatusBadge({ status }: { status: OnlineOrderStatus }) {
    const meta = STATUS_META[status];
    return (
        <span
            className={cn(
                "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium",
                meta.className,
            )}
        >
            <meta.icon className="h-3 w-3" />
            {meta.label}
        </span>
    );
}

export default function StoreOrdersPage() {
    const [tab, setTab] = useState<string>("OPEN");
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const [openOrderId, setOpenOrderId] = useState<string | null>(null);

    const debouncedSearch = useDebounce(search, 300);

    // Changing the tab or the search has to send the merchant back to page 1,
    // or a filter applied on page 3 lands them on an empty page. That belongs
    // in the event that changed the query, not in an effect watching it.
    const changeTab = (value: string) => {
        setTab(value);
        setPage(1);
    };
    const changeSearch = (value: string) => {
        setSearch(value);
        setPage(1);
    };

    const query = new URLSearchParams({
        page: String(page),
        limit: "20",
        status: tab,
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
    });

    const { data, isFetching } = useListData<BasicDataResponse<ListResponse>>(
        `/store/orders?${query}`,
        ["store", "orders", query.toString()],
        // Orders arrive while the merchant is looking at the page, so this is
        // the one screen in the section worth polling.
        { refetchInterval: 60_000 },
    );

    const { data: statsRes } = useGetData<BasicDataResponse<MerchantOrderStats>>(
        "/store/orders/stats",
        ["store", "orders", "stats"],
        { refetchInterval: 60_000 },
    );

    const orders = data?.data.items ?? [];
    const totalPages = data?.data.totalPages ?? 1;
    const stats = statsRes?.data;

    return (
        <div className="space-y-4 p-4 sm:space-y-5 sm:p-6">
            <Link
                href="/store"
                className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
                <ChevronLeft className="h-4 w-4" />
                Online store
            </Link>

            <StorePageHeader
                title="Online orders"
                description="Orders placed on your storefront, paid cash on delivery."
            />

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label="Pending" value={stats?.pending} tone="warning" icon={Clock} />
                <Stat label="In progress" value={stats?.processing} icon={Package} />
                <Stat label="Today" value={stats?.ordersToday} icon={ShoppingBag} />
                <Stat
                    label="Delivered revenue"
                    value={stats?.revenue}
                    tone="success"
                    icon={Receipt}
                    money
                />
            </div>

            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
                <div className="-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {TABS.map((option) => (
                        <button
                            key={option.value}
                            type="button"
                            onClick={() => changeTab(option.value)}
                            className={cn(
                                "shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                                tab === option.value
                                    ? "bg-primary/10 text-primary"
                                    : "text-muted-foreground hover:text-foreground",
                            )}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>

                <div className="relative sm:ml-auto sm:w-64">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        value={search}
                        onChange={(e) => changeSearch(e.target.value)}
                        placeholder="Order number, name or phone"
                        className="h-10 pl-9"
                    />
                </div>
            </div>

            {isFetching && orders.length === 0 ? (
                <div className="space-y-2.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                        <Skeleton key={i} className="h-20 w-full rounded-xl" />
                    ))}
                </div>
            ) : orders.length === 0 ? (
                <div className="rounded-xl border border-card-border bg-card py-16 text-center">
                    <ShoppingBag className="mx-auto mb-3 h-9 w-9 text-muted-foreground/40" />
                    <p className="text-sm font-medium">No orders here</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                        {debouncedSearch
                            ? "Nothing matched that search."
                            : tab === "OPEN"
                              ? "No orders are waiting on you right now."
                              : "Orders from your storefront will appear here."}
                    </p>
                </div>
            ) : (
                <>
                    {/* Cards on phones, a table from md up — a seven-column
                        table on a 360px screen can only scroll sideways, which
                        hides the actions the merchant came for. */}
                    <div className={cn("space-y-2.5 md:hidden", isFetching && "opacity-60")}>
                        {orders.map((order) => (
                            <button
                                key={order.id}
                                type="button"
                                onClick={() => setOpenOrderId(order.id)}
                                className="w-full rounded-xl border border-card-border bg-card p-3.5 text-left"
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <p className="font-mono text-sm font-semibold">
                                            {order.orderNumber}
                                        </p>
                                        <p className="mt-0.5 truncate text-sm">
                                            {order.customerName}
                                        </p>
                                        <p className="font-mono text-xs text-muted-foreground">
                                            {order.customerPhone}
                                        </p>
                                    </div>
                                    <StatusBadge status={order.status} />
                                </div>
                                <div className="mt-2.5 flex items-center justify-between text-xs text-muted-foreground">
                                    <span>
                                        {order.itemCount}{" "}
                                        {order.itemCount === 1 ? "item" : "items"} ·{" "}
                                        {formatDate(order.placedAt)}
                                    </span>
                                    <span className="font-mono text-sm font-semibold text-foreground">
                                        {formatCurrencyInBDT(order.total)}
                                    </span>
                                </div>
                            </button>
                        ))}
                    </div>

                    <div
                        className={cn(
                            "hidden overflow-hidden rounded-xl border border-card-border bg-card md:block",
                            isFetching && "opacity-60",
                        )}
                    >
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-border bg-muted/30 text-left text-xs font-medium text-muted-foreground">
                                    <th className="px-4 py-3">Order</th>
                                    <th className="px-4 py-3">Customer</th>
                                    <th className="px-4 py-3">Items</th>
                                    <th className="px-4 py-3">Placed</th>
                                    <th className="px-4 py-3">Status</th>
                                    <th className="px-4 py-3 text-right">Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                {orders.map((order) => (
                                    <tr
                                        key={order.id}
                                        onClick={() => setOpenOrderId(order.id)}
                                        className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/30"
                                    >
                                        <td className="px-4 py-3 font-mono text-sm font-medium">
                                            {order.orderNumber}
                                        </td>
                                        <td className="px-4 py-3">
                                            <p className="text-sm">{order.customerName}</p>
                                            <p className="font-mono text-xs text-muted-foreground">
                                                {order.customerPhone}
                                            </p>
                                        </td>
                                        <td className="px-4 py-3 font-mono text-sm">
                                            {order.itemCount}
                                        </td>
                                        <td className="px-4 py-3 text-sm text-muted-foreground">
                                            {formatDate(order.placedAt)}
                                        </td>
                                        <td className="px-4 py-3">
                                            <StatusBadge status={order.status} />
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono text-sm font-semibold">
                                            {formatCurrencyInBDT(order.total)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}

            {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 pt-1">
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={page <= 1}
                        onClick={() => setPage(page - 1)}
                    >
                        Previous
                    </Button>
                    <span className="font-mono text-sm text-muted-foreground">
                        {page} / {totalPages}
                    </span>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={page >= totalPages}
                        onClick={() => setPage(page + 1)}
                    >
                        Next
                    </Button>
                </div>
            )}

            {openOrderId && (
                <OrderDetailDialog
                    orderId={openOrderId}
                    onClose={() => setOpenOrderId(null)}
                />
            )}
        </div>
    );
}

function Stat({
    label,
    value,
    icon: Icon,
    tone,
    money,
}: {
    label: string;
    value: number | undefined;
    icon: React.ComponentType<{ className?: string }>;
    tone?: "success" | "warning";
    money?: boolean;
}) {
    const toneClass =
        tone === "success"
            ? "text-success"
            : tone === "warning"
              ? "text-warning"
              : "text-primary";

    return (
        <div className="rounded-xl border border-card-border bg-card p-3 sm:p-4">
            <Icon className={cn("h-4 w-4", toneClass)} />
            <div className="mt-2 font-mono text-lg font-bold tabular-nums sm:text-xl">
                {value === undefined ? (
                    <Skeleton className="h-6 w-14" />
                ) : money ? (
                    formatCurrencyInBDT(value)
                ) : (
                    value
                )}
            </div>
            <p className="text-xs leading-tight text-muted-foreground">{label}</p>
        </div>
    );
}

function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
    });
}

// ── Detail ───────────────────────────────────────────────────────────────────

function OrderDetailDialog({
    orderId,
    onClose,
}: {
    orderId: string;
    onClose: () => void;
}) {
    const { data, isLoading } = useGetData<BasicDataResponse<MerchantOrderDetail>>(
        `/store/orders/${orderId}`,
        ["store", "order", orderId],
        { staleTime: 0 },
    );

    const { mutate: updateStatus, isPending } = usePatchData<
        { id: string; status: OnlineOrderStatus },
        BasicDataResponse<{ status: OnlineOrderStatus }>
    >("/store/orders/status");

    const [confirming, setConfirming] = useState<OnlineOrderStatus | null>(null);

    const order = data?.data;

    const apply = (status: OnlineOrderStatus) => {
        updateStatus(
            { id: orderId, status },
            {
                onSuccess: () => {
                    toast.success(
                        status === "DELIVERED"
                            ? "Marked delivered — the sale is now in your books"
                            : status === "CANCELLED"
                              ? "Order cancelled and stock returned"
                              : `Order marked ${STATUS_META[status].label.toLowerCase()}`,
                    );
                    void queryClient.invalidateQueries({ queryKey: ["store", "orders"] });
                    void queryClient.invalidateQueries({ queryKey: ["store", "order", orderId] });
                    // A delivered order writes a Sale and a payment, so the POS
                    // dashboard and sales screens are now out of date too.
                    if (status === "DELIVERED") {
                        void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
                        void queryClient.invalidateQueries({ queryKey: ["sales"] });
                    }
                    setConfirming(null);
                },
                onError: (error) => {
                    toast.error(error.message ?? "Could not update the order");
                    setConfirming(null);
                },
            },
        );
    };

    const onAction = (status: OnlineOrderStatus) => {
        // Both of these have consequences beyond the order row itself, so they
        // ask first rather than firing on a single tap.
        if (status === "CANCELLED" || status === "DELIVERED") {
            setConfirming(status);
            return;
        }
        apply(status);
    };

    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="font-mono">
                        {order?.orderNumber ?? "Order"}
                    </DialogTitle>
                    <DialogDescription>
                        {order
                            ? `Placed ${formatDate(order.placedAt)} · Cash on delivery`
                            : "Loading order…"}
                    </DialogDescription>
                </DialogHeader>

                {isLoading || !order ? (
                    <div className="space-y-3 py-4">
                        <Skeleton className="h-20 w-full" />
                        <Skeleton className="h-32 w-full" />
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge status={order.status} />
                            {order.invoiceNumber && (
                                <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
                                    <Receipt className="h-3 w-3" />
                                    {order.invoiceNumber}
                                </span>
                            )}
                            {order.stockRestored && (
                                <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                                    Stock returned
                                </span>
                            )}
                        </div>

                        <section className="rounded-lg border border-border p-3">
                            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                Customer
                            </h3>
                            <p className="mt-1.5 text-sm font-medium">{order.customerName}</p>
                            <a
                                href={`tel:${order.customerPhone}`}
                                className="mt-0.5 inline-flex items-center gap-1.5 font-mono text-sm text-primary"
                            >
                                <Phone className="h-3.5 w-3.5" />
                                {order.customerPhone}
                            </a>
                            {order.customerEmail && (
                                <p className="mt-0.5 break-all text-xs text-muted-foreground">
                                    {order.customerEmail}
                                </p>
                            )}

                            <div className="mt-3 flex items-start gap-2 border-t border-border pt-3">
                                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                                <address className="text-sm not-italic leading-relaxed text-muted-foreground">
                                    {order.address.addressLine}
                                    <br />
                                    {[
                                        order.address.area,
                                        order.address.upazila,
                                        order.address.district,
                                        order.address.division,
                                    ]
                                        .filter(Boolean)
                                        .join(", ")}
                                </address>
                            </div>

                            {order.note && (
                                <p className="mt-3 rounded-md bg-muted px-3 py-2 text-xs">
                                    <span className="font-medium">Note:</span> {order.note}
                                </p>
                            )}
                        </section>

                        <section className="rounded-lg border border-border p-3">
                            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                Items
                            </h3>
                            <ul className="space-y-2.5">
                                {order.items.map((item) => (
                                    <li key={item.id} className="flex gap-3">
                                        {item.imageUrl && (
                                            <img
                                                src={item.imageUrl}
                                                alt=""
                                                loading="lazy"
                                                className="h-12 w-12 shrink-0 rounded-md border border-border object-cover"
                                            />
                                        )}
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm leading-snug">
                                                {item.productName}
                                            </p>
                                            {item.variantName && (
                                                <p className="text-xs text-muted-foreground">
                                                    {item.variantName}
                                                </p>
                                            )}
                                            <p className="font-mono text-xs text-muted-foreground">
                                                {item.quantity} ×{" "}
                                                {formatCurrencyInBDT(item.unitPrice)}
                                            </p>
                                        </div>
                                        <p className="font-mono text-sm font-semibold tabular-nums">
                                            {formatCurrencyInBDT(item.total)}
                                        </p>
                                    </li>
                                ))}
                            </ul>

                            <dl className="mt-3 space-y-1.5 border-t border-border pt-3 text-sm">
                                <div className="flex justify-between">
                                    <dt className="text-muted-foreground">Subtotal</dt>
                                    <dd className="font-mono tabular-nums">
                                        {formatCurrencyInBDT(order.subtotal)}
                                    </dd>
                                </div>
                                <div className="flex justify-between">
                                    <dt className="text-muted-foreground">Delivery</dt>
                                    <dd className="font-mono tabular-nums">
                                        {formatCurrencyInBDT(order.deliveryCharge)}
                                    </dd>
                                </div>
                                <div className="flex justify-between border-t border-border pt-2 font-semibold">
                                    <dt>Total to collect</dt>
                                    <dd className="font-mono tabular-nums">
                                        {formatCurrencyInBDT(order.total)}
                                    </dd>
                                </div>
                            </dl>
                        </section>

                        {NEXT_STATUSES[order.status].length > 0 ? (
                            <section>
                                <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                    Move this order on
                                </h3>
                                <div className="flex flex-wrap gap-2">
                                    {NEXT_STATUSES[order.status].map((status) => (
                                        <Button
                                            key={status}
                                            type="button"
                                            variant={
                                                status === "CANCELLED"
                                                    ? "outline"
                                                    : status === "DELIVERED"
                                                      ? "default"
                                                      : "secondary"
                                            }
                                            disabled={isPending}
                                            onClick={() => onAction(status)}
                                            className={cn(
                                                "gap-1.5",
                                                status === "CANCELLED" &&
                                                    "text-destructive hover:text-destructive",
                                            )}
                                        >
                                            {isPending && confirming === status ? (
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                            ) : null}
                                            {status === "CANCELLED"
                                                ? "Cancel order"
                                                : `Mark ${STATUS_META[status].label.toLowerCase()}`}
                                        </Button>
                                    ))}
                                </div>
                            </section>
                        ) : (
                            <p className="rounded-lg bg-muted px-3 py-2.5 text-xs text-muted-foreground">
                                {order.status === "DELIVERED"
                                    ? "This order is complete. The sale and its cash payment are recorded in zPOS."
                                    : "This order was cancelled and its stock has been returned."}
                            </p>
                        )}
                    </div>
                )}

                {confirming && order && (
                    <ConfirmDialog
                        status={confirming}
                        total={order.total}
                        isPending={isPending}
                        onCancel={() => setConfirming(null)}
                        onConfirm={() => apply(confirming)}
                    />
                )}
            </DialogContent>
        </Dialog>
    );
}

function ConfirmDialog({
    status,
    total,
    isPending,
    onCancel,
    onConfirm,
}: {
    status: OnlineOrderStatus;
    total: number;
    isPending: boolean;
    onCancel: () => void;
    onConfirm: () => void;
}) {
    const cancelling = status === "CANCELLED";

    return (
        <Dialog open onOpenChange={(open) => !open && onCancel()}>
            <DialogContent className="max-w-sm">
                <DialogHeader>
                    <DialogTitle>
                        {cancelling ? "Cancel this order?" : "Mark as delivered?"}
                    </DialogTitle>
                    <DialogDescription>
                        {cancelling
                            ? "The items go back into your stock straight away, and the customer's order shows as cancelled."
                            : `This records a sale of ${formatCurrencyInBDT(total)} with a cash payment, so it appears in your sales and dashboard. Stock was already deducted when the order was placed.`}
                    </DialogDescription>
                </DialogHeader>
                <div className="mt-2 flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={onCancel}>
                        Go back
                    </Button>
                    <Button
                        type="button"
                        variant={cancelling ? "destructive" : "default"}
                        disabled={isPending}
                        onClick={onConfirm}
                        className="gap-2"
                    >
                        {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                        {cancelling ? "Cancel order" : "Mark delivered"}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
