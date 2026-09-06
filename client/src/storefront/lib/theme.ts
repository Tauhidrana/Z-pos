/**
 * Applies a merchant's accent colour to their storefront.
 *
 * The storefront inherits the whole zPOS palette — warm oat surfaces, the type
 * scale, the radii, the shadows — and swaps only the primary. That keeps every
 * store recognisably part of the same product while still letting a merchant
 * put their own colour on the buy button.
 *
 * The palette is authored in HSL channel triples (`--primary: 16 71% 39%`), so
 * a hex from the settings form has to be converted rather than assigned.
 */

export function hexToHslChannels(hex: string): string | null {
    const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!match?.[1]) return null;

    const int = parseInt(match[1], 16);
    const r = ((int >> 16) & 255) / 255;
    const g = ((int >> 8) & 255) / 255;
    const b = (int & 255) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lightness = (max + min) / 2;

    if (max === min) {
        return `0 0% ${Math.round(lightness * 100)}%`;
    }

    const delta = max - min;
    const saturation =
        lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);

    let hue: number;
    if (max === r) hue = ((g - b) / delta + (g < b ? 6 : 0)) / 6;
    else if (max === g) hue = ((b - r) / delta + 2) / 6;
    else hue = ((r - g) / delta + 4) / 6;

    return `${Math.round(hue * 360)} ${Math.round(saturation * 100)}% ${Math.round(
        lightness * 100,
    )}%`;
}

/**
 * Readable text on top of the accent. A mid-grey threshold on perceptual
 * luminance, so a merchant who picks a pale yellow gets dark text on their
 * buttons instead of white-on-white.
 */
function foregroundFor(hex: string): string {
    const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!match?.[1]) return "38 83% 95%";
    const int = parseInt(match[1], 16);
    const r = ((int >> 16) & 255) / 255;
    const g = ((int >> 8) & 255) / 255;
    const b = (int & 255) / 255;
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luminance > 0.62 ? "30 33% 11%" : "38 83% 95%";
}

/** Sets the accent on an element's inline style. Returns nothing to clean up. */
export function themeStyle(themeColor: string | undefined): React.CSSProperties {
    if (!themeColor) return {};
    const channels = hexToHslChannels(themeColor);
    if (!channels) return {};

    return {
        // Cast: these are custom properties, which React types do not model.
        ["--primary" as string]: channels,
        ["--primary-foreground" as string]: foregroundFor(themeColor),
        ["--ring" as string]: channels,
    } as React.CSSProperties;
}

/** Tints the mobile browser chrome to match the store. Call from an effect. */
export function applyThemeColorMeta(themeColor: string | undefined) {
    if (typeof document === "undefined" || !themeColor) return;
    document.head
        .querySelectorAll('meta[name="theme-color"]')
        .forEach((el) => el.setAttribute("content", themeColor));
}
