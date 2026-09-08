import { GS1_COMPANY_PREFIX } from "@/config"

/**
 * Generates a GS1-compliant EAN-13 barcode number for retail products.
 *
 * Structure: [GS1 Company Prefix (7)] + [Product Reference (5)] + [Check Digit (1)]
 *
 * For a real deployment, your GS1 company prefix is assigned by GS1 org.
 * During dev/staging, prefix 200-299 is reserved for internal/store use.
 *
 * @param sequentialId - Up to 5-digit product reference, zero-padded
 * @returns              - 13-digit EAN-13 string
 * 
 * @example
 * generateEAN13(12345) // "2001012345678"
 */

export function generateEAN13(sequentialId: number): string {
    if (!Number.isInteger(sequentialId) || sequentialId < 1 || sequentialId > 99999999) {
        throw new Error("Sequential ID must be an integer between 1 and 99999999")
    }

    const base = `${GS1_COMPANY_PREFIX}${String(sequentialId).padStart(8, "0")}`
    const checkDigit = computeEAN13CheckDigit(base)
    return `${base}${checkDigit}`
}

export function validateEAN13(barcode: string): boolean {
    if (!/^\d{13}$/.test(barcode)) return false
    const base = barcode.slice(0, 12)
    const providedCheck = parseInt(barcode[12]!, 10)
    return computeEAN13CheckDigit(base) === providedCheck
}

function computeEAN13CheckDigit(twelveDigits: string): number {
    const digits = twelveDigits.split("").map(Number)
    const sum = digits.reduce((acc, digit, i) => {
        return acc + digit * (i % 2 === 0 ? 1 : 3)
    }, 0)
    const remainder = sum % 10
    return remainder === 0 ? 0 : 10 - remainder
}

/**
 * The maximum length a scanned symbol is accepted at.
 *
 * EAN/UPC top out at 14 digits, but Code-128 and Code-39 carry arbitrary
 * strings and a merchant may well link one. The cap exists so a garbled decode
 * cannot be stored as a barcode, not to enforce a symbology.
 */
const MAX_BARCODE_LENGTH = 48

/**
 * Trim a scanned symbol to the form it is stored and compared in.
 *
 * Scanners and keyboard-wedge readers pad codes with whitespace, a trailing
 * carriage return, or hyphens the human-readable line shows but the symbol does
 * not; none of that is part of the label. Code-39 and Code-128 are
 * case-sensitive in principle but every reader reports them uppercase, so
 * casing is folded to keep a typed code matching a scanned one.
 */
export function normalizeBarcode(raw: string): string {
    return raw.replace(/[\s-]/g, "").toUpperCase()
}

/**
 * Every form a scanner might report the same physical label as.
 *
 * The same barcode legitimately arrives as different strings depending on the
 * reader: a UPC-A label is 12 digits to one scanner and 13 (leading zero) to
 * another, and a UPC-E label is reported either compressed to 8 digits or
 * already expanded. A lookup that compared only the literal decode would miss
 * a product the shop genuinely stocks — exactly the "our scanner does not read
 * other people's barcodes" failure.
 *
 * The first entry is always the normalized code itself, so a caller that wants
 * one canonical form can take `[0]`.
 */
export function barcodeCandidates(raw: string): string[] {
    const code = normalizeBarcode(raw)
    if (!code) return []

    const forms = [code]
    const push = (value: string) => {
        if (value && !forms.includes(value)) forms.push(value)
    }

    if (/^\d+$/.test(code)) {
        // UPC-A (12) and EAN-13 (13) are the same GTIN with or without its
        // leading zero. GTIN-14 shipping codes reduce the same way.
        if (code.length === 12) push(`0${code}`)
        if (code.length === 13 && code.startsWith("0")) push(code.slice(1))
        if (code.length === 14 && code.startsWith("0")) {
            push(code.slice(1))
            if (code.startsWith("00")) push(code.slice(2))
        }

        // UPC-E is a compressed UPC-A. Readers disagree about which of the two
        // they hand back, so register both.
        if (code.length === 8) {
            const expanded = expandUpcE(code)
            if (expanded) {
                push(expanded)
                push(`0${expanded}`)
            }
        }
    }

    return forms
}

/**
 * True for a code that may be stored as a label.
 *
 * Deliberately permissive about symbology — a merchant linking a supplier's
 * Code-128 is a normal thing to do — and strict only about the shapes that
 * would corrupt the table: empty, absurdly long, or carrying the whitespace and
 * control bytes a half-read scan leaves behind.
 */
export function isStorableBarcode(code: string): boolean {
    if (code.length < 4 || code.length > MAX_BARCODE_LENGTH) return false
    return /^[A-Z0-9!-\/:-@\[-`{-~]+$/.test(code)
}

/**
 * Expand an 8-digit UPC-E to its 12-digit UPC-A equivalent.
 *
 * The sixth digit selects how the zeroes the symbology squeezed out are put
 * back — GS1's standard expansion table. Returns null for anything that is not
 * a UPC-E (number system other than 0 or 1, or a check digit that disagrees
 * with the expansion), so a random 8-digit EAN-8 is never silently rewritten
 * into some other product's code.
 */
function expandUpcE(upce: string): string | null {
    if (!/^[01]\d{7}$/.test(upce)) return null

    const system = upce[0]!
    const check = upce[7]!
    const d1 = upce[1]!, d2 = upce[2]!, d3 = upce[3]!
    const d4 = upce[4]!, d5 = upce[5]!, d6 = upce[6]!

    let body: string
    switch (d6) {
        case "0":
        case "1":
        case "2":
            body = `${d1}${d2}${d6}0000${d3}${d4}${d5}`
            break
        case "3":
            body = `${d1}${d2}${d3}00000${d4}${d5}`
            break
        case "4":
            body = `${d1}${d2}${d3}${d4}00000${d5}`
            break
        default:
            body = `${d1}${d2}${d3}${d4}${d5}0000${d6}`
            break
    }

    const upca = `${system}${body}${check}`
    return computeEAN13CheckDigit(`0${upca.slice(0, 11)}`) === Number(check) ? upca : null
}
