import { describe, it, expect, beforeEach } from 'bun:test'
import { mockPrisma, resetAllMocks } from '../preload'
import { createTestApp, get, post, json } from '../setup'

type ApiResponse<T> = { success: boolean; message: string; data: T }
type ErrorBody = { success: false; message: string; error: { code: string } }

const app = createTestApp()

const VARIANT_ID = '550e8400-e29b-41d4-a716-446655440000'

/** A variant that carries a shelf price but has never been purchased. */
const VARIANT = {
    id: VARIANT_ID,
    name: 'Red',
    color: 'red',
    size: 'M',
    stock_on_hand: 12,
    is_active: true,
    last_sell_price: '250',
    product: { name: 'Test Product', brand: 'TestBrand', is_active: true },
}

beforeEach(() => {
    resetAllMocks()
})

/**
 * Issuing a label used to require a purchase batch, because the printed price
 * was read off one. That made the commonest stock in a small shop unlabelable:
 * opening stock typed in with the product never passes through a purchase.
 * These cover the two prices that can now apply, and which one wins.
 */
describe('POST /api/labels/issue — pricing a label', () => {
    it('labels a never-purchased variant from its shelf price', async () => {
        mockPrisma.productVariant.findFirst.mockResolvedValueOnce(VARIANT)
        mockPrisma.variantBarcodeAllocation.findFirst.mockResolvedValueOnce(null)
        mockPrisma.purchaseItem.findFirst.mockResolvedValueOnce(null) // never purchased
        mockPrisma.$queryRaw.mockResolvedValueOnce([{ serial: 12345 }])
        mockPrisma.barcode.upsert.mockResolvedValueOnce({ id: 'bc-1', code: '2001012345678' })

        const res = await post(app, '/api/labels/issue', { variantId: VARIANT_ID })
        expect(res.status).toBe(201)

        const body = await json<ApiResponse<{ price: number; barcode: string; issued: boolean }>>(res)
        expect(body.data.price).toBe(250)
        expect(body.data.issued).toBe(true)

        // The allocation records no batch, which is the whole point: there is
        // no batch to record.
        const allocation = mockPrisma.variantBarcodeAllocation.upsert.mock.calls[0]![0] as any
        expect(allocation.create.purchase_item_id).toBeNull()
    })

    it('prefers the batch price over the shelf price when a batch exists', async () => {
        // The till charges the batch price for a unit carrying this label, so
        // printing the shelf price would put a number on the sticker that the
        // receipt then contradicts.
        mockPrisma.productVariant.findFirst.mockResolvedValueOnce(VARIANT)
        mockPrisma.variantBarcodeAllocation.findFirst.mockResolvedValueOnce(null)
        mockPrisma.purchaseItem.findFirst.mockResolvedValueOnce({ id: 'pi-1', sell_price: '310' })
        mockPrisma.$queryRaw.mockResolvedValueOnce([{ serial: 12345 }])
        mockPrisma.barcode.upsert.mockResolvedValueOnce({ id: 'bc-1', code: '2001012345678' })

        const res = await post(app, '/api/labels/issue', { variantId: VARIANT_ID })
        expect(res.status).toBe(201)

        const body = await json<ApiResponse<{ price: number }>>(res)
        expect(body.data.price).toBe(310)

        const allocation = mockPrisma.variantBarcodeAllocation.upsert.mock.calls[0]![0] as any
        expect(allocation.create.purchase_item_id).toBe('pi-1')
    })

    it('refuses when there is no price anywhere', async () => {
        // A sticker with a blank where the amount goes is worse than no sticker.
        mockPrisma.productVariant.findFirst.mockResolvedValueOnce({ ...VARIANT, last_sell_price: null })
        mockPrisma.variantBarcodeAllocation.findFirst.mockResolvedValueOnce(null)
        mockPrisma.purchaseItem.findFirst.mockResolvedValueOnce(null)

        const res = await post(app, '/api/labels/issue', { variantId: VARIANT_ID })
        expect(res.status).toBe(422)

        const body = await json<ErrorBody>(res)
        expect(body.error.code).toBe('NO_PRICE')
    })

    it('is idempotent: an already-labelled variant returns its existing code', async () => {
        // Printing 50 copies of one label is the normal case; re-issuing on
        // every print would flood the table with dead codes.
        mockPrisma.productVariant.findFirst.mockResolvedValueOnce(VARIANT)
        mockPrisma.variantBarcodeAllocation.findFirst.mockResolvedValueOnce({
            barcode: { code: '2001012345678' },
            purchaseItem: { sell_price: '310' },
        })

        const res = await post(app, '/api/labels/issue', { variantId: VARIANT_ID })
        expect(res.status).toBe(200)

        const body = await json<ApiResponse<{ issued: boolean; barcode: string; price: number }>>(res)
        expect(body.data.issued).toBe(false)
        expect(body.data.barcode).toBe('2001012345678')
        expect(body.data.price).toBe(310)
        expect(mockPrisma.barcode.upsert).not.toHaveBeenCalled()
    })

    it('prices an existing batchless allocation from the shelf price', async () => {
        mockPrisma.productVariant.findFirst.mockResolvedValueOnce(VARIANT)
        mockPrisma.variantBarcodeAllocation.findFirst.mockResolvedValueOnce({
            barcode: { code: 'MFR-CODE-1' },
            purchaseItem: null,
        })

        const res = await post(app, '/api/labels/issue', { variantId: VARIANT_ID })
        expect(res.status).toBe(200)

        const body = await json<ApiResponse<{ price: number }>>(res)
        expect(body.data.price).toBe(250)
    })

    it('404s for a variant outside this shop', async () => {
        mockPrisma.productVariant.findFirst.mockResolvedValueOnce(null)

        const res = await post(app, '/api/labels/issue', { variantId: VARIANT_ID })
        expect(res.status).toBe(404)
    })

    it('422s on a malformed variant id', async () => {
        const res = await post(app, '/api/labels/issue', { variantId: 'not-a-uuid' })
        expect(res.status).toBe(422)
    })
})

