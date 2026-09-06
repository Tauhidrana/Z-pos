import { useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import {
    Ban,
    CheckCircle2,
    Clock,
    PackageCheck,
    PackageSearch,
    Truck,
} from "lucide-react";
import type { OnlineOrderStatus, StorePublic, StoreOrderConfirmation } from "@myapp/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatCurrencyInBDT } from "@/lib/utils";
import { useStoreQuery } from "../lib/api";
import { EmptyState, Pill, ProductImage } from "../components/primitives";
import { ErrorPanel } from "../components/states";
import { useStoreSeo } from "../lib/seo";

/**
 * The order page, which doubles as confirmation and as tracking.
 *
 * Order numbers run in sequence, so the phone number is required to view one —
 * without it, anyone could count upwards and read every customer's name and
 * address. The number arrives in the URL straight after checkout, and is asked
 * for when a shopper returns later.
 */

const STATUS_STEPS: { status: OnlineOrderStatus; label: string; icon: typeof Clock }[] = [
    { status: "PENDING", label: "Placed", icon: Clock },
    { status: "CONFIRMED", label: "Confirmed", icon: CheckCircle2 },
    { status: "PROCESSING", label: "Packing", icon: PackageCheck },
    { status: "SHIPPED", label: "On the way", icon: Truck },
    { status: "DELIVERED", label: "Delivered", icon: PackageCheck },
];

export function OrderPage({
    slug,
    store,
    orderNumber,
}: {
    slug: string;
    store: StorePublic;
    orderNumber: string;
}) {
    const search = useSearch();
    const phoneFromUrl = new URLSearchParams(search).get("phone") ?? "";
    const [phone, setPhone] = useState(phoneFromUrl);
    const [submittedPhone, setSubmittedPhone] = useState(phoneFromUrl);

    const { data, isLoading, error, refetch } = useStoreQuery<StoreOrderConfirmation>(
        submittedPhone
            ? `/storefront/${slug}/orders/${encodeURIComponent(orderNumber)}?phone=${encodeURIComponent(submittedPhone)}`
            : null,
        ["storefront", slug, "order", orderNumber, submittedPhone],
        { staleTime: 0 },
    );

    useStoreSeo({
        title: `Order ${orderNumber} — ${store.name}`,
        favicon: store.faviconUrl ?? store.logoUrl,
    });

    if (!submittedPhone) {
        return (
            <PhonePrompt
                orderNumber={orderNumber}
                phone={phone}
                setPhone={setPhone}
                onSubmit={() => setSubmittedPhone(phone.trim())}
            />
        );
    }

    if (isLoading) {
        return (
            <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-7">
                <Skeleton className="h-24 w-full rounded-xl" />
                <Skeleton className="h-40 w-full rounded-xl" />
                <Skeleton className="h-32 w-full rounded-xl" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="mx-auto w-full max-w-2xl px-4 py-7">
                {error.status === 404 ? (
                    <EmptyState
                        icon={PackageSearch}
                        title="Order not found"
                        description="Check the order number and the mobile number you used at checkout."
                        action={
                            <Button
                                variant="outline"
                                onClick={() => {
                                    setSubmittedPhone("");
                                    setPhone("");
                                }}
                            >
                                Try again
                            </Button>
                        }
                    />
                ) : (
                    <ErrorPanel error={error} onRetry={() => void refetch()} />
                )}
            </div>
        );
    }

    if (!data) return null;

    const cancelled = data.status === "CANCELLED";
    const currentStep = STATUS_STEPS.findIndex((step) => step.status === data.status);

    return (
        <div className="mx-auto w-full max-w-2xl px-4 py-5 sm:py-7">
            <div className="rounded-xl border border-card-border bg-card p-5 text-center">
                <div
                    className={cn(
                        "mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full",
                        cancelled ? "bg-destructive/12" : "bg-success/12",
                    )}
                >
                    {cancelled ? (
                        <Ban className="h-6 w-6 text-destructive" />
                    ) : (
                        <CheckCircle2 className="h-6 w-6 text-success" />
                    )}
                </div>
                <h1 className="font-serif text-xl font-semibold sm:text-2xl">
                    {cancelled ? "Order cancelled" : "Order confirmed"}
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    {cancelled
                        ? "This order was cancelled. Nothing will be delivered."
                        : `Thank you, ${data.customerName.split(" ")[0]}. ${store.name} will call you to confirm.`}
                </p>
                <p className="mt-3 font-mono text-sm font-semibold">{data.orderNumber}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                    Placed{" "}
                    {new Date(data.placedAt).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                    })}
                </p>
            </div>

            {!cancelled && (
                <div className="mt-4 rounded-xl border border-card-border bg-card p-4 sm:p-5">
                    <ol className="flex items-start justify-between gap-1">
                        {STATUS_STEPS.map((step, index) => {
                            const done = index <= currentStep;
                            return (
                                <li
                                    key={step.status}
                                    className="flex flex-1 flex-col items-center gap-1.5 text-center"
                                >
                                    <div
                                        className={cn(
                                            "flex h-8 w-8 items-center justify-center rounded-full border-2 transition-colors",
                                            done
                                                ? "border-primary bg-primary text-primary-foreground"
                                                : "border-border text-muted-foreground",
                                        )}
                                    >
                                        <step.icon className="h-3.5 w-3.5" />
                                    </div>
                                    <span
                                        className={cn(
                                            "text-[10px] leading-tight sm:text-xs",
                                            done
                                                ? "font-medium text-foreground"
                                                : "text-muted-foreground",
                                        )}
                                    >
                                        {step.label}
                                    </span>
                                </li>
                            );
                        })}
                    </ol>
                </div>
            )}

            <div className="mt-4 rounded-xl border border-card-border bg-card p-4 sm:p-5">
                <h2 className="mb-3 font-serif text-base font-semibold">Items</h2>
                <ul className="space-y-3">
                    {data.items.map((item, index) => (
                        <li key={`${item.productName}-${index}`} className="flex gap-3">
                            <div className="w-14 shrink-0">
                                <ProductImage
                                    src={item.imageUrl}
                                    alt={item.productName}
                                    ratio="square"
                                />
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium leading-snug">
                                    {item.productName}
                                </p>
                                {item.variantName && (
                                    <p className="text-xs text-muted-foreground">
                                        {item.variantName}
                                    </p>
                                )}
                                <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                                    {item.quantity} × {formatCurrencyInBDT(item.unitPrice)}
                                </p>
                            </div>
                            <p className="font-mono text-sm font-semibold tabular-nums">
                                {formatCurrencyInBDT(item.total)}
                            </p>
                        </li>
                    ))}
                </ul>

                <dl className="mt-4 space-y-2 border-t border-border pt-3 text-sm">
                    <div className="flex justify-between">
                        <dt className="text-muted-foreground">Subtotal</dt>
                        <dd className="font-mono tabular-nums">
                            {formatCurrencyInBDT(data.subtotal)}
                        </dd>
                    </div>
                    <div className="flex justify-between">
                        <dt className="text-muted-foreground">Delivery</dt>
                        <dd className="font-mono tabular-nums">
                            {data.deliveryCharge === 0 ? (
                                <span className="text-success">Free</span>
                            ) : (
                                formatCurrencyInBDT(data.deliveryCharge)
                            )}
                        </dd>
                    </div>
                    <div className="flex justify-between border-t border-border pt-2.5 text-base font-semibold">
                        <dt>Total</dt>
                        <dd className="font-mono tabular-nums">
                            {formatCurrencyInBDT(data.total)}
                        </dd>
                    </div>
                </dl>

                <div className="mt-3">
                    <Pill tone="accent">Cash on delivery</Pill>
                </div>
            </div>

            <div className="mt-4 rounded-xl border border-card-border bg-card p-4 sm:p-5">
                <h2 className="mb-2 font-serif text-base font-semibold">Delivery to</h2>
                <address className="text-sm not-italic leading-relaxed text-muted-foreground">
                    <span className="font-medium text-foreground">{data.customerName}</span>
                    <br />
                    <span className="font-mono">{data.customerPhone}</span>
                    <br />
                    {data.address.addressLine}
                    <br />
                    {[data.address.area, data.address.upazila, data.address.district, data.address.division]
                        .filter(Boolean)
                        .join(", ")}
                </address>
                {data.note && (
                    <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">Note:</span> {data.note}
                    </p>
                )}
            </div>

            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                <Link href="/shop" className="flex-1">
                    <Button variant="outline" className="h-11 w-full">
                        Keep shopping
                    </Button>
                </Link>
                {store.phone && (
                    <a href={`tel:${store.phone}`} className="flex-1">
                        <Button variant="secondary" className="h-11 w-full">
                            Call the shop
                        </Button>
                    </a>
                )}
            </div>
        </div>
    );
}

