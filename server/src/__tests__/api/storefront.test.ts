import { describe, it, expect, beforeEach } from 'bun:test'
import { mockPrisma, resetAllMocks } from '../preload'
import { createTestApp, get, post, json } from '../setup'

type ApiResponse<T> = { success: boolean; message: string; data: T }

const app = createTestApp()

const SHOP_ID = 'shop-tds'
const STORE_ID = 'store-tds'
const VARIANT_ID = '550e8400-e29b-41d4-a716-446655440101'
const OTHER_VARIANT_ID = '550e8400-e29b-41d4-a716-446655440102'

const STORE_ROW = {
    id: STORE_ID,
    shop_id: SHOP_ID,
    slug: 'tds',
    name: 'TDS Fashion',
    description: 'Everyday wear',
    logo_url: null,
    banner_url: null,
    favicon_url: null,
    phone: '01711000000',
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
}

function productRow(overrides: Record<string, unknown> = {}) {
    return {
        id: 'prod-1',
        name: 'Cotton Shirt',
        slug: 'cotton-shirt',
        brand: 'TDS',
        created_at: new Date(),
        is_featured: false,
        category: { id: 'cat-1', name: 'Shirts', slug: 'shirts' },
        images: [{ url: 'https://cdn.example.com/shirt.jpg', alt: null }],
        variants: [
            {
                id: VARIANT_ID,
                name: 'Blue / L',
                color: 'Blue',
                size: 'L',
                is_active: true,
                stock_on_hand: 5,
                last_sell_price: 900,
                online_price: null,
                online_sale_price: null,
            },
        ],
        ...overrides,
    }
}

const VALID_ORDER = {
    items: [{ variantId: VARIANT_ID, quantity: 2 }],
    customer: { name: 'Rahim Uddin', phone: '01711223344' },
    address: {
        division: 'Dhaka',
        district: 'Dhaka',
        upazila: 'Savar',
        area: 'Bank Colony',
        addressLine: 'House 12, Road 4, Savar',
    },
    paymentMethod: 'COD',
}

beforeEach(() => {
    resetAllMocks()
})

describe('storefront tenant resolution', () => {
    it('404s an unknown store slug', async () => {
        mockPrisma.store.findUnique.mockResolvedValueOnce(null)
        const res = await get(app, '/api/storefront/nope')
        expect(res.status).toBe(404)
        const body = await json<{ error: { code: string } }>(res)
        expect(body.error.code).toBe('STORE_NOT_FOUND')
    })

    it('403s a store the merchant switched off, distinctly from a missing one', async () => {
        mockPrisma.store.findUnique.mockResolvedValueOnce({ ...STORE_ROW, is_active: false })
        const res = await get(app, '/api/storefront/tds')
        expect(res.status).toBe(403)
        const body = await json<{ error: { code: string } }>(res)
        expect(body.error.code).toBe('STORE_DISABLED')
    })

    it('scopes every catalog query to the resolved store’s shop', async () => {
        mockPrisma.store.findUnique.mockResolvedValueOnce(STORE_ROW)
        mockPrisma.product.findMany.mockResolvedValue([])
        mockPrisma.product.count.mockResolvedValueOnce(0)

        const res = await get(app, '/api/storefront/tds/products')
        expect(res.status).toBe(200)

        const where = mockPrisma.product.findMany.mock.calls[0]?.[0].where
        expect(where.shop_id).toBe(SHOP_ID)
        expect(where.online_visible).toBe(true)
        expect(where.is_active).toBe(true)
    })
})

describe('storefront pricing', () => {
    it('withholds a product whose variants have never been priced', async () => {
        mockPrisma.store.findUnique.mockResolvedValueOnce(STORE_ROW)
        mockPrisma.product.findMany.mockResolvedValueOnce([
            productRow({
                variants: [
                    {
                        id: VARIANT_ID,
                        name: null,
                        color: null,
                        size: null,
                        is_active: true,
                        stock_on_hand: 3,
                        last_sell_price: null,
                        online_price: null,
                        online_sale_price: null,
                    },
                ],
            }),
        ])
        mockPrisma.product.count.mockResolvedValueOnce(1)

        const res = await get(app, '/api/storefront/tds/products')
        const body = await json<ApiResponse<{ items: unknown[] }>>(res)
        expect(body.data.items).toHaveLength(0)
    })

    it('shows a discount only when it is genuinely below the regular price', async () => {
        mockPrisma.store.findUnique.mockResolvedValueOnce(STORE_ROW)
        mockPrisma.product.findMany.mockResolvedValueOnce([
            productRow({
                variants: [
                    {
                        id: VARIANT_ID,
                        name: null,
                        color: null,
                        size: null,
                        is_active: true,
                        stock_on_hand: 3,
                        last_sell_price: 1000,
                        online_price: null,
                        // Above the regular price: not a discount, so it must
                        // neither be charged nor rendered as a strikethrough.
                        online_sale_price: 1200,
                    },
                ],
            }),
        ])
        mockPrisma.product.count.mockResolvedValueOnce(1)

        const res = await get(app, '/api/storefront/tds/products')
        const body = await json<ApiResponse<{ items: Array<{ price: number; compareAtPrice: number | null }> }>>(res)
        expect(body.data.items[0]?.price).toBe(1000)
        expect(body.data.items[0]?.compareAtPrice).toBeNull()
    })

    it('prefers the online override over the shelf price', async () => {
        mockPrisma.store.findUnique.mockResolvedValueOnce(STORE_ROW)
        mockPrisma.product.findMany.mockResolvedValueOnce([
            productRow({
                variants: [
                    {
                        id: VARIANT_ID,
                        name: null,
                        color: null,
                        size: null,
                        is_active: true,
                        stock_on_hand: 3,
                        last_sell_price: 900,
                        online_price: 1100,
                        online_sale_price: 990,
                    },
                ],
            }),
        ])
        mockPrisma.product.count.mockResolvedValueOnce(1)

        const res = await get(app, '/api/storefront/tds/products')
        const body = await json<ApiResponse<{ items: Array<{ price: number; compareAtPrice: number | null; discountPercent: number | null }> }>>(res)
        expect(body.data.items[0]?.price).toBe(990)
        expect(body.data.items[0]?.compareAtPrice).toBe(1100)
        expect(body.data.items[0]?.discountPercent).toBe(10)
    })
})