/**
 * Most stock in a small shop already carries a barcode the shop did not print.
 * Linking one is what makes a factory label ring up at the counter.
 */
describe('POST /api/labels/issue — linking a manufacturer code', () => {
    it('registers the supplied code instead of minting one', async () => {
        mockPrisma.productVariant.findFirst.mockResolvedValueOnce(VARIANT)
        mockPrisma.purchaseItem.findFirst.mockResolvedValueOnce(null)
        mockPrisma.barcode.findUnique.mockResolvedValueOnce(null) // nothing holds it
        mockPrisma.barcode.upsert.mockResolvedValueOnce({ id: 'bc-9', code: '036000291452' })

        const res = await post(app, '/api/labels/issue', {
            variantId: VARIANT_ID,
            code: '036000291452',
        })
        expect(res.status).toBe(201)

        const body = await json<ApiResponse<{ barcode: string }>>(res)
        expect(body.message).toBe('Barcode linked successfully')
        expect(body.data.barcode).toBe('036000291452')

        // No serial is drawn: a merchant's own code is not ours to number.
        expect(mockPrisma.$queryRaw).not.toHaveBeenCalled()
        const upsert = mockPrisma.barcode.upsert.mock.calls[0]![0] as any
        expect(upsert.create.serial).toBeUndefined()
    })

    it('stores the code in the one form it is compared in', async () => {
        // A hyphenated, lower-case code typed by hand has to land on the same
        // row the scanner will later produce.
        mockPrisma.productVariant.findFirst.mockResolvedValueOnce(VARIANT)
        mockPrisma.purchaseItem.findFirst.mockResolvedValueOnce(null)
        mockPrisma.barcode.findUnique.mockResolvedValueOnce(null)
        mockPrisma.barcode.upsert.mockResolvedValueOnce({ id: 'bc-9', code: 'SKU99A' })

        const res = await post(app, '/api/labels/issue', {
            variantId: VARIANT_ID,
            code: ' sku-99a ',
        })
        expect(res.status).toBe(201)

        const lookup = mockPrisma.barcode.findUnique.mock.calls[0]![0] as any
        expect(lookup.where.code).toBe('SKU99A')
    })

    it('refuses a code already registered to another product', async () => {
        // Quietly moving it would make the label in the customer's hand ring
        // up as something else.
        mockPrisma.productVariant.findFirst.mockResolvedValueOnce(VARIANT)
        mockPrisma.purchaseItem.findFirst.mockResolvedValueOnce(null)
        mockPrisma.barcode.findUnique.mockResolvedValueOnce({
            status: 'ALLOCATED',
            allocation: {
                variant_id: 'some-other-variant',
                variant: { product: { name: 'Someone Else' } },
            },
        })

        const res = await post(app, '/api/labels/issue', {
            variantId: VARIANT_ID,
            code: '036000291452',
        })
        expect(res.status).toBe(409)

        const body = await json<ErrorBody>(res)
        expect(body.error.code).toBe('BARCODE_TAKEN')
        expect(body.message).toContain('Someone Else')
        expect(mockPrisma.barcode.upsert).not.toHaveBeenCalled()
    })

    it('is idempotent when the code is already on this variant', async () => {
        mockPrisma.productVariant.findFirst.mockResolvedValueOnce(VARIANT)
        mockPrisma.purchaseItem.findFirst.mockResolvedValueOnce(null)
        mockPrisma.barcode.findUnique.mockResolvedValueOnce({
            status: 'ALLOCATED',
            allocation: {
                variant_id: VARIANT_ID,
                variant: { product: { name: 'Test Product' } },
            },
        })

        const res = await post(app, '/api/labels/issue', {
            variantId: VARIANT_ID,
            code: '036000291452',
        })
        expect(res.status).toBe(200)

        const body = await json<ApiResponse<{ issued: boolean }>>(res)
        expect(body.data.issued).toBe(false)
        expect(mockPrisma.barcode.upsert).not.toHaveBeenCalled()
    })

    it('rejects a code too short to be a label', async () => {
        const res = await post(app, '/api/labels/issue', { variantId: VARIANT_ID, code: '  1-2  ' })
        expect(res.status).toBe(422)
    })
})

