/**
 * Decides, before anything renders, whether this browser tab is the zPOS
 * dashboard or a merchant's public storefront.
 *
 * Two ways in, deliberately:
 *
 *   • `tds.zpos.example.com` — a subdomain of `VITE_APP_DOMAIN`. This is the
 *     shape merchants are given, and it requires a wildcard DNS record plus a
 *     wildcard domain on the deployment.
 *
 *   • `/s/tds` — a path on the main domain. Always available, on any host,
 *     with no DNS work at all. It is what makes storefronts usable on a plain
 *     `*.vercel.app` deployment (Vercel does not issue wildcard subdomains
 *     under `vercel.app`), and it doubles as the local development route.
 *
 * Both resolve to the same slug and render the same app, so nothing downstream
 * has to know which one the visitor arrived through — only `storePath()` cares,
 * because links have to keep whichever form the visitor is already using.
 */

export type Tenant =
    | { mode: "app" }
    | {
          mode: "storefront";
          slug: string;
          /** Router base — "" on a subdomain, "/s/<slug>" on the path form. */
          basePath: string;
      };

/**
 * The domain storefront subdomains hang off. Configure per deployment with
 * `VITE_APP_DOMAIN`; the fallback is the production host, so a missing value
 * degrades to "no subdomain storefronts" rather than to misrouting.
 */
const APP_DOMAIN = (import.meta.env.VITE_APP_DOMAIN ?? "zpos.vercel.app")
    .trim()
    .toLowerCase()
    .replace(/^\.+/, "");

/**
 * Hostname labels that are infrastructure, not merchants. A visitor on
 * `www.` must reach the dashboard, not a "store not found" page. The server
 * keeps the authoritative, much longer list — this one only has to cover the
 * labels that can realistically appear in front of the app itself.
 */
const NON_TENANT_LABELS = new Set([
    "www",
    "api",
    "app",
    "admin",
    "dashboard",
    "staging",
    "preview",
    "dev",
    "test",
]);

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

function subdomainOf(hostname: string): string | null {
    const host = hostname.toLowerCase();

    // `tds.localhost` — Chrome and Safari resolve any *.localhost to loopback,
    // so subdomain routing can be exercised locally without touching /etc/hosts.
    if (host.endsWith(".localhost")) {
        const label = host.slice(0, -".localhost".length);
        return label.includes(".") ? null : label;
    }

    if (!APP_DOMAIN || host === APP_DOMAIN) return null;
    if (!host.endsWith(`.${APP_DOMAIN}`)) return null;

    const label = host.slice(0, -(APP_DOMAIN.length + 1));
    // Only a single label counts. `a.b.zpos.example.com` is not a storefront.
    return label.includes(".") ? null : label;
}

export function resolveTenant(
    hostname: string = window.location.hostname,
    pathname: string = window.location.pathname,
): Tenant {
    const label = subdomainOf(hostname);
    if (label && SLUG_PATTERN.test(label) && !NON_TENANT_LABELS.has(label)) {
        return { mode: "storefront", slug: label, basePath: "" };
    }

    const match = /^\/s\/([a-z0-9][a-z0-9-]*)(?:\/|$)/i.exec(pathname);
    const pathSlug = match?.[1]?.toLowerCase();
    if (pathSlug && SLUG_PATTERN.test(pathSlug)) {
        return { mode: "storefront", slug: pathSlug, basePath: `/s/${pathSlug}` };
    }

    return { mode: "app" };
}

/**
 * The public URL of a store, for the dashboard to show and for the merchant to
 * share. Returns both forms so the UI can present the subdomain as the address
 * to hand out while still offering the path form, which works everywhere today.
 */
export function storeUrls(slug: string): { subdomain: string; path: string } {
    // Only ever called from the dashboard, which is served from the app's own
    // origin — so the path form is simply this origin plus the route, and it is
    // correct in development and production alike.
    const origin = window.location.origin;
    const { protocol, hostname, port } = window.location;

    // On a developer's machine the subdomain form is `tds.localhost:5173`,
    // which Chrome and Safari resolve to loopback — so the link in the
    // dashboard is one you can actually click while building.
    const subdomainHost =
        hostname === "localhost" || hostname === "127.0.0.1"
            ? `${slug}.localhost${port ? `:${port}` : ""}`
            : `${slug}.${APP_DOMAIN}`;

    return {
        subdomain: `${protocol}//${subdomainHost}`,
        path: `${origin}/s/${slug}`,
    };
}

export const appDomain = APP_DOMAIN;
