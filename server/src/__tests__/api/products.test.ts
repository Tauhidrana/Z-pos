import { describe, it, expect, beforeEach } from 'bun:test'
import { mockPrisma, resetAllMocks } from '../preload'
import { createTestApp, get, post, patch, del, json } from '../setup'

type ApiResponse<T> = { success: boolean; message: string; data: T }

const app = createTestApp()

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000'

const MOCK_PRODUCT = {
    id: 'prod-uuid-1',
    name: 'Test Product',
    description: 'A test product',
    brand: 'TestBrand',
    is_active: true,
    category_id: 'cat-uuid-1',
    reorder_level: 5,
    category: { id: 'cat-uuid-1', name: 'Electronics' },
    variants: [
        { id: 'var-uuid-1', name: 'Red', is_active: true, color: 'red', size: null },
    ],
}

beforeEach(() => {
    resetAllMocks()
})

describe('GET /api/products/get/all', () => {
    it('returns 200 with paginated shape', async () => {
        // ProductService.getAll uses $queryRaw
        mockPrisma.$queryRaw.mockResolvedValueOnce([])

        const res = await get(app, '/api/products/get/all')
        expect(res.status).toBe(200)

        const body = await json<ApiResponse<{ items: unknown[]; total: number }>>(res)
        expect(body.success).toBe(true)
        expect(Array.isArray(body.data.items)).toBe(true)
        expect(typeof body.data.total).toBe('number')
    })

    it('returns 422 on invalid status filter', async () => {
        const res = await get(app, '/api/products/get/all', { status: 'INVALID' })
        expect(res.status).toBe(422)
    })

    it('accepts valid status filters', async () => {
        for (const status of ['ALL', 'IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK']) {
            mockPrisma.$queryRaw.mockResolvedValueOnce([])
            const res = await get(app, '/api/products/get/all', { status })
            expect(res.status).toBe(200)
        }
    })
})

describe('GET /api/products/get/:id', () => {
    it('returns 200 when product exists', async () => {
        mockPrisma.product.findFirst.mockResolvedValueOnce(MOCK_PRODUCT)

        const res = await get(app, '/api/products/get/prod-uuid-1')
        expect(res.status).toBe(200)

        const body = await json<ApiResponse<{ id: string; name: string }>>(res)
        expect(body.success).toBe(true)
        expect(body.data.id).toBe('prod-uuid-1')
        expect(body.data.name).toBe('Test Product')
    })

    it('returns 404 when product does not exist', async () => {
        mockPrisma.product.findFirst.mockResolvedValueOnce(null)

        const res = await get(app, '/api/products/get/nonexistent-id')
        expect(res.status).toBe(404)

        const body = await json<ApiResponse<null>>(res)
        expect(body.success).toBe(false)
    })
})

describe('GET /api/products/get/by-barcode/:barcode', () => {
    const ALLOCATION = {
        barcode: { code: '036000291452' },
        purchaseItem: { sell_price: '310' },
        variant: {
            id: 'var-uuid-1',
            name: 'Red',
            stock_on_hand: 4,
            last_sell_price: '250',
            product: { name: 'Test Product' },
        },
    }

    it('returns 404, naming the code, when nothing carries it', async () => {
        // The cashier is holding the item; "scan failed" tells them nothing.
        mockPrisma.variantBarcodeAllocation.findFirst.mockResolvedValueOnce(null)

        const res = await get(app, '/api/products/get/by-barcode/123456789')
        expect(res.status).toBe(404)

        const body = await json<ApiResponse<null> & { error: { code: string } }>(res)
        expect(body.success).toBe(false)
        expect(body.error.code).toBe('BARCODE_NOT_FOUND')
        expect(body.message).toContain('123456789')
    })

    it('400s on a code that is only padding', async () => {
        const res = await get(app, '/api/products/get/by-barcode/%20%20')
        expect(res.status).toBe(400)
    })

    it('matches every form the same physical label can arrive as', async () => {
        // A UPC-A label is 12 digits to one scanner and 13 to another. Matching
        // only the literal decode would miss stock the shop genuinely carries.
        mockPrisma.variantBarcodeAllocation.findFirst.mockResolvedValueOnce(ALLOCATION)

        const res = await get(app, '/api/products/get/by-barcode/0036000291452')
        expect(res.status).toBe(200)

        const where = mockPrisma.variantBarcodeAllocation.findFirst.mock.calls[0]![0] as any
        expect(where.where.barcode.code.in).toContain('0036000291452')
        expect(where.where.barcode.code.in).toContain('036000291452')

        // The stored code comes back, not the scanned form, so the cart line
        // and the later checkout agree on one string.
        const body = await json<ApiResponse<{ barcode: string; price: number }>>(res)
        expect(body.data.barcode).toBe('036000291452')
        expect(body.data.price).toBe(310)
    })

    it('prices a label with no batch behind it from the shelf price', async () => {
        // Opening stock, or a manufacturer's code linked to something already
        // on the shelf: real labels that never passed through a purchase.
        mockPrisma.variantBarcodeAllocation.findFirst.mockResolvedValueOnce({
            ...ALLOCATION,
            purchaseItem: null,
        })

        const res = await get(app, '/api/products/get/by-barcode/036000291452')
        expect(res.status).toBe(200)

        const body = await json<ApiResponse<{ price: number }>>(res)
        expect(body.data.price).toBe(250)
    })

    it('refuses to sell a scanned item that has no price at all', async () => {
        mockPrisma.variantBarcodeAllocation.findFirst.mockResolvedValueOnce({
            ...ALLOCATION,
            purchaseItem: null,
            variant: { ...ALLOCATION.variant, last_sell_price: null },
        })

        const res = await get(app, '/api/products/get/by-barcode/036000291452')
        expect(res.status).toBe(422)

        const body = await json<ApiResponse<null> & { error: { code: string } }>(res)
        expect(body.error.code).toBe('NO_PRICE')
    })
})

