import { describe, it, expect } from 'bun:test'
import { barcodeCandidates, isStorableBarcode, normalizeBarcode } from '@/lib/barcode'

/**
 * The scanner is only as good as the forms it recognises.
 *
 * Every case here is a label a shop genuinely meets at the counter, and each
 * one used to be a "our scanner does not read other people's barcodes"
 * complaint: the same physical symbol reaches the server as different strings
 * depending on the reader, and a lookup that compared only the literal decode
 * missed stock the shop actually carries.
 */

describe('normalizeBarcode', () => {
    it('strips the padding readers add around the symbol', () => {
        // A keyboard-wedge reader appends a carriage return, and the
        // human-readable line under the bars is often hyphenated even though
        // the symbol is not.
        expect(normalizeBarcode(' 12-34 \r\n')).toBe('1234')
    })

    it('folds case so a typed code matches a scanned one', () => {
        expect(normalizeBarcode('ab12cd')).toBe('AB12CD')
    })
})

describe('barcodeCandidates', () => {
    it('gives nothing for a code that is only padding', () => {
        expect(barcodeCandidates('   ')).toEqual([])
    })

    it('leads with the normalized code, so callers can take [0] as canonical', () => {
        expect(barcodeCandidates(' ab-12 ')[0]).toBe('AB12')
    })

    it('treats UPC-A and its EAN-13 form as the same label', () => {
        // The leading zero is the only difference; one scanner reports it and
        // another does not.
        expect(barcodeCandidates('036000291452')).toContain('0036000291452')
        expect(barcodeCandidates('0036000291452')).toContain('036000291452')
    })

    it('reduces a GTIN-14 shipping code to the retail forms beneath it', () => {
        const forms = barcodeCandidates('00036000291452')
        expect(forms).toContain('0036000291452')
        expect(forms).toContain('036000291452')
    })

    it('expands UPC-E through every branch of the GS1 table', () => {
        // The sixth digit selects where the squeezed-out zeroes go back. All
        // ten branches, so a rewrite of the table cannot silently drop one.
        const pairs: Array<[string, string]> = [
            ['04252605', '042000005265'], // d6 = 0
            ['04252614', '042100005264'], // d6 = 1
            ['04252623', '042200005263'], // d6 = 2
            ['04252635', '042500000265'], // d6 = 3
            ['04252641', '042520000061'], // d6 = 4
            ['04252658', '042526000058'], // d6 = 5
            ['04252665', '042526000065'], // d6 = 6
            ['04252672', '042526000072'], // d6 = 7
            ['04252689', '042526000089'], // d6 = 8
            ['04252696', '042526000096'], // d6 = 9
        ]

        for (const [upce, upca] of pairs) {
            const forms = barcodeCandidates(upce)
            expect(forms).toContain(upca)
            // Registered in both retail forms, since readers disagree.
            expect(forms).toContain(`0${upca}`)
        }
    })

    it('never rewrites an 8-digit code whose check digit disagrees', () => {
        // Otherwise a plain EAN-8 would be expanded into some other product's
        // UPC-A and scan up as the wrong item.
        expect(barcodeCandidates('04252606')).toEqual(['04252606'])
    })

    it('leaves a non-numeric symbol alone', () => {
        // Code-128 carries arbitrary text; there is no GTIN reduction to do.
        expect(barcodeCandidates('SKU-99A')).toEqual(['SKU99A'])
    })
})

describe('isStorableBarcode', () => {
    it('accepts an ordinary retail code', () => {
        expect(isStorableBarcode('2001012345678')).toBe(true)
        expect(isStorableBarcode('SKU99A')).toBe(true)
    })

    it('rejects the debris a half-read scan leaves behind', () => {
        expect(isStorableBarcode('')).toBe(false)
        expect(isStorableBarcode('12')).toBe(false)
        expect(isStorableBarcode('A'.repeat(49))).toBe(false)
    })
})
