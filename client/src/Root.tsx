import { lazy, Suspense } from "react";
import { resolveTenant } from "@/lib/tenant";

/**
 * One bundle, two applications.
 *
 * The host and path decide which: `tds.example.com` or `/s/tds` is a merchant's
 * public storefront, anything else is the zPOS dashboard. The decision is made
 * once, before either tree mounts, so the storefront never loads Clerk — a
 * shopper has no account to authenticate, and an auth SDK is a lot of
 * JavaScript to ship to a phone that will never use it.
 *
 * Resolved at module scope rather than in a hook: the answer cannot change
 * without a full page load, and treating it as state would mean rendering the
 * wrong app for one frame.
 */
const tenant = resolveTenant();

const DashboardApp = lazy(() => import("./AppRoot"));
const StorefrontApp = lazy(() => import("./storefront/StorefrontApp"));

function Booting() {
    return (
        <div className="flex min-h-[100dvh] items-center justify-center bg-background">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
    );
}

export default function Root() {
    return (
        <Suspense fallback={<Booting />}>
            {tenant.mode === "storefront" ? (
                // Keyed by slug so the cart, which is stored per store, is
                // structurally tied to the store it belongs to.
                <StorefrontApp key={tenant.slug} tenant={tenant} />
            ) : (
                <DashboardApp />
            )}
        </Suspense>
    );
}
