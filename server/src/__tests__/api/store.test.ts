import { describe, it, expect, beforeEach } from 'bun:test'
import { mockPrisma, resetAllMocks } from '../preload'
import { createTestApp, get, post, patch, json } from '../setup'

type ApiResponse<T> = { success: boolean; message: string; data: T }

const app = createTestApp()
const staffApp = createTestApp('STAFF')

const SHOP_ID = 'test-shop-uuid'
const ORDER_ID = '550e8400-e29b-41d4-a716-446655440201'
const VARIANT_ID = '550e8400-e29b-41d4-a716-446655440202'

const STORE_ROW = {
    id: 'store-1',
    slug: 'tds',
    name: 'TDS Fashion',
    description: null,
    logo_url: null,
    banner_url: null,
    favicon_url: null,
    phone: null,
    email: null,
    address: null,
    facebook_url: null,
    instagram_url: null,
    whatsapp_number: null,
    delivery_charge: 60,
    free_delivery_over: null,
    min_order_amount: 0,
    theme_color: '#a8431d',
    is_active: true,
    created_at: new Date('2026-09-01T00:00:00Z'),
}

beforeEach(() => {
    resetAllMocks()
})

describe('store creation', () => {
    it('rejects a reserved address', async () => {
        const res = await post(app, '/api/store', { name: 'Admin Shop', slug: 'admin' })
        expect(res.status).toBe(422)
    })

    it('rejects an address that is not a valid hostname label', async () => {
        for (const slug of ['ab', 'Has Space', '-leading', 'trailing-', 'do--uble', 'a.b']) {
            const res = await post(app, '/api/store', { name: 'Test Shop', slug })
            expect(res.status).toBe(422)
        }
    })

    it('normalises a typed-in address to lower case rather than rejecting it', async () => {
        mockPrisma.store.findUnique.mockResolvedValueOnce(null)
        mockPrisma.store.create.mockResolvedValueOnce(STORE_ROW)

        const res = await post(app, '/api/store', { name: 'TDS Fashion', slug: '  TDS  ' })
        expect(res.status).toBe(201)
        expect(mockPrisma.store.create.mock.calls[0]?.[0].data.slug).toBe('tds')
    })

    it('refuses a second store for the same shop', async () => {
        mockPrisma.store.findUnique.mockResolvedValueOnce({ id: 'store-1' })
        const res = await post(app, '/api/store', { name: 'TDS Fashion', slug: 'tds2' })
        expect(res.status).toBe(409)
        const body = await json<{ error: { code: string } }>(res)
        expect(body.error.code).toBe('STORE_EXISTS')
    })

    it('creates the store against the session shop, not any id from the body', async () => {
        mockPrisma.store.findUnique.mockResolvedValueOnce(null)
        mockPrisma.store.create.mockResolvedValueOnce(STORE_ROW)

        const res = await post(app, '/api/store', {
            name: 'TDS Fashion',
            slug: 'tds',
            // A caller trying to plant their store in someone else's shop.
            shop_id: 'someone-elses-shop',
        })
        expect(res.status).toBe(201)
        expect(mockPrisma.store.create.mock.calls[0]?.[0].data.shop_id).toBe(SHOP_ID)
    })

    it('reports a slug race as a conflict rather than a 500', async () => {
        mockPrisma.store.findUnique.mockResolvedValueOnce(null)
        mockPrisma.store.create.mockImplementationOnce(() =>
            Promise.reject(Object.assign(new Error('unique'), { code: 'P2002' })),
        )

        const res = await post(app, '/api/store', { name: 'TDS Fashion', slug: 'tds' })
        expect(res.status).toBe(409)
    })

    it('is closed to STAFF — opening a storefront is an owner decision', async () => {
        const res = await post(staffApp, '/api/store', { name: 'TDS Fashion', slug: 'tds' })
        expect(res.status).toBe(403)
    })

    it('lets STAFF still work the catalog and orders', async () => {
        mockPrisma.product.findMany.mockResolvedValueOnce([])
        mockPrisma.product.count.mockResolvedValueOnce(0)
        const res = await get(staffApp, '/api/store/products')
        expect(res.status).toBe(200)
    })
})