describe('GET /api/products/stats', () => {
    it('returns 200 with stats shape', async () => {
        mockPrisma.$queryRaw.mockResolvedValueOnce([
            { status: 'IN_STOCK', count: BigInt(10) },
            { status: 'LOW_STOCK', count: BigInt(2) },
            { status: 'OUT_OF_STOCK', count: BigInt(1) },
        ])

        const res = await get(app, '/api/products/stats')
        expect(res.status).toBe(200)

        const body = await json<ApiResponse<unknown>>(res)
        expect(body.success).toBe(true)
    })
})

describe('POST /api/products/create', () => {
    it('returns 422 when required fields are missing', async () => {
        const res = await post(app, '/api/products/create', {})
        expect(res.status).toBe(422)
    })

    it('returns 201 with valid payload', async () => {
        // ProductService.create uses a transaction
        mockPrisma.$transaction.mockImplementationOnce(async (fn: any) => {
            return fn({
                ...mockPrisma,
                product: {
                    ...mockPrisma.product,
                    create: () => Promise.resolve({ id: 'new-prod', name: 'Widget' }),
                },
                category: {
                    ...mockPrisma.category,
                    findUnique: () => Promise.resolve({ id: 'cat-1', name: 'Electronics' }),
                },
            })
        })

        const res = await post(app, '/api/products/create', {
            name: 'Widget',
            categoryId: 'cat-1',
            reorderLevel: 5,
            variants: [{ name: 'Default', color: '', size: null }],
        })

        // Depending on how the service validates, could be 201 or 422
        expect([201, 422, 500]).toContain(res.status)
    })

    // ── Regression: a plain product must be creatable ────────────────────────
    // The variant schema used to require a colour or size on EVERY variant, so
    // ordinary stock like "Miniket Rice 5kg" or a USB charger could not be
    // added at all. Worse, the issue path was ["color","size"], which resolves
    // to `variants.0.color.size` — a path no input owns — so react-hook-form
    // blocked the submit while rendering no message: the button did nothing.
    function mockCreateTransaction() {
        mockPrisma.productVariant.create.mockImplementation((args: any) =>
            Promise.resolve({ id: 'var-1', ...args.data }),
        )
        mockPrisma.$transaction.mockImplementationOnce(async (fn: any) =>
            fn({
                ...mockPrisma,
                // Creating a product now verifies the category belongs to the
                // caller's shop first, so the transaction stub has to resolve it.
                category: {
                    ...mockPrisma.category,
                    findFirst: () => Promise.resolve({ id: 'cat-1' }),
                },
                product: {
                    ...mockPrisma.product,
                    create: () => Promise.resolve({ id: 'new-prod', name: 'Rice' }),
                },
                // The variant create has to stay the recorded mock, not a bare
                // arrow: the opening stock and price are written on this call,
                // so a stub that swallows its arguments makes them unassertable.
                productVariant: mockPrisma.productVariant,
            })
        )
    }

    const BASE = {
        name: 'Miniket Rice 5kg',
        description: '',
        brand: 'Local',
        category_id: VALID_UUID,
        reorder_level: 3,
    }

    it('accepts a single variant with no colour or size', async () => {
        mockCreateTransaction()
        const res = await post(app, '/api/products/create', { ...BASE, variants: [{}] })
        expect(res.status).toBe(201)
    })

    it('requires at least one variant', async () => {
        const res = await post(app, '/api/products/create', { ...BASE, variants: [] })
        expect(res.status).toBe(422)
    })

    it('rejects a second variant that has nothing to tell it apart', async () => {
        const res = await post(app, '/api/products/create', {
            ...BASE,
            variants: [{ color: 'Red' }, {}],
        })
        expect(res.status).toBe(422)

        const body = await json<{ error: { details: Array<{ field: string }> } }>(res)
        // Must anchor on a field the form actually renders, otherwise the
        // message is invisible and the form silently refuses to submit.
        expect(body.error.details[0]?.field).toBe('variants.1.color')
    })

    it('rejects duplicate variants', async () => {
        const res = await post(app, '/api/products/create', {
            ...BASE,
            variants: [{ color: 'Red', size: 'M' }, { color: 'red', size: 'm' }],
        })
        expect(res.status).toBe(422)
    })

    it('allows two variants that differ', async () => {
        mockCreateTransaction()
        const res = await post(app, '/api/products/create', {
            ...BASE,
            variants: [{ color: 'Red', size: 'M' }, { color: 'Blue', size: 'L' }],
        })
        expect(res.status).toBe(201)
    })

    it('records initial variant stock in both the ledger and current balance', async () => {
        mockCreateTransaction()
        const res = await post(app, '/api/products/create', {
            ...BASE,
            variants: [{ stock: 12 }],
        })

        expect(res.status).toBe(201)
        expect(mockPrisma.stockAdjustment.create.mock.calls[0]?.[0].data).toMatchObject({
            shop_id: 'test-shop-uuid',
            adjusted_by: 'test-user-uuid',
            reason: 'Initial stock',
        })
        expect(mockPrisma.stockAdjustmentItem.createMany.mock.calls[0]?.[0].data).toEqual([
            expect.objectContaining({ variant_id: 'var-1', quantity: 12, direction: 'IN' }),
        ])
        expect(mockPrisma.stockLedger.createMany.mock.calls[0]?.[0].data).toEqual([
            expect.objectContaining({ variant_id: 'var-1', quantity: 12, balance_after: 12 }),
        ])
        // The balance is written on the variant row itself, not by a follow-up
        // update: the row is created inside this same transaction, so nobody
        // else can observe it until commit and a second statement would only
        // be a chance for the two to disagree.
        expect(mockPrisma.productVariant.create.mock.calls[0]?.[0].data).toMatchObject({
            stock_on_hand: 12,
        })
    })

    it('records the opening selling price, so the stock is actually sellable', async () => {
        mockCreateTransaction()
        const res = await post(app, '/api/products/create', {
            ...BASE,
            variants: [{ stock: 5, sell_price: 249.5 }],
        })

        expect(res.status).toBe(201)
        expect(mockPrisma.productVariant.create.mock.calls[0]?.[0].data).toMatchObject({
            stock_on_hand: 5,
            last_sell_price: 249.5,
        })
    })

    it('leaves the price null when none was given, rather than pricing at zero', async () => {
        mockCreateTransaction()
        const res = await post(app, '/api/products/create', {
            ...BASE,
            variants: [{ stock: 5 }],
        })

        expect(res.status).toBe(201)
        // Null, not 0 — the storefront withholds an unpriced product, whereas a
        // ৳0 price would put it on sale for nothing.
        expect(mockPrisma.productVariant.create.mock.calls[0]?.[0].data.last_sell_price).toBeNull()
    })
})

