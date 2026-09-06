/**
 * Small pieces the storefront reuses everywhere: money, prices, images,
 * quantity steppers, badges and empty states.
 *
 * They lean on the app's existing tokens rather than inventing a second design
 * language — the storefront is meant to read as part of zPOS, not as a template
 * bolted onto it. Numerals are set in the mono face, which is the app's
 * ledger vernacular and happens to keep prices from jittering as they change.
 */

import { useState } from "react";
import { ImageOff, Minus, Plus } from "lucide-react";
import { cn, formatCurrencyInBDT } from "@/lib/utils";

/** Prices, always in the mono face, with the discount rendered as a saving. */
export function Price({
    price,
    compareAtPrice,
    size = "md",
    className,
}: {
    price: number;
    compareAtPrice?: number | null;
    size?: "sm" | "md" | "lg";
    className?: string;
}) {
    const sizes = {
        sm: { now: "text-sm", was: "text-xs" },
        md: { now: "text-base", was: "text-xs" },
        lg: { now: "text-2xl sm:text-3xl", was: "text-sm" },
    }[size];

    return (
        <div className={cn("flex flex-wrap items-baseline gap-x-2 gap-y-0.5", className)}>
            <span className={cn("font-mono font-semibold tabular-nums", sizes.now)}>
                {formatCurrencyInBDT(price)}
            </span>
            {compareAtPrice != null && compareAtPrice > price && (
                <span
                    className={cn(
                        "font-mono tabular-nums text-muted-foreground line-through",
                        sizes.was,
                    )}
                >
                    {formatCurrencyInBDT(compareAtPrice)}
                </span>
            )}
        </div>
    );
}

export function DiscountBadge({ percent }: { percent: number }) {
    return (
        <span className="inline-flex items-center rounded-md bg-destructive px-1.5 py-0.5 font-mono text-[11px] font-semibold leading-none text-destructive-foreground">
            −{percent}%
        </span>
    );
}

export function Pill({
    children,
    tone = "neutral",
    className,
}: {
    children: React.ReactNode;
    tone?: "neutral" | "success" | "warning" | "danger" | "accent";
    className?: string;
}) {
    const tones = {
        neutral: "bg-muted text-muted-foreground",
        success: "bg-success/12 text-success",
        warning: "bg-warning/15 text-warning",
        danger: "bg-destructive/12 text-destructive",
        accent: "bg-primary/12 text-primary",
    }[tone];

    return (
        <span
            className={cn(
                "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium leading-tight",
                tones,
                className,
            )}
        >
            {children}
        </span>
    );
}

/**
 * Product imagery.
 *
 * A fixed aspect ratio on every card is what stops a grid from reflowing as
 * images arrive — merchants upload whatever their phone took, so the ratio
 * cannot be trusted to be consistent. A broken or missing URL falls back to a
 * neutral placeholder rather than a browser's broken-image glyph.
 */
export function ProductImage({
    src,
    alt,
    className,
    ratio = "square",
    priority = false,
    sizes,
}: {
    src: string | null;
    alt: string;
    className?: string;
    ratio?: "square" | "portrait" | "wide";
    priority?: boolean;
    sizes?: string;
}) {
    const [failed, setFailed] = useState(false);
    const ratios = {
        square: "aspect-square",
        portrait: "aspect-[4/5]",
        wide: "aspect-[16/9]",
    }[ratio];

    return (
        <div
            className={cn(
                "relative overflow-hidden rounded-lg bg-muted",
                ratios,
                className,
            )}
        >
            {src && !failed ? (
                <img
                    src={src}
                    alt={alt}
                    sizes={sizes}
                    // Below the fold by default: a catalog page can easily hold
                    // 24 images, and eagerly fetching them all is the single
                    // most expensive thing a phone would do on this page.
                    loading={priority ? "eager" : "lazy"}
                    decoding="async"
                    fetchPriority={priority ? "high" : "auto"}
                    onError={() => setFailed(true)}
                    className="h-full w-full object-cover"
                />
            ) : (
                <div className="flex h-full w-full items-center justify-center text-muted-foreground/40">
                    <ImageOff className="h-7 w-7" strokeWidth={1.5} />
                </div>
            )}
        </div>
    );
}

export function QuantityStepper({
    value,
    onChange,
    max,
    min = 1,
    size = "md",
    disabled,
}: {
    value: number;
    onChange: (next: number) => void;
    max: number;
    min?: number;
    size?: "sm" | "md";
    disabled?: boolean;
}) {
    const button =
        size === "sm"
            ? "h-8 w-8 min-h-8"
            : // 44px: the smallest target that is comfortable with a thumb, and
              // this control is used one-handed more than anything else here.
              "h-11 w-11 min-h-11";

    return (
        <div className="inline-flex items-center rounded-lg border border-border bg-card">
            <button
                type="button"
                aria-label="Decrease quantity"
                disabled={disabled || value <= min}
                onClick={() => onChange(value - 1)}
                className={cn(
                    "flex items-center justify-center rounded-l-lg text-foreground transition-colors disabled:opacity-35",
                    button,
                    "hover-elevate active-elevate-2",
                )}
            >
                <Minus className="h-4 w-4" />
            </button>
            <span
                aria-live="polite"
                className={cn(
                    "min-w-9 text-center font-mono text-sm font-semibold tabular-nums",
                    size === "sm" && "min-w-8 text-xs",
                )}
            >
                {value}
            </span>
            <button
                type="button"
                aria-label="Increase quantity"
                disabled={disabled || value >= max}
                onClick={() => onChange(value + 1)}
                className={cn(
                    "flex items-center justify-center rounded-r-lg text-foreground transition-colors disabled:opacity-35",
                    button,
                    "hover-elevate active-elevate-2",
                )}
            >
                <Plus className="h-4 w-4" />
            </button>
        </div>
    );
}

export function EmptyState({
    icon: Icon,
    title,
    description,
    action,
}: {
    icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
    title: string;
    description?: string;
    action?: React.ReactNode;
}) {
    return (
        <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                <Icon className="h-6 w-6 text-muted-foreground" strokeWidth={1.5} />
            </div>
            <h2 className="font-serif text-lg font-semibold">{title}</h2>
            {description && (
                <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{description}</p>
            )}
            {action && <div className="mt-5">{action}</div>}
        </div>
    );
}

/** A section heading with an optional "see all" affordance. */
export function SectionHeading({
    title,
    subtitle,
    icon,
    action,
}: {
    title: string;
    subtitle?: string;
    icon?: React.ReactNode;
    action?: React.ReactNode;
}) {
    return (
        <div className="mb-3 flex items-end justify-between gap-4 sm:mb-4">
            <div className="min-w-0">
                <h2 className="flex items-center gap-1.5 font-serif text-lg font-semibold leading-tight sm:text-xl">
                    {icon}
                    {title}
                </h2>
                {subtitle && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground sm:text-sm">
                        {subtitle}
                    </p>
                )}
            </div>
            {action}
        </div>
    );
}
