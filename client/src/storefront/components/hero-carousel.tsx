import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import type { StoreBannerPublic, StorePublic } from "@myapp/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The shop front's hero.
 *
 * Built on a scroll-snap track rather than a carousel library: the browser
 * already does momentum, snapping and touch handling natively and better than
 * JavaScript can, it costs no bundle, and a shopper on a slow phone gets a
 * working swipe before any script has run. The buttons and dots just call
 * `scrollTo`.
 *
 * A single banner renders as a plain image with no controls — dots and arrows
 * on one slide are furniture that does nothing.
 */

/** How long each slide is held before advancing. */
const AUTOPLAY_MS = 6000;

export function HeroCarousel({
    banners,
    store,
}: {
    banners: StoreBannerPublic[];
    store: StorePublic;
}) {
    // No banners: fall back to the legacy single cover image, and then to a
    // typographic panel. A shop that has uploaded nothing must still look
    // finished on its first day rather than showing an empty grey box.
    if (banners.length === 0) {
        return <FallbackHero store={store} />;
    }

    return <BannerTrack banners={banners} />;
}

function BannerTrack({ banners }: { banners: StoreBannerPublic[] }) {
    const trackRef = useRef<HTMLDivElement>(null);
    const [index, setIndex] = useState(0);
    const [paused, setPaused] = useState(false);
    const single = banners.length === 1;

    const scrollTo = useCallback((next: number) => {
        const track = trackRef.current;
        if (!track) return;
        const count = track.children.length;
        if (count === 0) return;
        // Wrap, so "next" on the last slide returns to the first.
        const target = ((next % count) + count) % count;
        track.scrollTo({ left: track.clientWidth * target, behavior: "smooth" });
    }, []);

    // Track which slide is showing from the scroll position itself rather than
    // from whatever last called scrollTo — a finger swipe changes the slide
    // without going through any of our handlers.
    const onScroll = () => {
        const track = trackRef.current;
        if (!track || track.clientWidth === 0) return;
        setIndex(Math.round(track.scrollLeft / track.clientWidth));
    };

    useEffect(() => {
        if (single || paused) return;

        // Someone who has asked for reduced motion should not have the page
        // moving underneath them on a timer.
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (reduced) return;

        const timer = setInterval(() => {
            // A hidden tab would otherwise queue up scrolls that all land at
            // once when the shopper comes back.
            if (document.visibilityState !== "visible") return;
            scrollTo(index + 1);
        }, AUTOPLAY_MS);

        return () => clearInterval(timer);
    }, [index, paused, single, scrollTo]);

    return (
        <section
            className="relative"
            aria-roledescription="carousel"
            aria-label="Featured"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            // Pausing on touch as well: a shopper reading a slide should not
            // have it slide away mid-sentence.
            onTouchStart={() => setPaused(true)}
        >
            <div
                ref={trackRef}
                onScroll={onScroll}
                className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
                {banners.map((banner, i) => (
                    <BannerSlide key={banner.id} banner={banner} priority={i === 0} />
                ))}
            </div>

            {!single && (
                <>
                    <CarouselButton side="left" onClick={() => scrollTo(index - 1)} />
                    <CarouselButton side="right" onClick={() => scrollTo(index + 1)} />

                    <div className="mt-2.5 flex items-center justify-center gap-1.5">
                        {banners.map((banner, i) => (
                            <button
                                key={banner.id}
                                type="button"
                                aria-label={`Go to slide ${i + 1}`}
                                aria-current={i === index}
                                onClick={() => scrollTo(i)}
                                className={cn(
                                    "h-1.5 rounded-full transition-all",
                                    i === index
                                        ? "w-5 bg-primary"
                                        : "w-1.5 bg-border hover:bg-muted-foreground/40",
                                )}
                            />
                        ))}
                    </div>
                </>
            )}
        </section>
    );
}

