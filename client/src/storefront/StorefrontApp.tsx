import { lazy, Suspense, useEffect, useMemo } from "react";
import { Route, Router, Switch, Link } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Compass } from "lucide-react";
import type { StoreHome } from "@myapp/shared";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import type { Tenant } from "@/lib/tenant";
import { useStoreQuery } from "./lib/api";
import { CartContext, useCartState } from "./lib/cart";
import { StoreShell } from "./components/store-shell";
import { EmptyState } from "./components/primitives";
import { StoreClosed, StoreLoadError, StoreNotFound } from "./components/states";
import { applyThemeColorMeta, themeStyle } from "./lib/theme";

/**
 * The public storefront.
 *
 * A separate root from the dashboard rather than another branch inside it. The
 * dashboard's tree is wrapped in Clerk and every one of its data hooks reaches
 * for an auth token; a shopper has no account, so mounting any of that here
 * would be both wrong and expensive — this way an authentication SDK never
 * enters the storefront's bundle at all.
 *
 * Everything below the shell shares one `/storefront/:slug` fetch for the
 * store record and its categories, so the header, footer and nav are painted
 * once and every page reads them from cache.
 */

const ShopPage = lazy(() => import("./pages/shop"));
const ProductPage = lazy(() => import("./pages/product"));
const CartPage = lazy(() => import("./pages/cart"));
const CheckoutPage = lazy(() => import("./pages/checkout"));
const CategoriesPage = lazy(() => import("./pages/categories"));
const StoreHomePage = lazy(() => import("./pages/home"));
const PolicyPage = lazy(() => import("./pages/policy"));

// Storefront traffic is anonymous and read-heavy, and a shopper flicking
// between the grid and a product should not refetch the catalog each time.
const storefrontQueryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 60_000,
            gcTime: 10 * 60 * 1000,
            refetchOnWindowFocus: false,
            refetchOnReconnect: true,
            retry: 1,
        },
        mutations: { retry: 0 },
    },
});

function RouteFallback() {
    return (
        <div className="flex items-center justify-center py-24">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
    );
}

export default function StorefrontApp({ tenant }: { tenant: Extract<Tenant, { mode: "storefront" }> }) {
    return (
        <QueryClientProvider client={storefrontQueryClient}>
            <Router base={tenant.basePath}>
                <StorefrontRoot slug={tenant.slug} basePath={tenant.basePath} />
            </Router>
            <Toaster />
        </QueryClientProvider>
    );
}

function StorefrontRoot({ slug, basePath }: { slug: string; basePath: string }) {
    const cart = useCartState(slug);

    const { data, isLoading, error, refetch } = useStoreQuery<StoreHome>(
        `/storefront/${slug}`,
        ["storefront", slug, "home"],
    );

    const store = data?.store;

    useEffect(() => {
        applyThemeColorMeta(store?.themeColor);
    }, [store?.themeColor]);

    const accent = useMemo(() => themeStyle(store?.themeColor), [store?.themeColor]);

    if (error) {
        if (error.code === "STORE_NOT_FOUND") return <StoreNotFound slug={slug} />;
        if (error.code === "STORE_DISABLED") return <StoreClosed />;
        return <StoreLoadError error={error} onRetry={() => void refetch()} />;
    }

    if (isLoading || !data || !store) {
        return (
            <div className="flex min-h-[100dvh] items-center justify-center bg-background">
                <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
        );
    }

    return (
        <CartContext.Provider value={cart}>
            {/* The merchant's accent is applied as a token override on this
                subtree, so every button, ring and badge below picks it up
                without a single component knowing about themes. */}
            <div style={accent}>
                <StoreShell
                    store={store}
                    categories={data.categories}
                    policies={data.policies}
                    basePath={basePath}
                >
                    <Suspense fallback={<RouteFallback />}>
                        <Switch>
                            <Route path="/">
                                <StoreHomePage data={data} isLoading={false} />
                            </Route>

                            <Route path="/shop">
                                <ShopPage slug={slug} store={store} categories={data.categories} />
                            </Route>

                            <Route path="/category/:categorySlug">
                                {(params) => (
                                    <ShopPage
                                        slug={slug}
                                        store={store}
                                        categories={data.categories}
                                        categorySlug={params.categorySlug}
                                    />
                                )}
                            </Route>

                            <Route path="/categories">
                                <CategoriesPage store={store} categories={data.categories} />
                            </Route>

                            <Route path="/product/:productSlug">
                                {(params) => (
                                    <ProductPage
                                        slug={slug}
                                        store={store}
                                        productSlug={params.productSlug}
                                    />
                                )}
                            </Route>

                            {/* Policy pages. Each renders whatever the merchant
                                published, and says so plainly when they have
                                published nothing. */}
                            <Route path="/delivery">
                                <PolicyPage slug={slug} store={store} kind="deliveryInfo" />
                            </Route>
                            <Route path="/returns">
                                <PolicyPage slug={slug} store={store} kind="returnPolicy" />
                            </Route>
                            <Route path="/terms">
                                <PolicyPage slug={slug} store={store} kind="terms" />
                            </Route>
                            <Route path="/privacy">
                                <PolicyPage slug={slug} store={store} kind="privacyPolicy" />
                            </Route>

                            <Route path="/cart">
                                <CartPage store={store} />
                            </Route>

                            <Route path="/checkout">
                                <CheckoutPage slug={slug} store={store} />
                            </Route>

                            <Route path="/order/:orderNumber">
                                {(params) => (
                                    <OrderRoute
                                        slug={slug}
                                        store={store}
                                        orderNumber={params.orderNumber}
                                    />
                                )}
                            </Route>

                            <Route path="/track">
                                <TrackRoute store={store} />
                            </Route>

                            <Route>
                                <div className="py-6">
                                    <EmptyState
                                        icon={Compass}
                                        title="Page not found"
                                        description="That page does not exist in this shop."
                                        action={
                                            <Link href="/">
                                                <Button>Back to the shop</Button>
                                            </Link>
                                        }
                                    />
                                </div>
                            </Route>
                        </Switch>
                    </Suspense>
                </StoreShell>
            </div>
        </CartContext.Provider>
    );
}

// The order pages are two named exports of one module, which `lazy` cannot
// take directly.
const LazyOrderPage = lazy(() =>
    import("./pages/order").then((m) => ({ default: m.OrderPage })),
);
const LazyTrackPage = lazy(() =>
    import("./pages/order").then((m) => ({ default: m.TrackOrderPage })),
);

function OrderRoute(props: React.ComponentProps<typeof LazyOrderPage>) {
    return <LazyOrderPage {...props} />;
}

function TrackRoute(props: React.ComponentProps<typeof LazyTrackPage>) {
    return <LazyTrackPage {...props} />;
}