describe('slug availability', () => {
    it('treats the shop’s own current slug as available', async () => {
        mockPrisma.store.findUnique.mockResolvedValueOnce({ shop_id: SHOP_ID })
        const res = await get(app, '/api/store/slug-check', { slug: 'tds' })
        const body = await json<ApiResponse<{ available: boolean }>>(res)
        expect(body.data.available).toBe(true)
    })

    it('reports another shop’s slug as taken without naming them', async () => {
        mockPrisma.store.findUnique.mockResolvedValueOnce({ shop_id: 'other-shop' })
        const res = await get(app, '/api/store/slug-check', { slug: 'tds' })
        const body = await json<ApiResponse<Record<string, unknown>>>(res)
        expect(body.data.available).toBe(false)
        expect(JSON.stringify(body.data)).not.toContain('other-shop')
    })
})

describe('online pricing', () => {
    it('refuses a discount that is not below the regular price', async () => {
        mockPrisma.productVariant.findFirst.mockResolvedValueOnce({
            id: VARIANT_ID,
            last_sell_price: 900,
            online_price: null,
        })
        const res = await patch(app, '/api/store/variants', {
            id: VARIANT_ID,
            online_sale_price: 950,
        })
        expect(res.status).toBe(422)
        expect(mockPrisma.productVariant.update.mock.calls.length).toBe(0)
    })

    it('scopes the variant lookup to the session shop', async () => {
        mockPrisma.productVariant.findFirst.mockResolvedValueOnce(null)
        const res = await patch(app, '/api/store/variants', { id: VARIANT_ID, online_price: 100 })
        expect(res.status).toBe(404)
        expect(mockPrisma.productVariant.findFirst.mock.calls[0]?.[0].where).toEqual({
            id: VARIANT_ID,
            product: { shop_id: SHOP_ID },
        })
    })

    it('clears an override when sent null', async () => {
        mockPrisma.productVariant.findFirst.mockResolvedValueOnce({
            id: VARIANT_ID,
            last_sell_price: 900,
            online_price: 1100,
        })
        const res = await patch(app, '/api/store/variants', { id: VARIANT_ID, online_price: null })
        expect(res.status).toBe(200)
        // Only the field that was sent. An omitted field must mean "leave it
        // alone" — collapsing it to null would erase the discount every time
        // the merchant saved a regular price.
        expect(mockPrisma.productVariant.update.mock.calls[0]?.[0].data).toEqual({
            online_price: null,
        })
    })

    it('leaves the discount untouched when only the regular price is sent', async () => {
        mockPrisma.productVariant.findFirst.mockResolvedValueOnce({
            id: VARIANT_ID,
            last_sell_price: 900,
            online_price: null,
        })
        const res = await patch(app, '/api/store/variants', { id: VARIANT_ID, online_price: 1200 })
        expect(res.status).toBe(200)
        expect(mockPrisma.productVariant.update.mock.calls[0]?.[0].data).toEqual({
            online_price: expect.anything(),
        })
    })
})

