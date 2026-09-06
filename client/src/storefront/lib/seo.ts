/**
 * Per-store page metadata.
 *
 * The storefront is a client-rendered SPA, so this writes tags into the live
 * document rather than serving them pre-rendered. Google renders JavaScript and
 * will index what this produces; a link-preview crawler that does not run JS
 * (Facebook, WhatsApp) reads the static HTML instead and will show the zPOS
 * defaults. Making previews per-store would mean server-rendering the shell —
 * a far bigger change than this feature warrants, and one this file is shaped
 * to accept later without callers changing.
 */

import { useEffect } from "react";

type Meta = {
    title: string;
    description?: string | null;
    image?: string | null;
    /** Absolute canonical URL for this page. */
    canonical?: string | null;
    favicon?: string | null;
    type?: "website" | "product";
    /** JSON-LD, serialised into a script tag for rich results. */
    jsonLd?: Record<string, unknown> | null;
};

function upsertTag(
    selector: string,
    create: () => HTMLElement,
    apply: (el: HTMLElement) => void,
) {
    let el = document.head.querySelector<HTMLElement>(selector);
    if (!el) {
        el = create();
        document.head.appendChild(el);
    }
    apply(el);
}

function setMetaByName(name: string, content: string) {
    upsertTag(
        `meta[name="${name}"][data-store-seo]`,
        () => {
            const el = document.createElement("meta");
            el.setAttribute("name", name);
            el.setAttribute("data-store-seo", "");
            return el;
        },
        (el) => el.setAttribute("content", content),
    );
}

function setMetaByProperty(property: string, content: string) {
    upsertTag(
        `meta[property="${property}"][data-store-seo]`,
        () => {
            const el = document.createElement("meta");
            el.setAttribute("property", property);
            el.setAttribute("data-store-seo", "");
            return el;
        },
        (el) => el.setAttribute("content", content),
    );
}

export function useStoreSeo(meta: Meta | null) {
    useEffect(() => {
        if (!meta) return;

        document.title = meta.title;

        if (meta.description) {
            setMetaByName("description", meta.description);
            setMetaByProperty("og:description", meta.description);
            setMetaByName("twitter:description", meta.description);
        }

        setMetaByProperty("og:title", meta.title);
        setMetaByProperty("og:type", meta.type ?? "website");
        setMetaByName("twitter:title", meta.title);
        setMetaByName("twitter:card", meta.image ? "summary_large_image" : "summary");

        if (meta.image) {
            setMetaByProperty("og:image", meta.image);
            setMetaByName("twitter:image", meta.image);
        }

        const url = meta.canonical ?? window.location.href;
        setMetaByProperty("og:url", url);
        upsertTag(
            'link[rel="canonical"][data-store-seo]',
            () => {
                const el = document.createElement("link");
                el.setAttribute("rel", "canonical");
                el.setAttribute("data-store-seo", "");
                return el;
            },
            (el) => el.setAttribute("href", url),
        );

        if (meta.favicon) {
            // Replace zPOS's own icons rather than adding to them, or the
            // browser keeps showing whichever it found first.
            document.head
                .querySelectorAll('link[rel="icon"]:not([data-store-seo])')
                .forEach((el) => el.remove());
            upsertTag(
                'link[rel="icon"][data-store-seo]',
                () => {
                    const el = document.createElement("link");
                    el.setAttribute("rel", "icon");
                    el.setAttribute("data-store-seo", "");
                    return el;
                },
                (el) => el.setAttribute("href", meta.favicon as string),
            );
        }

        const existingJsonLd = document.head.querySelector(
            'script[type="application/ld+json"][data-store-seo]',
        );
        existingJsonLd?.remove();

        if (meta.jsonLd) {
            const script = document.createElement("script");
            script.type = "application/ld+json";
            script.setAttribute("data-store-seo", "");
            script.textContent = JSON.stringify(meta.jsonLd);
            document.head.appendChild(script);
        }
    }, [meta]);
}

/** Stable object identity for the effect above, given primitive inputs. */
export function storeMeta(meta: Meta): Meta {
    return meta;
}