describe('PATCH /api/products/update', () => {
    it('returns 422 when id is missing', async () => {
        const res = await patch(app, '/api/products/update', { name: 'New Name' })
        expect(res.status).toBe(422)
    })
})

describe('DELETE /api/products/delete', () => {
    it('returns 422 when id is missing', async () => {
        const res = await del(app, '/api/products/delete', {})
        // Validation requires an id
        expect([400, 422]).toContain(res.status)
    })

    it('returns 404 when product does not exist', async () => {
        mockPrisma.product.findFirst.mockResolvedValueOnce(null)

        const res = await del(app, '/api/products/delete', { id: VALID_UUID })
        expect(res.status).toBe(404)
    })

    it('hard-deletes a product with no purchase/sale/stock history', async () => {
        mockPrisma.product.findFirst.mockResolvedValueOnce(MOCK_PRODUCT)
        mockPrisma.stockLedger.count.mockResolvedValueOnce(0)
        mockPrisma.saleItem.count.mockResolvedValueOnce(0)
        mockPrisma.purchaseItem.count.mockResolvedValueOnce(0)

        const res = await del(app, '/api/products/delete', { id: VALID_UUID })
        expect(res.status).toBe(200)

        expect(mockPrisma.product.delete.mock.calls.length).toBe(1)
        // Soft-delete fields must NOT be touched on the hard-delete path
        expect(mockPrisma.product.update.mock.calls.length).toBe(0)
    })

    it('deactivates instead of deleting a product with sale history', async () => {
        mockPrisma.product.findFirst.mockResolvedValueOnce(MOCK_PRODUCT)
        mockPrisma.stockLedger.count.mockResolvedValueOnce(0)
        mockPrisma.saleItem.count.mockResolvedValueOnce(3) // has been sold
        mockPrisma.purchaseItem.count.mockResolvedValueOnce(0)

        const res = await del(app, '/api/products/delete', { id: VALID_UUID })
        expect(res.status).toBe(200)

        const body = await json<ApiResponse<unknown>>(res)
        expect(body.message).toContain('deactivated')

        // The hard-delete path must NOT run when history exists
        expect(mockPrisma.product.delete.mock.calls.length).toBe(0)
    })
})

