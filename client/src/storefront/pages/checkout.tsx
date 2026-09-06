import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useForm, useWatch } from "react-hook-form";
import { zod4Resolver } from "@/lib/zod-resolver";
import { Banknote, ChevronLeft, Loader2, ShoppingBag } from "lucide-react";
import type { StorePublic } from "@myapp/shared";
import {
    placeOrderSchema,
    type PlaceOrderPayload,
} from "@myapp/shared/schemas/online-order.schema";
import { BD_DIVISIONS, districtsOf, upazilasOf } from "@myapp/shared/data/bd-geo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useStoreMutation, StorefrontError } from "../lib/api";
import { useCart } from "../lib/cart";
import { formatCurrencyInBDT } from "@/lib/utils";
import { EmptyState, ProductImage } from "../components/primitives";
import { useStoreSeo } from "../lib/seo";

type OrderResponse = {
    orderNumber: string;
    subtotal: number;
    deliveryCharge: number;
    total: number;
    placedAt: string;
};

/**
 * Checkout, built for a Bangladeshi shopper on a phone.
 *
 * One page, no account, no payment step — cash on delivery is the only method,
 * so the whole flow is "who are you, where do we bring it, confirm". The
 * address uses dependent Division → District → Upazila dropdowns validated
 * against the same table the server checks, so what reaches the merchant is
 * always something a courier can act on.
 */
