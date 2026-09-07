import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import {
    Clock,
    Facebook,
    Home,
    Instagram,
    LayoutGrid,
    Mail,
    MapPin,
    MessageCircle,
    Phone,
    Search,
    ShoppingBag,
    Store as StoreIcon,
    X,
} from "lucide-react";
import type { StoreCategory, StorePolicyFlags, StorePublic } from "@myapp/shared";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCart } from "../lib/cart";

/**
 * The storefront chrome.
 *
 * Two navigation systems, because the two form factors want different things:
 * a compact sticky header with an inline search on desktop, and on a phone a
 * slim header plus a bottom tab bar — thumbs reach the bottom of a phone, not
 * the top, and this is the same pattern the zPOS app itself uses on mobile.
 */

function CartBadge({ count }: { count: number }) {
    if (count === 0) return null;
    return (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-mono text-[10px] font-semibold leading-none text-primary-foreground">
            {count > 99 ? "99+" : count}
        </span>
    );
}

function StoreLogo({ store, className }: { store: StorePublic; className?: string }) {
    const [failed, setFailed] = useState(false);

    if (store.logoUrl && !failed) {
        return (
            <img
                src={store.logoUrl}
                alt={store.name}
                onError={() => setFailed(true)}
                className={cn("h-8 w-auto max-w-[150px] object-contain sm:h-9", className)}
            />
        );
    }

    // No logo yet is the common case on day one, so the fallback has to look
    // deliberate rather than broken: the store's name, set in the display face.
    return (
        <span
            className={cn(
                "truncate font-serif text-base font-semibold leading-tight sm:text-lg",
                className,
            )}
        >
            {store.name}
        </span>
    );
}

