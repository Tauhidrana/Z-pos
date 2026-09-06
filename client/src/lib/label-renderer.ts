/**
 * Renders a printable product label to a canvas.
 *
 * Everything the label shows is drawn onto one canvas rather than laid out in
 * the DOM and screenshotted, so what the preview shows is byte-for-byte what
 * downloads — a DOM preview and a separately-built export drift apart the
 * moment either changes.
 */

export type LabelData = {
    productName: string;
    price: number | null;
    size: string | null;
    color: string | null;
    brand: string | null;
    barcode: string;
    /** data: URL from the file picker, or null. */
    photoDataUrl: string | null;
};

/** Logical label size in px; the canvas is rendered at `scale`x for print. */
const LABEL_W = 440;
const LABEL_H = 280;

const PAD = 18;
const PHOTO = 96;

/**
 * Height reserved along the bottom for the barcode. The text block above is
 * laid out against `TEXT_LIMIT_Y` so the price can never collide with it.
 */
const BARCODE_BAND_H = 92;
const TEXT_LIMIT_Y = LABEL_H - PAD - BARCODE_BAND_H;

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Could not load the product photo"));
        img.src = src;
    });
}

/** Break `text` into at most `maxLines` lines that fit `maxWidth`, ellipsising the last. */
function wrapText(
    ctx: CanvasRenderingContext2D,
    text: string,
    maxWidth: number,
    maxLines: number,
): string[] {
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];

    const lines: string[] = [];
    let current = "";

    for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (ctx.measureText(candidate).width <= maxWidth) {
            current = candidate;
            continue;
        }
        if (current) lines.push(current);
        current = word;
        if (lines.length === maxLines) break;
    }
    if (lines.length < maxLines && current) lines.push(current);

    // The final line may still overflow (one very long word, or text we cut short).
    if (lines.length === maxLines) {
        let last = lines[maxLines - 1] ?? "";
        const truncated = lines.length < words.length || ctx.measureText(last).width > maxWidth;
        if (truncated) {
            while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) {
                last = last.slice(0, -1);
            }
            lines[maxLines - 1] = `${last}…`;
        }
    }

    return lines;
}

/** Render the EAN-13 itself onto its own canvas via JsBarcode. */
async function renderBarcodeCanvas(value: string, scale: number): Promise<HTMLCanvasElement> {
    const JsBarcode = (await import("jsbarcode")).default;
    const canvas = document.createElement("canvas");

    // EAN13 is what the rest of the system issues; anything else is a caller bug
    // and JsBarcode will throw rather than draw a code no scanner can read.
    JsBarcode(canvas, value, {
        format: "EAN13",
        width: 2 * scale,
        height: 60 * scale,
        displayValue: true,
        fontSize: 16 * scale,
        textMargin: 2 * scale,
        margin: 0,
        background: "#ffffff",
        lineColor: "#000000",
    });

    return canvas;
}