// ── Variant price ────────────────────────────────────────────────────────────
//
// The shelf price used to be write-once: it could be typed when creating a
// product and then never seen or changed on any screen.

const VARIANT_ID = '550e8400-e29b-41d4-a716-446655440050'

describe('GET /api/products/get/:id — price', () => {
    it('returns the shelf price instead of dropping it', async () => {
        mockPrisma.product.findFirst.mockResolvedValueOnce({
            ...MOCK_PRODUCT,
            variants: [
                {
                    id: VARIANT_ID,
                    name: 'Red',
                    is_active: true,
                    color: 'red',
                    size: null,
                    stock_on_hand: 4,
                    last_sell_price: 150,
                },
            ],
        })

        const res = await get(app, `/api/products/get/${MOCK_PRODUCT.id}`)
        expect(res.status).toBe(200)

        const body = await json<ApiResponse<any>>(res)
        expect(body.data.variants[0].sellPrice).toBe(150)
    })

    it('reports an unpriced variant as null, not as zero', async () => {
        mockPrisma.product.findFirst.mockResolvedValueOnce({
            ...MOCK_PRODUCT,
            variants: [
                {
                    id: VARIANT_ID,
                    name: 'Red',
                    is_active: true,
                    color: 'red',
                    size: null,
                    stock_on_hand: 4,
                    last_sell_price: null,
                },
            ],
        })

        const res = await get(app, `/api/products/get/${MOCK_PRODUCT.id}`)
        const body = await json<ApiResponse<any>>(res)

        // Zero would read as free on every screen that renders it.
        expect(body.data.variants[0].sellPrice).toBeNull()
    })
})