function PhonePrompt({
    orderNumber,
    phone,
    setPhone,
    onSubmit,
}: {
    orderNumber: string;
    phone: string;
    setPhone: (value: string) => void;
    onSubmit: () => void;
}) {
    return (
        <div className="mx-auto w-full max-w-md px-4 py-10">
            <div className="rounded-xl border border-card-border bg-card p-5 sm:p-6">
                <PackageSearch className="mb-3 h-6 w-6 text-primary" strokeWidth={1.5} />
                <h1 className="font-serif text-lg font-semibold">Track your order</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Enter the mobile number you used when placing order{" "}
                    <span className="font-mono font-medium text-foreground">{orderNumber}</span>.
                </p>
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        if (phone.trim()) onSubmit();
                    }}
                    className="mt-4 space-y-3"
                >
                    <Input
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        type="tel"
                        inputMode="numeric"
                        autoComplete="tel"
                        placeholder="01XXXXXXXXX"
                        aria-label="Mobile number"
                        className="h-11 font-mono"
                    />
                    <Button type="submit" disabled={!phone.trim()} className="h-11 w-full">
                        View order
                    </Button>
                </form>
            </div>
        </div>
    );
}

/** The standalone "find my order" page, reached from the footer. */
export function TrackOrderPage({ store }: { store: StorePublic }) {
    const [, navigate] = useLocation();
    const [orderNumber, setOrderNumber] = useState("");
    const [phone, setPhone] = useState("");

    useStoreSeo({
        title: `Track your order — ${store.name}`,
        favicon: store.faviconUrl ?? store.logoUrl,
    });

    return (
        <div className="mx-auto w-full max-w-md px-4 py-10">
            <div className="rounded-xl border border-card-border bg-card p-5 sm:p-6">
                <PackageSearch className="mb-3 h-6 w-6 text-primary" strokeWidth={1.5} />
                <h1 className="font-serif text-lg font-semibold">Track your order</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Enter your order number and the mobile number you ordered with.
                </p>
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        const trimmed = orderNumber.trim().toUpperCase();
                        if (!trimmed || !phone.trim()) return;
                        // Routed rather than assembled by hand: wouter's base
                        // already carries `/s/<slug>` on the path form, so this
                        // one line is correct on a subdomain too.
                        navigate(
                            `/order/${encodeURIComponent(trimmed)}?phone=${encodeURIComponent(phone.trim())}`,
                        );
                    }}
                    className="mt-4 space-y-3"
                >
                    <Input
                        value={orderNumber}
                        onChange={(e) => setOrderNumber(e.target.value)}
                        placeholder="ORD-001001"
                        aria-label="Order number"
                        className="h-11 font-mono"
                    />
                    <Input
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        type="tel"
                        inputMode="numeric"
                        placeholder="01XXXXXXXXX"
                        aria-label="Mobile number"
                        className="h-11 font-mono"
                    />
                    <Button
                        type="submit"
                        disabled={!orderNumber.trim() || !phone.trim()}
                        className="h-11 w-full"
                    >
                        Find my order
                    </Button>
                </form>
            </div>
        </div>
    );
}