export async function renderLabelCanvas(
    data: LabelData,
    scale = 2,
): Promise<HTMLCanvasElement> {
    const canvas = document.createElement("canvas");
    canvas.width = LABEL_W * scale;
    canvas.height = LABEL_H * scale;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is not available in this browser");

    ctx.scale(scale, scale);
    ctx.textBaseline = "top";

    // Background + hairline border, so the label's edge is visible when printed
    // onto white sticker stock.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, LABEL_W, LABEL_H);
    ctx.strokeStyle = "#d4d4d8";
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, LABEL_W - 1, LABEL_H - 1);

    let textX = PAD;
    let textWidth = LABEL_W - PAD * 2;

    // ── Photo ────────────────────────────────────────────────────────────────
    if (data.photoDataUrl) {
        try {
            const img = await loadImage(data.photoDataUrl);

            // Cover-fit into a square so portrait and landscape photos both fill
            // the box without distorting.
            const side = Math.min(img.width, img.height);
            const sx = (img.width - side) / 2;
            const sy = (img.height - side) / 2;

            ctx.save();
            ctx.beginPath();
            ctx.roundRect(PAD, PAD, PHOTO, PHOTO, 8);
            ctx.clip();
            ctx.drawImage(img, sx, sy, side, side, PAD, PAD, PHOTO, PHOTO);
            ctx.restore();

            ctx.strokeStyle = "#e4e4e7";
            ctx.beginPath();
            ctx.roundRect(PAD + 0.5, PAD + 0.5, PHOTO - 1, PHOTO - 1, 8);
            ctx.stroke();

            textX = PAD + PHOTO + 14;
            textWidth = LABEL_W - textX - PAD;
        } catch {
            // A photo that will not decode must not cost us the whole label.
        }
    }

    let y = PAD;

    // ── Brand ────────────────────────────────────────────────────────────────
    if (data.brand?.trim()) {
        ctx.fillStyle = "#71717a";
        ctx.font = `600 11px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
        const brand = wrapText(ctx, data.brand.trim().toUpperCase(), textWidth, 1)[0] ?? "";
        ctx.fillText(brand, textX, y);
        y += 17;
    }

    // ── Product name ─────────────────────────────────────────────────────────
    ctx.fillStyle = "#18181b";
    ctx.font = `700 19px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
    for (const line of wrapText(ctx, data.productName || "Untitled product", textWidth, 2)) {
        ctx.fillText(line, textX, y);
        y += 24;
    }

    // ── Size / colour chips ──────────────────────────────────────────────────
    const attrs = [
        data.size?.trim() ? `Size: ${data.size.trim()}` : null,
        data.color?.trim() ? `Color: ${data.color.trim()}` : null,
    ].filter(Boolean) as string[];

    if (attrs.length) {
        y += 4;
        ctx.font = `500 12px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
        let chipX = textX;
        for (const attr of attrs) {
            const w = ctx.measureText(attr).width + 16;
            if (chipX + w > textX + textWidth) break;
            ctx.fillStyle = "#f4f4f5";
            ctx.beginPath();
            ctx.roundRect(chipX, y, w, 22, 11);
            ctx.fill();
            ctx.fillStyle = "#3f3f46";
            ctx.fillText(attr, chipX + 8, y + 5);
            chipX += w + 6;
        }
        y += 26;
    }

    // ── Price ────────────────────────────────────────────────────────────────
    if (data.price !== null && Number.isFinite(data.price)) {
        // The price is the last thing drawn and the one a customer actually
        // reads, so it never gets pushed into the barcode: a long brand plus a
        // two-line name plus chips clamps it up against the band instead.
        const priceY = Math.min(y + 4, TEXT_LIMIT_Y - 30);
        ctx.fillStyle = "#18181b";
        ctx.font = `700 26px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
        ctx.fillText(
            `৳${data.price.toLocaleString("en-BD", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
            })}`,
            textX,
            priceY,
        );
    }

    // ── Barcode, pinned into the reserved bottom band ────────────────────────
    // Fitting it to the label's full width instead made it ~155px tall, which
    // reached up into the price and painted over it. Fit to the band's height
    // and centre what that leaves horizontally.
    const bar = await renderBarcodeCanvas(data.barcode, scale);
    const maxW = LABEL_W - PAD * 2;
    const fit = Math.min(BARCODE_BAND_H / bar.height, maxW / bar.width);
    const barW = bar.width * fit;
    const barH = bar.height * fit;

    ctx.drawImage(bar, (LABEL_W - barW) / 2, LABEL_H - PAD - barH, barW, barH);

    return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode the label"))),
            "image/png",
        );
    });
}

function triggerDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function slug(name: string): string {
    return (
        name
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 40) || "label"
    );
}

/**
 * Download `count` copies of the label.
 *
 * One copy downloads as a bare PNG; more than one is zipped, because browsers
 * throttle and then silently drop a burst of individual downloads.
 */
export async function downloadLabelCopies(data: LabelData, count: number): Promise<void> {
    const safeCount = Math.max(1, Math.min(500, Math.floor(count)));
    const canvas = await renderLabelCanvas(data);
    const blob = await canvasToBlob(canvas);
    const base = `${slug(data.productName)}-${data.barcode}`;

    if (safeCount === 1) {
        triggerDownload(blob, `${base}.png`);
        return;
    }

    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();

    // Every copy is the same image, so encode once and add the same bytes N
    // times rather than re-rendering the canvas per copy.
    const bytes = await blob.arrayBuffer();
    const width = String(safeCount).length;
    for (let i = 1; i <= safeCount; i++) {
        zip.file(`${base}-${String(i).padStart(width, "0")}.png`, bytes);
    }

    triggerDownload(await zip.generateAsync({ type: "blob" }), `${base}-x${safeCount}.zip`);
}

/**
 * Download the copies tiled onto A4 pages — what you actually feed a printer
 * when making a sheet of stickers.
 */
export async function downloadLabelSheet(data: LabelData, count: number): Promise<void> {
    const safeCount = Math.max(1, Math.min(500, Math.floor(count)));
    const { jsPDF } = await import("jspdf");
    const canvas = await renderLabelCanvas(data);
    const dataUrl = canvas.toDataURL("image/png");

    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageW = 210;
    const pageH = 297;
    const margin = 10;
    const gap = 4;

    const cellW = 60;
    const cellH = (LABEL_H / LABEL_W) * cellW;

    const cols = Math.max(1, Math.floor((pageW - margin * 2 + gap) / (cellW + gap)));
    const rows = Math.max(1, Math.floor((pageH - margin * 2 + gap) / (cellH + gap)));
    const perPage = cols * rows;

    for (let i = 0; i < safeCount; i++) {
        const slot = i % perPage;
        if (i > 0 && slot === 0) doc.addPage();

        const col = slot % cols;
        const row = Math.floor(slot / cols);
        doc.addImage(
            dataUrl,
            "PNG",
            margin + col * (cellW + gap),
            margin + row * (cellH + gap),
            cellW,
            cellH,
        );
    }

    doc.save(`${slug(data.productName)}-${data.barcode}-sheet.pdf`);
}