describe('GET /api/labels/sources', () => {
    it('falls back to the shelf price for a never-purchased variant', async () => {
        mockPrisma.productVariant.findMany.mockResolvedValueOnce([
            {
                id: VARIANT_ID,
                name: 'Red',
                color: 'red',
                size: 'M',
                stock_on_hand: 12,
                last_sell_price: '250',
                product: { name: 'Test Product', brand: 'TestBrand' },
                purchaseItems: [],
                variantBarcodeAllocations: [],
            },
        ])

        const res = await get(app, '/api/labels/sources')
        expect(res.status).toBe(200)

        const body = await json<ApiResponse<Array<{ price: number | null; barcode: string | null }>>>(res)
        expect(body.data[0]!.price).toBe(250)
        expect(body.data[0]!.barcode).toBeNull()
    })

    it('prints the batch price of the label a variant already carries', async () => {
        mockPrisma.productVariant.findMany.mockResolvedValueOnce([
            {
                id: VARIANT_ID,
                name: 'Red',
                color: 'red',
                size: 'M',
                stock_on_hand: 12,
                last_sell_price: '250',
                product: { name: 'Test Product', brand: 'TestBrand' },
                purchaseItems: [{ sell_price: '400' }],
                variantBarcodeAllocations: [
                    { barcode: { code: '2001012345678' }, purchaseItem: { sell_price: '310' } },
                ],
            },
        ])

        const res = await get(app, '/api/labels/sources')
        const body = await json<ApiResponse<Array<{ price: number; barcode: string }>>>(res)
        expect(body.data[0]!.price).toBe(310)
        expect(body.data[0]!.barcode).toBe('2001012345678')
    })

    it('reports no price when the variant has neither', async () => {
        mockPrisma.productVariant.findMany.mockResolvedValueOnce([
            {
                id: VARIANT_ID,
                name: 'Red',
                color: null,
                size: null,
                stock_on_hand: 0,
                last_sell_price: null,
                product: { name: 'Test Product', brand: null },
                purchaseItems: [],
                variantBarcodeAllocations: [],
            },
        ])

        const res = await get(app, '/api/labels/sources')
        const body = await json<ApiResponse<Array<{ price: number | null }>>>(res)
        expect(body.data[0]!.price).toBeNull()
    })
})