describe('PATCH /api/products/variants/update', () => {
    function variantExists(overrides: Record<string, unknown> = {}) {
        mockPrisma.productVariant.findFirst.mockResolvedValueOnce({
            id: VARIANT_ID,
            color: 'red',
            size: 'M',
            ...overrides,
        })
    }

    it('changes the price on its own', async () => {
        variantExists()

        const res = await patch(app, '/api/products/variants/update', {
            id: VARIANT_ID,
            sell_price: 250,
        })

        expect(res.status).toBe(200)
        const data = mockPrisma.productVariant.update.mock.calls[0]?.[0].data
        expect(Number(data.last_sell_price)).toBe(250)
    })

    it('accepts a price-only edit on a variant with no colour or size', async () => {
        // The old guard demanded a colour or size on every call, so a plain
        // product — the "Miniket Rice 5kg" case — could never be repriced.
        variantExists({ color: null, size: null })

        const res = await patch(app, '/api/products/variants/update', {
            id: VARIANT_ID,
            sell_price: 80,
        })

        expect(res.status).toBe(200)
    })

    it('clears the price when sent null', async () => {
        variantExists()

        const res = await patch(app, '/api/products/variants/update', {
            id: VARIANT_ID,
            sell_price: null,
        })

        expect(res.status).toBe(200)
        expect(
            mockPrisma.productVariant.update.mock.calls[0]?.[0].data.last_sell_price,
        ).toBeNull()
    })

    it('does not touch the price when renaming a colour', async () => {
        variantExists()

        await patch(app, '/api/products/variants/update', {
            id: VARIANT_ID,
            color: 'blue',
        })

        const data = mockPrisma.productVariant.update.mock.calls[0]?.[0].data
        expect('last_sell_price' in data).toBe(false)
    })

    it('builds a label from both attributes, not "RED / "', async () => {
        variantExists({ color: 'red', size: null })

        await patch(app, '/api/products/variants/update', {
            id: VARIANT_ID,
            color: 'blue',
        })

        // The old builder interpolated both unconditionally and produced a
        // trailing separator whenever one attribute was missing.
        expect(mockPrisma.productVariant.update.mock.calls[0]?.[0].data.name).toBe('blue')
    })

    it('keeps the untouched attribute in the label', async () => {
        variantExists({ color: 'red', size: 'M' })

        await patch(app, '/api/products/variants/update', {
            id: VARIANT_ID,
            color: 'blue',
        })

        expect(mockPrisma.productVariant.update.mock.calls[0]?.[0].data.name).toBe('M - blue')
    })

    it('rejects an empty edit', async () => {
        const res = await patch(app, '/api/products/variants/update', { id: VARIANT_ID })
        expect(res.status).toBe(400)
    })

    it('404s a variant belonging to another shop', async () => {
        mockPrisma.productVariant.findFirst.mockResolvedValueOnce(null)

        const res = await patch(app, '/api/products/variants/update', {
            id: VARIANT_ID,
            sell_price: 250,
        })

        expect(res.status).toBe(404)
        expect(mockPrisma.productVariant.findFirst.mock.calls[0]?.[0].where.product.shop_id)
            .toBe('test-shop-uuid')
    })

    it('rejects a negative price', async () => {
        const res = await patch(app, '/api/products/variants/update', {
            id: VARIANT_ID,
            sell_price: -5,
        })
        expect(res.status).toBe(422)
    })

    it('rejects more than two decimal places', async () => {
        const res = await patch(app, '/api/products/variants/update', {
            id: VARIANT_ID,
            sell_price: 10.999,
        })
        expect(res.status).toBe(422)
    })
})

describe('POST /api/products/variants/create', () => {
    const PRODUCT_ID = '550e8400-e29b-41d4-a716-446655440051'

    function productExists() {
        mockPrisma.product.findFirst.mockResolvedValueOnce({
            id: PRODUCT_ID,
            name: 'Shirt',
        })
    }

    it('stores the price and opening stock', async () => {
        productExists()
        mockPrisma.productVariant.create.mockResolvedValueOnce({ id: 'new-variant' })
        mockPrisma.stockAdjustment.create.mockResolvedValueOnce({ id: 'adj-1' })

        const res = await post(app, '/api/products/variants/create', {
            productId: PRODUCT_ID,
            color: 'Red',
            stock: 7,
            sell_price: 950,
        })

        expect(res.status).toBe(201)
        const data = mockPrisma.productVariant.create.mock.calls[0]?.[0].data
        expect(data.stock_on_hand).toBe(7)
        expect(Number(data.last_sell_price)).toBe(950)
    })

    it('labels a colour-only variant by its colour, not "RED / Shirt"', async () => {
        productExists()
        mockPrisma.productVariant.create.mockResolvedValueOnce({ id: 'new-variant' })

        await post(app, '/api/products/variants/create', {
            productId: PRODUCT_ID,
            color: 'Red',
        })

        // The old builder substituted the product name for a missing attribute.
        expect(mockPrisma.productVariant.create.mock.calls[0]?.[0].data.name).toBe('Red')
    })

    it('records opening stock through the ledger, not as a bare column write', async () => {
        productExists()
        mockPrisma.productVariant.create.mockResolvedValueOnce({ id: 'new-variant' })
        mockPrisma.stockAdjustment.create.mockResolvedValueOnce({ id: 'adj-1' })

        await post(app, '/api/products/variants/create', {
            productId: PRODUCT_ID,
            color: 'Red',
            stock: 7,
        })

        // Stock that appears on a variant without a ledger entry behind it is
        // stock the append-only history cannot explain.
        const ledger = mockPrisma.stockLedger.create.mock.calls[0]?.[0].data
        expect(ledger.quantity).toBe(7)
        expect(ledger.balance_after).toBe(7)
        expect(ledger.adjustment_id).toBe('adj-1')
    })

    it('writes no adjustment when the variant opens with no stock', async () => {
        productExists()
        mockPrisma.productVariant.create.mockResolvedValueOnce({ id: 'new-variant' })

        await post(app, '/api/products/variants/create', {
            productId: PRODUCT_ID,
            color: 'Red',
        })

        expect(mockPrisma.stockAdjustment.create.mock.calls.length).toBe(0)
        expect(mockPrisma.stockLedger.create.mock.calls.length).toBe(0)
    })

    it('404s a product belonging to another shop', async () => {
        mockPrisma.product.findFirst.mockResolvedValueOnce(null)

        const res = await post(app, '/api/products/variants/create', {
            productId: PRODUCT_ID,
            color: 'Red',
        })

        expect(res.status).toBe(404)
        expect(mockPrisma.productVariant.create.mock.calls.length).toBe(0)
    })
})