describe('POST /api/storefront/:slug/orders', () => {
    function stubOrderDeps(stock = 10) {
        mockPrisma.store.findUnique.mockResolvedValue(STORE_ROW)
        mockPrisma.productVariant.findMany.mockResolvedValueOnce([
            {
                id: VARIANT_ID,
                name: 'Blue / L',
                color: 'Blue',
                size: 'L',
                is_active: true,
                stock_on_hand: stock,
                last_sell_price: 900,
                online_price: null,
                online_sale_price: null,
                product: { name: 'Cotton Shirt', images: [{ url: 'https://cdn.example.com/shirt.jpg' }] },
            },
        ])
        mockPrisma.customer.upsert.mockResolvedValueOnce({ id: 'cust-1' })
        mockPrisma.$queryRaw.mockResolvedValueOnce([{ id: VARIANT_ID, stock_on_hand: stock }])
        mockPrisma.counter.upsert.mockResolvedValueOnce({ value: 1001 })
        mockPrisma.onlineOrder.create.mockResolvedValueOnce({
            id: 'order-1',
            order_number: 'ORD-001001',
            placed_at: new Date('2026-09-06T10:00:00Z'),
        })
    }

    it('rejects a phone number that is not Bangladeshi', async () => {
        mockPrisma.store.findUnique.mockResolvedValueOnce(STORE_ROW)
        const res = await post(app, '/api/storefront/tds/orders', {
            ...VALID_ORDER,
            customer: { name: 'Rahim Uddin', phone: '+15551234567' },
        })
        expect(res.status).toBe(422)
    })

    it('rejects an upazila that does not belong to the district', async () => {
        mockPrisma.store.findUnique.mockResolvedValueOnce(STORE_ROW)
        const res = await post(app, '/api/storefront/tds/orders', {
            ...VALID_ORDER,
            address: { ...VALID_ORDER.address, district: 'Dhaka', upazila: 'Sreemangal' },
        })
        expect(res.status).toBe(422)
        const body = await json<{ error: { code: string } }>(res)
        expect(body.error.code).toBe('INVALID_ADDRESS')
    })

    it('prices the order from the catalog, ignoring any price the client sends', async () => {
        stubOrderDeps()
        const res = await post(app, '/api/storefront/tds/orders', {
            ...VALID_ORDER,
            // A tampered cart: these must have no effect whatsoever.
            items: [{ variantId: VARIANT_ID, quantity: 2, price: 1, unitPrice: 1 }],
            subtotal: 2,
            total: 2,
            deliveryCharge: 0,
        })

        expect(res.status).toBe(201)
        const body = await json<ApiResponse<{ subtotal: number; deliveryCharge: number; total: number }>>(res)
        expect(body.data.subtotal).toBe(1800) // 900 × 2, from the catalog
        expect(body.data.deliveryCharge).toBe(60) // from the store settings
        expect(body.data.total).toBe(1860)
    })

    it('refuses an order for a variant belonging to another shop', async () => {
        mockPrisma.store.findUnique.mockResolvedValueOnce(STORE_ROW)
        // The tenant filter in the query matches nothing for a foreign variant.
        mockPrisma.productVariant.findMany.mockResolvedValueOnce([])

        const res = await post(app, '/api/storefront/tds/orders', {
            ...VALID_ORDER,
            items: [{ variantId: OTHER_VARIANT_ID, quantity: 1 }],
        })
        expect(res.status).toBe(422)
        const body = await json<{ error: { code: string } }>(res)
        expect(body.error.code).toBe('ITEM_UNAVAILABLE')
    })

    it('refuses to oversell, using the stock read under the row lock', async () => {
        mockPrisma.store.findUnique.mockResolvedValue(STORE_ROW)
        mockPrisma.productVariant.findMany.mockResolvedValueOnce([
            {
                id: VARIANT_ID,
                name: null,
                color: null,
                size: null,
                is_active: true,
                // Stale read: plenty in stock a moment ago…
                stock_on_hand: 10,
                last_sell_price: 900,
                online_price: null,
                online_sale_price: null,
                product: { name: 'Cotton Shirt', images: [] },
            },
        ])
        mockPrisma.customer.upsert.mockResolvedValueOnce({ id: 'cust-1' })
        // …but only one left by the time the row is locked.
        mockPrisma.$queryRaw.mockResolvedValueOnce([{ id: VARIANT_ID, stock_on_hand: 1 }])

        const res = await post(app, '/api/storefront/tds/orders', VALID_ORDER)
        expect(res.status).toBe(422)
        const body = await json<{ error: { code: string } }>(res)
        expect(body.error.code).toBe('INSUFFICIENT_STOCK')
        expect(mockPrisma.onlineOrder.create.mock.calls.length).toBe(0)
    })

    it('commits stock when the order is placed, not when it ships', async () => {
        stubOrderDeps()
        const res = await post(app, '/api/storefront/tds/orders', VALID_ORDER)
        expect(res.status).toBe(201)

        const ledgerRow = mockPrisma.stockLedger.createMany.mock.calls[0]?.[0].data[0]
        expect(ledgerRow.direction).toBe('OUT')
        expect(ledgerRow.quantity).toBe(2)
        expect(ledgerRow.balance_after).toBe(8) // 10 on hand − 2 ordered
        expect(ledgerRow.online_order_id).toBe('order-1')

        expect(mockPrisma.productVariant.update.mock.calls[0]?.[0]).toEqual({
            where: { id: VARIANT_ID },
            data: { stock_on_hand: { decrement: 2 } },
        })
    })

    it('enforces the store minimum order', async () => {
        mockPrisma.store.findUnique.mockResolvedValueOnce({ ...STORE_ROW, min_order_amount: 5000 })
        mockPrisma.productVariant.findMany.mockResolvedValueOnce([
            {
                id: VARIANT_ID,
                name: null,
                color: null,
                size: null,
                is_active: true,
                stock_on_hand: 10,
                last_sell_price: 900,
                online_price: null,
                online_sale_price: null,
                product: { name: 'Cotton Shirt', images: [] },
            },
        ])

        const res = await post(app, '/api/storefront/tds/orders', VALID_ORDER)
        expect(res.status).toBe(422)
        const body = await json<{ error: { code: string } }>(res)
        expect(body.error.code).toBe('BELOW_MIN_ORDER')
    })

    it('waives delivery above the free-shipping threshold', async () => {
        mockPrisma.store.findUnique.mockResolvedValue({ ...STORE_ROW, free_delivery_over: 1500 })
        mockPrisma.productVariant.findMany.mockResolvedValueOnce([
            {
                id: VARIANT_ID,
                name: null,
                color: null,
                size: null,
                is_active: true,
                stock_on_hand: 10,
                last_sell_price: 900,
                online_price: null,
                online_sale_price: null,
                product: { name: 'Cotton Shirt', images: [] },
            },
        ])
        mockPrisma.customer.upsert.mockResolvedValueOnce({ id: 'cust-1' })
        mockPrisma.$queryRaw.mockResolvedValueOnce([{ id: VARIANT_ID, stock_on_hand: 10 }])
        mockPrisma.counter.upsert.mockResolvedValueOnce({ value: 1002 })
        mockPrisma.onlineOrder.create.mockResolvedValueOnce({
            id: 'order-2',
            order_number: 'ORD-001002',
            placed_at: new Date(),
        })

        const res = await post(app, '/api/storefront/tds/orders', VALID_ORDER)
        const body = await json<ApiResponse<{ deliveryCharge: number; total: number }>>(res)
        expect(body.data.deliveryCharge).toBe(0)
        expect(body.data.total).toBe(1800)
    })
})

describe('GET /api/storefront/:slug/orders/:orderNumber', () => {
    it('requires the phone number, so sequential order numbers leak nothing', async () => {
        mockPrisma.store.findUnique.mockResolvedValueOnce(STORE_ROW)
        const res = await get(app, '/api/storefront/tds/orders/ORD-001001')
        expect(res.status).toBe(404)
        expect(mockPrisma.onlineOrder.findFirst.mock.calls.length).toBe(0)
    })

    it('matches on shop, order number and phone together', async () => {
        mockPrisma.store.findUnique.mockResolvedValueOnce(STORE_ROW)
        mockPrisma.onlineOrder.findFirst.mockResolvedValueOnce(null)

        const res = await get(app, '/api/storefront/tds/orders/ORD-001001', { phone: '01711223344' })
        expect(res.status).toBe(404)

        const where = mockPrisma.onlineOrder.findFirst.mock.calls[0]?.[0].where
        expect(where).toEqual({
            shop_id: SHOP_ID,
            order_number: 'ORD-001001',
            customer_phone: '01711223344',
        })
    })
})