export function StoreShell({
    store,
    categories,
    policies,
    basePath,
    children,
}: {
    store: StorePublic;
    categories: StoreCategory[];
    policies: StorePolicyFlags;
    basePath: string;
    children: React.ReactNode;
}) {
    const [location, navigate] = useLocation();
    const search = useSearch();
    const cart = useCart();
    const [searchOpen, setSearchOpen] = useState(false);
    const [query, setQuery] = useState("");
    const searchInputRef = useRef<HTMLInputElement>(null);

    // Keep the field in step with the URL, so arriving on /shop?search=shirt
    // (or pressing back) shows what is actually being searched.
    //
    // Adjusted during render against the previous URL value rather than in an
    // effect: an effect would paint the stale text first and then correct it,
    // and React re-runs this component before committing anything to the DOM.
    const urlQuery = new URLSearchParams(search).get("search") ?? "";
    const [lastUrlQuery, setLastUrlQuery] = useState(urlQuery);
    if (urlQuery !== lastUrlQuery) {
        setLastUrlQuery(urlQuery);
        setQuery(urlQuery);
    }

    useEffect(() => {
        if (searchOpen) searchInputRef.current?.focus();
    }, [searchOpen]);

    const submitSearch = (event: React.FormEvent) => {
        event.preventDefault();
        const trimmed = query.trim();
        navigate(trimmed ? `/shop?search=${encodeURIComponent(trimmed)}` : "/shop");
        setSearchOpen(false);
    };

    const isActive = (path: string) =>
        path === "/" ? location === "/" : location.startsWith(path);

    const tabs = [
        { href: "/", label: "Home", icon: Home, active: isActive("/") },
        {
            href: "/categories",
            label: "Categories",
            icon: LayoutGrid,
            active: isActive("/categories"),
        },
        { href: "/shop", label: "Shop", icon: Search, active: isActive("/shop") },
        {
            href: "/cart",
            label: "Cart",
            icon: ShoppingBag,
            active: isActive("/cart"),
            badge: cart.itemCount,
        },
    ];

    return (
        // min-h-[100dvh] rather than 100vh: mobile browsers measure vh against
        // the expanded viewport, which would hide the last rows under the URL bar.
        <div className="flex min-h-[100dvh] flex-col bg-background">
            <header className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
                <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 sm:h-16">
                    <Link href="/" className="flex min-w-0 shrink items-center gap-2">
                        <StoreLogo store={store} />
                    </Link>

                    {/* Desktop search sits in the header; on a phone it opens as
                        an overlay so the header stays legible at 360px wide. */}
                    <form
                        onSubmit={submitSearch}
                        className="ml-auto hidden max-w-sm flex-1 sm:block"
                    >
                        <div className="relative">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder={`Search ${store.name}`}
                                type="search"
                                aria-label="Search products"
                                className="h-9 pl-9"
                            />
                        </div>
                    </form>

                    <div className="ml-auto flex items-center gap-1 sm:ml-0">
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="sm:hidden"
                            aria-label="Search"
                            onClick={() => setSearchOpen(true)}
                        >
                            <Search className="h-5 w-5" />
                        </Button>

                        <Link href="/cart">
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="relative"
                                aria-label={`Cart, ${cart.itemCount} item${cart.itemCount === 1 ? "" : "s"}`}
                            >
                                <ShoppingBag className="h-5 w-5" />
                                <CartBadge count={cart.itemCount} />
                            </Button>
                        </Link>
                    </div>
                </div>

                {/* Category strip — scrolls horizontally rather than wrapping,
                    so a shop with 20 categories does not push the page down. */}
                {categories.length > 0 && (
                    <nav
                        aria-label="Categories"
                        className="mx-auto w-full max-w-6xl overflow-x-auto border-t border-border/60 px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                    >
                        <div className="flex items-center gap-1 py-2">
                            <Link
                                href="/shop"
                                className={cn(
                                    "shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                                    location === "/shop" && !urlQuery
                                        ? "bg-primary/12 text-primary"
                                        : "text-muted-foreground hover:text-foreground",
                                )}
                            >
                                All
                            </Link>
                            {categories.map((category) => (
                                <Link
                                    key={category.id}
                                    href={`/category/${category.slug}`}
                                    className={cn(
                                        "shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                                        location === `/category/${category.slug}`
                                            ? "bg-primary/12 text-primary"
                                            : "text-muted-foreground hover:text-foreground",
                                    )}
                                >
                                    {category.name}
                                </Link>
                            ))}
                        </div>
                    </nav>
                )}
            </header>

            {/* Mobile search overlay */}
            {searchOpen && (
                <div className="fixed inset-0 z-50 bg-background sm:hidden">
                    <form
                        onSubmit={submitSearch}
                        className="flex items-center gap-2 border-b border-border p-3"
                    >
                        <div className="relative flex-1">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                ref={searchInputRef}
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="Search products"
                                type="search"
                                aria-label="Search products"
                                className="h-11 pl-9"
                            />
                        </div>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label="Close search"
                            onClick={() => setSearchOpen(false)}
                        >
                            <X className="h-5 w-5" />
                        </Button>
                    </form>
                    <div className="p-4">
                        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Browse categories
                        </p>
                        <div className="flex flex-wrap gap-2">
                            {categories.map((category) => (
                                <Link
                                    key={category.id}
                                    href={`/category/${category.slug}`}
                                    onClick={() => setSearchOpen(false)}
                                    className="rounded-lg border border-border px-3 py-1.5 text-sm"
                                >
                                    {category.name}
                                </Link>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* pb reserves room for the floating tab bar, plus the home
                indicator inset on iOS. */}
            <main className="flex-1 pb-[calc(4.25rem+env(safe-area-inset-bottom))] sm:pb-0">
                {children}
            </main>

            <StoreFooter
                store={store}
                categories={categories}
                policies={policies}
                basePath={basePath}
            />

            <nav
                aria-label="Primary"
                className="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-border bg-card pb-[env(safe-area-inset-bottom)] sm:hidden"
            >
                {tabs.map((tab) => (
                    <Link key={tab.href} href={tab.href} className="flex-1">
                        <span
                            className={cn(
                                "flex h-full flex-col items-center justify-center gap-0.5 py-2.5 transition-colors",
                                tab.active ? "text-primary" : "text-muted-foreground",
                            )}
                        >
                            <span className="relative">
                                <tab.icon className="h-5 w-5" />
                                {tab.badge != null && <CartBadge count={tab.badge} />}
                            </span>
                            <span className="text-[10px] font-medium leading-none">
                                {tab.label}
                            </span>
                        </span>
                    </Link>
                ))}
            </nav>
        </div>
    );
}

/**
 * A "show me this shop on a map" link, or null when the merchant has not
 * dropped a pin.
 *
 * Google's universal maps URL rather than a geo: URI or an embedded map. A
 * `geo:` link opens nothing on a desktop and is refused outright by some mobile
 * browsers, and an embedded map is a third-party script and an API key on every
 * shop front — for a line of text that a shopper taps perhaps once. This form
 * hands off to whichever map app the phone already has.
 *
 * Both coordinates are required: half a pin points at the equator or the
 * meridian, which is worse than no link at all.
 */
function directionsHref(store: StorePublic): string | null {
    const { latitude, longitude } = store;
    if (latitude === null || longitude === null) return null;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

    return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
}

function StoreFooter({
    store,
    categories,
    policies,
    basePath,
}: {
    store: StorePublic;
    categories: StoreCategory[];
    policies: StorePolicyFlags;
    basePath: string;
}) {
    const directions = directionsHref(store);

    // Only pages the merchant has actually written. A footer link that leads to
    // an empty "Return policy" is worse than no link: a shopper deciding
    // whether to trust an unfamiliar shop with a cash order reads that as the
    // shop having no policy at all.
    const policyLinks = [
        policies.hasDeliveryInfo && { href: "/delivery", label: "Delivery" },
        policies.hasReturnPolicy && { href: "/returns", label: "Returns" },
        policies.hasTerms && { href: "/terms", label: "Terms" },
        policies.hasPrivacyPolicy && { href: "/privacy", label: "Privacy" },
    ].filter((link): link is { href: string; label: string } => Boolean(link));
    const socials = [
        store.facebookUrl && { href: store.facebookUrl, icon: Facebook, label: "Facebook" },
        store.instagramUrl && { href: store.instagramUrl, icon: Instagram, label: "Instagram" },
        store.whatsappNumber && {
            href: `https://wa.me/${store.whatsappNumber.replace(/[^0-9]/g, "")}`,
            icon: MessageCircle,
            label: "WhatsApp",
        },
    ].filter(Boolean) as { href: string; icon: typeof Facebook; label: string }[];

    return (
        <footer className="mt-12 border-t border-border bg-card">
            <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                    <h3 className="font-serif text-base font-semibold">{store.name}</h3>
                    {store.description && (
                        <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
                            {store.description}
                        </p>
                    )}
                    {socials.length > 0 && (
                        <div className="mt-4 flex items-center gap-2">
                            {socials.map((social) => (
                                <a
                                    key={social.label}
                                    href={social.href}
                                    target="_blank"
                                    rel="noreferrer noopener"
                                    aria-label={social.label}
                                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:text-foreground"
                                >
                                    <social.icon className="h-4 w-4" />
                                </a>
                            ))}
                        </div>
                    )}
                </div>

                {categories.length > 0 && (
                    <div>
                        <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Shop
                        </h4>
                        <ul className="mt-3 space-y-2">
                            {categories.slice(0, 6).map((category) => (
                                <li key={category.id}>
                                    <Link
                                        href={`/category/${category.slug}`}
                                        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                                    >
                                        {category.name}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                <div>
                    <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Contact
                    </h4>
                    <ul className="mt-3 space-y-2.5 text-sm text-muted-foreground">
                        {store.phone && (
                            <li className="flex items-start gap-2">
                                <Phone className="mt-0.5 h-4 w-4 shrink-0" />
                                <a
                                    href={`tel:${store.phone}`}
                                    className="font-mono transition-colors hover:text-foreground"
                                >
                                    {store.phone}
                                </a>
                            </li>
                        )}
                        {store.email && (
                            <li className="flex items-start gap-2">
                                <Mail className="mt-0.5 h-4 w-4 shrink-0" />
                                <a
                                    href={`mailto:${store.email}`}
                                    className="break-all transition-colors hover:text-foreground"
                                >
                                    {store.email}
                                </a>
                            </li>
                        )}
                        {(store.address || directions) && (
                            <li className="flex items-start gap-2">
                                <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                                {directions ? (
                                    // Opens the phone's own map app, which is
                                    // the only form of "where is this shop"
                                    // that survives being read out to a rider.
                                    <a
                                        href={directions}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="transition-colors hover:text-foreground"
                                    >
                                        {store.address ?? "Get directions"}
                                        {store.address && (
                                            <span className="ml-1.5 whitespace-nowrap text-xs underline underline-offset-2">
                                                Directions
                                            </span>
                                        )}
                                    </a>
                                ) : (
                                    <span>{store.address}</span>
                                )}
                            </li>
                        )}
                        <li className="flex items-start gap-2">
                            <StoreIcon className="mt-0.5 h-4 w-4 shrink-0" />
                            <Link
                                href="/track"
                                className="transition-colors hover:text-foreground"
                            >
                                Track your order
                            </Link>
                        </li>
                        {store.openingHours && (
                            <li className="flex items-start gap-2">
                                <Clock className="mt-0.5 h-4 w-4 shrink-0" />
                                <span>{store.openingHours}</span>
                            </li>
                        )}
                    </ul>

                    {policyLinks.length > 0 && (
                        <>
                            <h4 className="mt-6 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                Information
                            </h4>
                            <ul className="mt-3 space-y-2 text-sm">
                                {policyLinks.map((link) => (
                                    <li key={link.href}>
                                        <Link
                                            href={link.href}
                                            className="text-muted-foreground transition-colors hover:text-foreground"
                                        >
                                            {link.label}
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}
                </div>
            </div>

            <div className="border-t border-border/60">
                <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                    <p>
                        © {new Date().getFullYear()} {store.name}. Cash on delivery across
                        Bangladesh.
                    </p>
                    <p>
                        Powered by{" "}
                        <a
                            href={basePath ? window.location.origin : "/"}
                            className="font-medium transition-colors hover:text-foreground"
                        >
                            zPOS
                        </a>
                    </p>
                </div>
            </div>
        </footer>
    );
}