function BannerSlide({
    banner,
    priority,
}: {
    banner: StoreBannerPublic;
    priority: boolean;
}) {
    const hasCopy = Boolean(banner.title || banner.subtitle || banner.buttonText);

    const content = (
        <>
            {/* 16:9 on a phone, 3:1 from tablet up. A 3:1 strip on a 360px
                screen is 120px tall, which is too little for artwork to read;
                a 16:9 hero on a desktop pushes everything below the fold. */}
            <div className="aspect-[16/9] w-full bg-muted sm:aspect-[3/1]">
                <img
                    src={banner.imageUrl}
                    alt={banner.title ?? ""}
                    // The first slide is the page's largest paintable element,
                    // so it is fetched eagerly and at high priority; the rest
                    // wait until the shopper swipes toward them.
                    loading={priority ? "eager" : "lazy"}
                    fetchPriority={priority ? "high" : "auto"}
                    decoding="async"
                    className="h-full w-full object-cover"
                />
            </div>

            {hasCopy && (
                <div className="absolute inset-0 flex flex-col justify-center bg-gradient-to-r from-black/60 via-black/30 to-transparent px-5 sm:px-10">
                    <div className="max-w-md text-white">
                        {banner.title && (
                            <h2 className="font-serif text-xl font-semibold leading-tight drop-shadow-sm sm:text-3xl lg:text-4xl">
                                {banner.title}
                            </h2>
                        )}
                        {banner.subtitle && (
                            <p className="mt-1.5 text-xs leading-snug text-white/90 drop-shadow-sm sm:mt-2.5 sm:text-base">
                                {banner.subtitle}
                            </p>
                        )}
                        {banner.buttonText && (
                            <span className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-white px-3.5 py-2 text-xs font-semibold text-black sm:mt-5 sm:text-sm">
                                {banner.buttonText}
                                <ArrowRight className="h-3.5 w-3.5" />
                            </span>
                        )}
                    </div>
                </div>
            )}
        </>
    );

    const className = "relative w-full shrink-0 snap-center snap-always";

    if (!banner.buttonLink) {
        return <div className={className}>{content}</div>;
    }

    // An absolute link leaves the storefront, so it gets a real anchor with the
    // usual protections; an internal path goes through the router.
    if (/^https?:\/\//i.test(banner.buttonLink)) {
        return (
            <a
                href={banner.buttonLink}
                target="_blank"
                rel="noreferrer noopener"
                className={className}
            >
                {content}
            </a>
        );
    }

    return (
        <Link href={banner.buttonLink} className={className}>
            {content}
        </Link>
    );
}

function CarouselButton({
    side,
    onClick,
}: {
    side: "left" | "right";
    onClick: () => void;
}) {
    const Icon = side === "left" ? ChevronLeft : ChevronRight;
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={side === "left" ? "Previous slide" : "Next slide"}
            className={cn(
                // Hidden on touch: the swipe is the control there, and two
                // floating buttons only cover the artwork.
                "absolute top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background/85 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-background sm:flex",
                side === "left" ? "left-2" : "right-2",
            )}
        >
            <Icon className="h-5 w-5" />
        </button>
    );
}

/** No banner artwork at all — the store's own name, set properly. */
function FallbackHero({ store }: { store: StorePublic }) {
    if (store.bannerUrl) {
        return (
            <div className="overflow-hidden rounded-xl border border-card-border">
                <div className="aspect-[16/9] w-full bg-muted sm:aspect-[3/1]">
                    <img
                        src={store.bannerUrl}
                        alt={`${store.name} banner`}
                        loading="eager"
                        fetchPriority="high"
                        decoding="async"
                        className="h-full w-full object-cover"
                    />
                </div>
            </div>
        );
    }

    return (
        <div className="rounded-xl border border-card-border bg-card px-5 py-8 sm:px-8 sm:py-12">
            <h1 className="font-serif text-2xl font-semibold leading-tight sm:text-4xl">
                {store.name}
            </h1>
            {store.description && (
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
                    {store.description}
                </p>
            )}
            <Link href="/shop">
                <Button className="mt-5 gap-2">
                    Browse products
                    <ArrowRight className="h-4 w-4" />
                </Button>
            </Link>
        </div>
    );
}
