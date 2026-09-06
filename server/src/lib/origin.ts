/**
 * Which browser origins are allowed to call this API.
 *
 * Before storefronts existed this was a flat list from `ALLOWED_ORIGINS`, which
 * is exactly right for one dashboard on one domain. A storefront, though, lives
 * at `{slug}.{APP_DOMAIN}` — a hostname nobody can enumerate in advance, since
 * merchants create them at will. So subdomains of the configured app domain are
 * matched by shape rather than listed.
 *
 * The match is deliberately narrow: one label, no dots inside it, exact suffix.
 * `evil-zpos.example.com` does not match `*.example.com`, and neither does
 * `example.com.attacker.net`.
 */

function parseList(value: string | undefined): string[] {
    return (value ?? "")
        .split(",")
        .map((entry) => entry.trim().replace(/\/$/, ""))
        .filter(Boolean);
}

export const allowedOrigins = parseList(process.env.ALLOWED_ORIGINS) .length
    ? parseList(process.env.ALLOWED_ORIGINS)
    : ["http://localhost:3000", "http://localhost:5173"];

/**
 * Root domain the storefronts hang off, e.g. `zpos.vercel.app` or `zpos.com`.
 * Unset means subdomain storefronts are not in use and only the explicit list
 * applies.
 */
const APP_DOMAIN = process.env.APP_DOMAIN?.trim().toLowerCase().replace(/^\.+/, "") ?? "";

const isDev = process.env.NODE_ENV === "development";

/** A single hostname label: letters, digits and inner hyphens. */
const LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export function isAllowedOrigin(origin: string): boolean {
    if (!origin) return false;
    if (allowedOrigins.includes(origin.replace(/\/$/, ""))) return true;

    let url: URL;
    try {
        url = new URL(origin);
    } catch {
        return false;
    }

    // Local development: any localhost port, so a second dev server or a phone
    // on the LAN testing the storefront is not a config change.
    if (isDev && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) {
        return true;
    }

    // `tds.localhost:5173` — Chrome and Safari resolve these to loopback, which
    // makes subdomain routing testable locally without editing /etc/hosts.
    if (url.hostname.endsWith(".localhost") && isDev) return true;

    if (!APP_DOMAIN) return false;

    const host = url.hostname.toLowerCase();
    if (host === APP_DOMAIN) return true;
    if (!host.endsWith(`.${APP_DOMAIN}`)) return false;

    const label = host.slice(0, -(APP_DOMAIN.length + 1));
    return LABEL.test(label);
}
