import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/**
 * Pieces shared by the four Online Store pages in the dashboard.
 */

/** Section wrapper matching the card rhythm used across the dashboard. */
export function SettingsSection({
    title,
    description,
    children,
}: {
    title: string;
    description?: string;
    children: React.ReactNode;
}) {
    return (
        <section className="rounded-xl border border-card-border bg-card p-4 sm:p-5">
            <div className="mb-4">
                <h2 className="text-base font-semibold">{title}</h2>
                {description && (
                    <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
                )}
            </div>
            {children}
        </section>
    );
}

/** Copy-to-clipboard button with a two-second confirmation. */
export function CopyButton({
    value,
    label = "Copy",
}: {
    value: string;
    label?: string;
}) {
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (!copied) return;
        const timer = setTimeout(() => setCopied(false), 2000);
        return () => clearTimeout(timer);
    }, [copied]);

    return (
        <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={async () => {
                try {
                    await navigator.clipboard.writeText(value);
                    setCopied(true);
                } catch {
                    // Clipboard access is denied in some embedded browsers and
                    // over plain http. Say so rather than appearing to succeed.
                    toast.error("Could not copy — select the link and copy it manually.");
                }
            }}
        >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : label}
        </Button>
    );
}

export function ExternalLinkButton({ href, label }: { href: string; label: string }) {
    return (
        <a href={href} target="_blank" rel="noreferrer noopener">
            <Button type="button" variant="outline" size="sm" className="gap-1.5">
                <ExternalLink className="h-3.5 w-3.5" />
                {label}
            </Button>
        </a>
    );
}

/** Consistent page header for the Online Store section. */
export function StorePageHeader({
    title,
    description,
    action,
}: {
    title: string;
    description?: string;
    action?: React.ReactNode;
}) {
    return (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
                <h1 className="text-xl font-bold sm:text-2xl">{title}</h1>
                {description && (
                    <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
                )}
            </div>
            {action}
        </div>
    );
}