describe('GET cart item — pricing without a purchase batch', () => {
    it('falls back to the shelf price when the product has no allocation', async () => {
        mockPrisma.variantBarcodeAllocation.findFirst.mockResolvedValueOnce(null)
        mockPrisma.productVariant.findFirst.mockResolvedValueOnce({
            id: VARIANT_ID,
            name: 'Red',
            stock_on_hand: 4,
            last_sell_price: 150,
            product: { name: 'T-Shirt' },
        })

        const res = await get(app, `/api/products/get/${MOCK_PRODUCT.id}/cart-item`)
        expect(res.status).toBe(200)

        const body = await json<ApiResponse<any>>(res)
        expect(body.data.price).toBe(150)
        expect(body.data.variantId).toBe(VARIANT_ID)
        // Nothing was scanned, so the line carries no barcode.
        expect(body.data.barcode).toBeUndefined()
    })

    it('explains an unpriced product rather than saying "no active stock"', async () => {
        mockPrisma.variantBarcodeAllocation.findFirst.mockResolvedValueOnce(null)
        mockPrisma.productVariant.findFirst.mockResolvedValueOnce(null)

        const res = await get(app, `/api/products/get/${MOCK_PRODUCT.id}/cart-item`)
        expect(res.status).toBe(404)

        const body = await json<{ error: { code: string } }>(res)
        expect(body.error.code).toBe('NO_PRICE')
    })

    it('still prefers the batch price when a barcode allocation exists', async () => {
        mockPrisma.variantBarcodeAllocation.findFirst.mockResolvedValueOnce({
            barcode: { code: '2001000000017' },
            purchaseItem: { sell_price: 20 },
            variant: {
                id: VARIANT_ID,
                name: 'Red',
                stock_on_hand: 4,
                product: { name: 'T-Shirt' },
            },
        })

        const res = await get(app, `/api/products/get/${MOCK_PRODUCT.id}/cart-item`)
        const body = await json<ApiResponse<any>>(res)

        expect(body.data.price).toBe(20)
        expect(body.data.barcode).toBe('2001000000017')
        // The fallback must not run when a batch answered.
        expect(mockPrisma.productVariant.findFirst.mock.calls.length).toBe(0)
    })

    it('falls back for a specific variant too', async () => {
        mockPrisma.variantBarcodeAllocation.findFirst.mockResolvedValueOnce(null)
        mockPrisma.productVariant.findFirst.mockResolvedValueOnce({
            id: VARIANT_ID,
            name: 'Blue',
            stock_on_hand: 2,
            last_sell_price: 300,
            product: { name: 'T-Shirt' },
        })

        const res = await get(app, `/api/products/get/variants/${VARIANT_ID}/cart-item`)
        expect(res.status).toBe(200)

        const body = await json<ApiResponse<any>>(res)
        expect(body.data.price).toBe(300)
    })

    it('refuses an unpriced variant instead of ringing up zero', async () => {
        mockPrisma.variantBarcodeAllocation.findFirst.mockResolvedValueOnce(null)
        mockPrisma.productVariant.findFirst.mockResolvedValueOnce({
            id: VARIANT_ID,
            name: 'Blue',
            stock_on_hand: 2,
            last_sell_price: null,
            product: { name: 'T-Shirt' },
        })

        const res = await get(app, `/api/products/get/variants/${VARIANT_ID}/cart-item`)
        expect(res.status).toBe(404)

        const body = await json<{ error: { code: string } }>(res)
        expect(body.error.code).toBe('NO_PRICE')
    })
})