describe('order status transitions', () => {
    function lockOrder(status: string, stockRestored = false) {
        mockPrisma.$queryRaw.mockResolvedValueOnce([
            { id: ORDER_ID, status, stock_restored: stockRestored },
        ])
    }

    it('refuses a backwards transition', async () => {
        lockOrder('SHIPPED')
        const res = await patch(app, '/api/store/orders/status', { id: ORDER_ID, status: 'PENDING' })
        expect(res.status).toBe(422)
        const body = await json<{ error: { code: string } }>(res)
        expect(body.error.code).toBe('INVALID_TRANSITION')
    })

    it('refuses to reopen a delivered order', async () => {
        lockOrder('DELIVERED')
        const res = await patch(app, '/api/store/orders/status', { id: ORDER_ID, status: 'CANCELLED' })
        expect(res.status).toBe(422)
    })

    it('scopes the locked row to the session shop', async () => {
        lockOrder('PENDING')
        await patch(app, '/api/store/orders/status', { id: ORDER_ID, status: 'CONFIRMED' })
        const sql = mockPrisma.$queryRaw.mock.calls[0]?.[0]
        // Prisma.sql carries its interpolated values; the shop must be one.
        expect(sql.values).toContain(SHOP_ID)
    })

    it('returns stock to the shelf on cancellation, as a ledger IN movement', async () => {
        lockOrder('PENDING')
        mockPrisma.onlineOrderItem.findMany.mockResolvedValueOnce([
            { variant_id: VARIANT_ID, quantity: 3 },
        ])
        mockPrisma.$queryRaw.mockResolvedValueOnce([{ id: VARIANT_ID, stock_on_hand: 4 }])

        const res = await patch(app, '/api/store/orders/status', { id: ORDER_ID, status: 'CANCELLED' })
        expect(res.status).toBe(200)

        const ledgerRow = mockPrisma.stockLedger.createMany.mock.calls[0]?.[0].data[0]
        expect(ledgerRow.direction).toBe('IN')
        expect(ledgerRow.quantity).toBe(3)
        expect(ledgerRow.balance_after).toBe(7) // 4 on hand + 3 returned
        expect(mockPrisma.productVariant.update.mock.calls[0]?.[0].data).toEqual({
            stock_on_hand: { increment: 3 },
        })
        expect(mockPrisma.onlineOrder.update.mock.calls[0]?.[0].data.stock_restored).toBe(true)
    })

    it('never restocks the same cancellation twice', async () => {
        // A row that was already cancelled cannot transition again at all, and
        // the guard flag is the second line of defence behind that.
        lockOrder('PENDING', true)
        const res = await patch(app, '/api/store/orders/status', { id: ORDER_ID, status: 'CANCELLED' })
        expect(res.status).toBe(200)
        expect(mockPrisma.stockLedger.createMany.mock.calls.length).toBe(0)
        expect(mockPrisma.productVariant.update.mock.calls.length).toBe(0)
    })

    it('books a delivered order as a paid sale without moving stock again', async () => {
        lockOrder('SHIPPED')
        mockPrisma.onlineOrder.findUnique.mockResolvedValueOnce({
            id: ORDER_ID,
            sale_id: null,
            customer_id: 'cust-1',
            subtotal: 1800,
            delivery_charge: 60,
            total: 1860,
            order_number: 'ORD-001001',
            note: null,
            items: [
                {
                    variant_id: VARIANT_ID,
                    product_name: 'Cotton Shirt',
                    variant_name: 'Blue / L',
                    unit_price: 900,
                    quantity: 2,
                    total: 1800,
                },
            ],
        })
        mockPrisma.counter.upsert.mockResolvedValueOnce({ value: 1042 })
        mockPrisma.sale.create.mockResolvedValueOnce({ id: 'sale-1' })

        const res = await patch(app, '/api/store/orders/status', { id: ORDER_ID, status: 'DELIVERED' })
        expect(res.status).toBe(200)

        const sale = mockPrisma.sale.create.mock.calls[0]?.[0].data
        expect(sale.shop_id).toBe(SHOP_ID)
        expect(sale.status).toBe('COMPLETED')
        expect(sale.delivery_charge).toBe(60)
        expect(sale.payments.create.method).toBe('CASH')
        expect(sale.payments.create.amount).toBe(1860)

        // The units left the shelf when the order was placed. Moving them again
        // here would double-count the sale against inventory.
        expect(mockPrisma.stockLedger.createMany.mock.calls.length).toBe(0)
        expect(mockPrisma.onlineOrder.update.mock.calls[0]?.[0].data.sale_id).toBe('sale-1')
    })

    it('does not write a second invoice for an order already booked', async () => {
        lockOrder('SHIPPED')
        mockPrisma.onlineOrder.findUnique.mockResolvedValueOnce({
            id: ORDER_ID,
            sale_id: 'sale-already-there',
            customer_id: null,
            subtotal: 100,
            delivery_charge: 0,
            total: 100,
            order_number: 'ORD-001001',
            note: null,
            items: [],
        })

        const res = await patch(app, '/api/store/orders/status', { id: ORDER_ID, status: 'DELIVERED' })
        expect(res.status).toBe(200)
        expect(mockPrisma.sale.create.mock.calls.length).toBe(0)
    })

    it('404s an order id that belongs to another shop', async () => {
        mockPrisma.$queryRaw.mockResolvedValueOnce([])
        const res = await patch(app, '/api/store/orders/status', { id: ORDER_ID, status: 'CONFIRMED' })
        expect(res.status).toBe(404)
    })
})

describe('order reads', () => {
    it('scopes a single order fetch to the session shop', async () => {
        mockPrisma.onlineOrder.findFirst.mockResolvedValueOnce(null)
        const res = await get(app, `/api/store/orders/${ORDER_ID}`)
        expect(res.status).toBe(404)
        expect(mockPrisma.onlineOrder.findFirst.mock.calls[0]?.[0].where).toEqual({
            id: ORDER_ID,
            shop_id: SHOP_ID,
        })
    })

    it('counts only delivered orders as revenue', async () => {
        mockPrisma.onlineOrder.count.mockResolvedValue(0)
        mockPrisma.onlineOrder.aggregate.mockResolvedValueOnce({ _sum: { total: 5000 } })

        const res = await get(app, '/api/store/orders/stats')
        expect(res.status).toBe(200)
        expect(mockPrisma.onlineOrder.aggregate.mock.calls[0]?.[0].where).toEqual({
            shop_id: SHOP_ID,
            status: 'DELIVERED',
        })
    })
})