export default function CheckoutPage({
    slug,
    store,
}: {
    slug: string;
    store: StorePublic;
}) {
    const [, navigate] = useLocation();
    const cart = useCart();
    const [submitError, setSubmitError] = useState<StorefrontError | null>(null);

    const placeOrder = useStoreMutation<PlaceOrderPayload, OrderResponse>(
        `/storefront/${slug}/orders`,
    );

    useStoreSeo({
        title: `Checkout — ${store.name}`,
        favicon: store.faviconUrl ?? store.logoUrl,
    });

    const form = useForm<PlaceOrderPayload>({
        // Not `zodResolver` — the installed @hookform/resolvers predates Zod 4
        // and silently renders no messages against it. See zod-resolver.ts.
        resolver: zod4Resolver(placeOrderSchema),
        mode: "onBlur",
        defaultValues: {
            items: [],
            customer: { name: "", phone: "", email: undefined },
            address: {
                division: "",
                district: "",
                upazila: "",
                area: "",
                addressLine: "",
            },
            note: "",
            paymentMethod: "COD",
        },
    });

    // `useWatch` rather than `form.watch`: the latter returns a fresh function
    // on every render, which cannot be memoized and re-subscribes each pass.
    const division = useWatch({ control: form.control, name: "address.division" });
    const district = useWatch({ control: form.control, name: "address.district" });

    const districts = useMemo(() => districtsOf(division), [division]);
    const upazilas = useMemo(() => upazilasOf(division, district), [division, district]);

    // Keep the cart in the form value, so validation sees the real lines rather
    // than a snapshot taken when the page mounted.
    useEffect(() => {
        form.setValue(
            "items",
            cart.lines.map((line) => ({
                variantId: line.variantId,
                quantity: line.quantity,
            })),
        );
    }, [cart.lines, form]);

    if (cart.lines.length === 0 && !placeOrder.isSuccess) {
        return (
            <div className="mx-auto w-full max-w-3xl px-4 py-6">
                <EmptyState
                    icon={ShoppingBag}
                    title="Your cart is empty"
                    description="Add something to your cart before checking out."
                    action={
                        <Link href="/shop">
                            <Button>Browse the shop</Button>
                        </Link>
                    }
                />
            </div>
        );
    }

    const freeDelivery =
        store.freeDeliveryOver != null && cart.subtotal >= store.freeDeliveryOver;
    const deliveryCharge = freeDelivery ? 0 : store.deliveryCharge;
    const total = cart.subtotal + deliveryCharge;

    const onSubmit = (values: PlaceOrderPayload) => {
        setSubmitError(null);
        placeOrder.mutate(values, {
            onSuccess: (order) => {
                // Clear only after the server has the order — a failed request
                // must never cost the shopper their cart.
                cart.clear();
                navigate(
                    `/order/${order.orderNumber}?phone=${encodeURIComponent(values.customer.phone)}`,
                    { replace: true },
                );
            },
            onError: (error) => setSubmitError(error),
        });
    };

    return (
        <div className="mx-auto w-full max-w-5xl px-4 py-5 sm:py-7">
            <Link
                href="/cart"
                className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
                <ChevronLeft className="h-4 w-4" />
                Back to cart
            </Link>

            <h1 className="mb-5 font-serif text-xl font-semibold sm:text-2xl">Checkout</h1>

            <Form {...form}>
                <form
                    onSubmit={form.handleSubmit(onSubmit)}
                    className="grid gap-5 lg:grid-cols-[1fr_360px] lg:gap-8"
                >
                    <div className="space-y-5">
                        <section className="rounded-xl border border-card-border bg-card p-4 sm:p-5">
                            <h2 className="mb-4 font-serif text-base font-semibold">
                                Your details
                            </h2>
                            <div className="space-y-4">
                                <FormField
                                    control={form.control}
                                    name="customer.name"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Full name</FormLabel>
                                            <FormControl>
                                                <Input
                                                    {...field}
                                                    autoComplete="name"
                                                    placeholder="e.g. Rahim Uddin"
                                                    className="h-11"
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="customer.phone"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Mobile number</FormLabel>
                                            <FormControl>
                                                <Input
                                                    {...field}
                                                    // `tel` + numeric keypad: this is the
                                                    // field most likely to be filled with a
                                                    // thumb, and it is digits only.
                                                    type="tel"
                                                    inputMode="numeric"
                                                    autoComplete="tel"
                                                    placeholder="01XXXXXXXXX"
                                                    className="h-11 font-mono"
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="customer.email"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>
                                                Email{" "}
                                                <span className="font-normal text-muted-foreground">
                                                    (optional)
                                                </span>
                                            </FormLabel>
                                            <FormControl>
                                                <Input
                                                    {...field}
                                                    value={field.value ?? ""}
                                                    type="email"
                                                    inputMode="email"
                                                    autoComplete="email"
                                                    placeholder="you@example.com"
                                                    className="h-11"
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>
                        </section>

                        <section className="rounded-xl border border-card-border bg-card p-4 sm:p-5">
                            <h2 className="mb-4 font-serif text-base font-semibold">
                                Delivery address
                            </h2>
                            <div className="space-y-4">
                                <div className="grid gap-4 sm:grid-cols-3">
                                    <FormField
                                        control={form.control}
                                        name="address.division"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Division</FormLabel>
                                                <Select
                                                    value={field.value}
                                                    onValueChange={(value) => {
                                                        field.onChange(value);
                                                        // A district from the old division
                                                        // would not exist in the new one, so
                                                        // both dependents reset together.
                                                        form.setValue("address.district", "");
                                                        form.setValue("address.upazila", "");
                                                    }}
                                                >
                                                    <FormControl>
                                                        <SelectTrigger className="h-11">
                                                            <SelectValue placeholder="Select" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        {BD_DIVISIONS.map((item) => (
                                                            <SelectItem
                                                                key={item.name}
                                                                value={item.name}
                                                            >
                                                                {item.name}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={form.control}
                                        name="address.district"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>District</FormLabel>
                                                <Select
                                                    value={field.value}
                                                    disabled={!division}
                                                    onValueChange={(value) => {
                                                        field.onChange(value);
                                                        form.setValue("address.upazila", "");
                                                    }}
                                                >
                                                    <FormControl>
                                                        <SelectTrigger className="h-11">
                                                            <SelectValue
                                                                placeholder={
                                                                    division
                                                                        ? "Select"
                                                                        : "Choose division"
                                                                }
                                                            />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        {districts.map((item) => (
                                                            <SelectItem
                                                                key={item.name}
                                                                value={item.name}
                                                            >
                                                                {item.name}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={form.control}
                                        name="address.upazila"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Upazila / Thana</FormLabel>
                                                <Select
                                                    value={field.value}
                                                    disabled={!district}
                                                    onValueChange={field.onChange}
                                                >
                                                    <FormControl>
                                                        <SelectTrigger className="h-11">
                                                            <SelectValue
                                                                placeholder={
                                                                    district
                                                                        ? "Select"
                                                                        : "Choose district"
                                                                }
                                                            />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        {upazilas.map((name) => (
                                                            <SelectItem key={name} value={name}>
                                                                {name}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>

                                <FormField
                                    control={form.control}
                                    name="address.area"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>
                                                Area / Village / Road{" "}
                                                <span className="font-normal text-muted-foreground">
                                                    (optional)
                                                </span>
                                            </FormLabel>
                                            <FormControl>
                                                <Input
                                                    {...field}
                                                    value={field.value ?? ""}
                                                    placeholder="e.g. Bank Colony, Road 4"
                                                    className="h-11"
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="address.addressLine"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Full address</FormLabel>
                                            <FormControl>
                                                <Textarea
                                                    {...field}
                                                    rows={3}
                                                    autoComplete="street-address"
                                                    placeholder="House / flat number, road, landmark — anything that helps the rider find you"
                                                    className="resize-none"
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="note"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>
                                                Order note{" "}
                                                <span className="font-normal text-muted-foreground">
                                                    (optional)
                                                </span>
                                            </FormLabel>
                                            <FormControl>
                                                <Textarea
                                                    {...field}
                                                    value={field.value ?? ""}
                                                    rows={2}
                                                    placeholder="Anything the shop should know"
                                                    className="resize-none"
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>
                        </section>

                        <section className="rounded-xl border border-card-border bg-card p-4 sm:p-5">
                            <h2 className="mb-3 font-serif text-base font-semibold">Payment</h2>
                            {/* One method today. Presented as a chosen, checked
                                option rather than a notice, so the layout does
                                not have to change when a gateway is added. */}
                            <div className="flex items-start gap-3 rounded-lg border-2 border-primary bg-primary/5 p-3.5">
                                <Banknote className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                                <div>
                                    <p className="text-sm font-medium">Cash on delivery</p>
                                    <p className="mt-0.5 text-xs text-muted-foreground">
                                        Pay the rider in cash when your order arrives.
                                    </p>
                                </div>
                            </div>
                        </section>
                    </div>

                    {/* Summary. Sticky on desktop; on a phone it simply follows
                        the form, because a pinned panel would eat the screen. */}
                    <aside className="lg:sticky lg:top-24 lg:self-start">
                        <div className="rounded-xl border border-card-border bg-card p-4 sm:p-5">
                            <h2 className="mb-3 font-serif text-base font-semibold">
                                Order summary
                            </h2>

                            <ul className="mb-4 space-y-3">
                                {cart.lines.map((line) => (
                                    <li key={line.variantId} className="flex gap-3">
                                        <div className="w-12 shrink-0">
                                            <ProductImage
                                                src={line.imageUrl}
                                                alt={line.productName}
                                                ratio="square"
                                            />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="line-clamp-2 text-xs font-medium leading-snug">
                                                {line.productName}
                                            </p>
                                            <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                                                {line.quantity} ×{" "}
                                                {formatCurrencyInBDT(line.unitPrice)}
                                            </p>
                                        </div>
                                        <p className="font-mono text-xs font-semibold tabular-nums">
                                            {formatCurrencyInBDT(line.unitPrice * line.quantity)}
                                        </p>
                                    </li>
                                ))}
                            </ul>

                            <dl className="space-y-2 border-t border-border pt-3 text-sm">
                                <div className="flex justify-between">
                                    <dt className="text-muted-foreground">Subtotal</dt>
                                    <dd className="font-mono tabular-nums">
                                        {formatCurrencyInBDT(cart.subtotal)}
                                    </dd>
                                </div>
                                <div className="flex justify-between">
                                    <dt className="text-muted-foreground">Delivery</dt>
                                    <dd className="font-mono tabular-nums">
                                        {freeDelivery ? (
                                            <span className="text-success">Free</span>
                                        ) : (
                                            formatCurrencyInBDT(deliveryCharge)
                                        )}
                                    </dd>
                                </div>
                                <div className="flex justify-between border-t border-border pt-2.5 text-base font-semibold">
                                    <dt>Total</dt>
                                    <dd className="font-mono tabular-nums">
                                        {formatCurrencyInBDT(total)}
                                    </dd>
                                </div>
                            </dl>

                            {submitError && (
                                <p
                                    role="alert"
                                    className="mt-4 rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
                                >
                                    {submitError.message}
                                </p>
                            )}

                            <Button
                                type="submit"
                                disabled={placeOrder.isPending}
                                className="mt-4 h-12 w-full text-base"
                            >
                                {placeOrder.isPending ? (
                                    <>
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Placing order…
                                    </>
                                ) : (
                                    `Place order · ${formatCurrencyInBDT(total)}`
                                )}
                            </Button>

                            <p className="mt-2.5 text-center text-xs text-muted-foreground">
                                No payment now — pay cash on delivery.
                            </p>
                        </div>
                    </aside>
                </form>
            </Form>
        </div>
    );
}
