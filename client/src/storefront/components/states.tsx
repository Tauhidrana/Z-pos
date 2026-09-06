import { AlertTriangle, RefreshCw, Store, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StorefrontError } from "../lib/api";

/**
 * The screens a shopper sees when things are not normal.
 *
 * A storefront is the merchant's public face, so none of these may leak a stack
 * trace, an endpoint or an error code — a visitor gets a plain sentence and a
 * way forward, and the console keeps the detail.
 */

function FullScreen({
    icon: Icon,
    title,
    description,
    action,
}: {
    icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
    title: string;
    description: string;
    action?: React.ReactNode;
}) {
    return (
        <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-background px-6 text-center">
            <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
                <Icon className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />
            </div>
            <h1 className="font-serif text-xl font-semibold sm:text-2xl">{title}</h1>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                {description}
            </p>
            {action && <div className="mt-6">{action}</div>}
        </div>
    );
}

export function StoreNotFound({ slug }: { slug: string }) {
    return (
        <FullScreen
            icon={Store}
            title="Shop not found"
            description={`There is no shop at "${slug}". Check the web address, or ask the seller for their link.`}
        />
    );
}

export function StoreClosed({ name }: { name?: string }) {
    return (
        <FullScreen
            icon={Store}
            title="This shop is closed"
            description={`${name ?? "The shop"} is not taking orders at the moment. Please check back later.`}
        />
    );
}

export function StoreLoadError({
    error,
    onRetry,
}: {
    error: StorefrontError;
    onRetry: () => void;
}) {
    const offline = error.code === "NETWORK_ERROR";
    return (
        <FullScreen
            icon={offline ? WifiOff : AlertTriangle}
            title={offline ? "No connection" : "Something went wrong"}
            description={
                offline
                    ? "We could not reach the shop. Check your internet connection and try again."
                    : "The shop could not be loaded just now. Please try again in a moment."
            }
            action={
                <Button onClick={onRetry} className="gap-2">
                    <RefreshCw className="h-4 w-4" />
                    Try again
                </Button>
            }
        />
    );
}

/** Inline version, for a section that failed inside an otherwise working page. */
export function ErrorPanel({
    error,
    onRetry,
}: {
    error: StorefrontError;
    onRetry: () => void;
}) {
    const offline = error.code === "NETWORK_ERROR";
    return (
        <div className="flex flex-col items-center rounded-xl border border-border bg-card px-6 py-12 text-center">
            {offline ? (
                <WifiOff className="mb-3 h-6 w-6 text-muted-foreground" strokeWidth={1.5} />
            ) : (
                <AlertTriangle className="mb-3 h-6 w-6 text-muted-foreground" strokeWidth={1.5} />
            )}
            <p className="text-sm font-medium">
                {offline ? "No connection" : "Could not load this"}
            </p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                {offline
                    ? "Check your internet connection and try again."
                    : "Please try again in a moment."}
            </p>
            <Button variant="outline" onClick={onRetry} className="mt-4 gap-2">
                <RefreshCw className="h-4 w-4" />
                Try again
            </Button>
        </div>
    );
}
