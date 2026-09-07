import { Link } from "wouter";
import { FileText } from "lucide-react";
import type { StorePolicies, StorePublic } from "@myapp/shared";
import { Button } from "@/components/ui/button";
import { useStoreQuery } from "../lib/api";
import { EmptyState } from "../components/primitives";
import { useStoreSeo } from "../lib/seo";

/**
 * The merchant's published policy pages — delivery, returns, terms, privacy.
 *
 * Fetched on their own rather than with the homepage payload: this is the long
 * text, it changes about once a year, and a shopper looks at it perhaps once.
 * Sending it with every storefront request would be pure weight.
 *
 * These pages matter more than their traffic suggests. A shopper deciding
 * whether to trust a shop they have never heard of with a cash-on-delivery
 * order looks for a return policy first, and a footer link that leads nowhere
 * is worse than no link at all — which is why the shell only renders links for
 * pages that actually have content.
 */

export type PolicyKind = keyof StorePolicies;

const TITLES: Record<PolicyKind, string> = {
    deliveryInfo: "Delivery information",
    returnPolicy: "Return policy",
    terms: "Terms and conditions",
    privacyPolicy: "Privacy policy",
};

export default function PolicyPage({
    slug,
    store,
    kind,
}: {
    slug: string;
    store: StorePublic;
    kind: PolicyKind;
}) {
    const title = TITLES[kind];

    const { data, isLoading } = useStoreQuery<StorePolicies>(
        `/storefront/${slug}/policies`,
        ["storefront", slug, "policies"],
        // It changes about once a year; there is no reason to ask again during
        // a shopper's visit.
        { staleTime: 30 * 60 * 1000 },
    );

    useStoreSeo({
        title: `${title} — ${store.name}`,
        description: `${title} for ${store.name}.`,
        favicon: store.faviconUrl ?? store.logoUrl,
    });

    const body = data?.[kind] ?? null;

    return (
        <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:py-9">
            <h1 className="font-serif text-2xl font-semibold sm:text-3xl">{title}</h1>

            {isLoading ? (
                <div className="mt-6 space-y-3">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div
                            key={i}
                            className="h-4 animate-pulse rounded bg-muted"
                            style={{ width: `${90 - (i % 3) * 15}%` }}
                        />
                    ))}
                </div>
            ) : body ? (
                // `whitespace-pre-line` rather than a markdown renderer: the
                // merchant typed this into a plain textarea, so their line
                // breaks are the only formatting there is to honour — and
                // rendering merchant-supplied text as HTML would be an
                // injection hole on every shopper's browser.
                <div className="mt-5 whitespace-pre-line text-sm leading-relaxed text-foreground/90 sm:text-base">
                    {body}
                </div>
            ) : (
                <div className="mt-6">
                    <EmptyState
                        icon={FileText}
                        title="Not published yet"
                        description={`${store.name} has not written this page. Get in touch and they will be glad to help.`}
                        action={
                            <Link href="/">
                                <Button>Back to the shop</Button>
                            </Link>
                        }
                    />
                </div>
            )}
        </div>
    );
}
