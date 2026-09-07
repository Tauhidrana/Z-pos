import { describe, it, expect, beforeEach } from 'bun:test'
import { mockPrisma, resetAllMocks } from '../preload'
import { createTestApp, get, post, patch, del, json } from '../setup'
import { MAX_STORE_BANNERS } from '@myapp/shared/schemas/store.schema'

type ApiResponse<T> = { success: boolean; message: string; data: T }

const app = createTestApp()
const staffApp = createTestApp('STAFF')

const SHOP_ID = 'test-shop-uuid'
const STORE_ID = 'store-1'

const BANNER_ID = '550e8400-e29b-41d4-a716-446655440301'
const OTHER_BANNER_ID = '550e8400-e29b-41d4-a716-446655440302'
const IMAGE_ID = '550e8400-e29b-41d4-a716-446655440303'
const IMAGE_REF = `media:${IMAGE_ID}`

/** The shop has a store. Every banner handler starts by looking this up. */
function hasStore() {
    mockPrisma.store.findUnique.mockResolvedValue({ id: STORE_ID })
}

/** The uploaded artwork belongs to this shop, so `resolveImageRefs` passes. */
function ownsImage() {
    mockPrisma.mediaAsset.findMany.mockResolvedValue([{ id: IMAGE_ID }])
}

beforeEach(() => {
    resetAllMocks()
})

describe('GET /api/store/banners', () => {
    it('404s a shop that has not opened a store yet', async () => {
        mockPrisma.store.findUnique.mockResolvedValueOnce(null)

        const res = await get(app, '/api/store/banners')
        expect(res.status).toBe(404)
        const body = await json<{ error: { code: string } }>(res)
        expect(body.error.code).toBe('STORE_NOT_FOUND')
    })

    it('returns the store’s own banners in display order', async () => {
        hasStore()
        mockPrisma.storeBanner.findMany.mockResolvedValueOnce([
            { id: BANNER_ID, image_url: IMAGE_REF, position: 0, is_active: true },
        ])

        const res = await get(app, '/api/store/banners')
        expect(res.status).toBe(200)

        const args = mockPrisma.storeBanner.findMany.mock.calls[0]?.[0]
        expect(args.where.store_id).toBe(STORE_ID)
        expect(args.orderBy).toEqual([{ position: 'asc' }, { created_at: 'asc' }])
    })
})

describe('POST /api/store/banners', () => {
    it('refuses a javascript: button link', async () => {
        hasStore()
        ownsImage()

        const res = await post(app, '/api/store/banners', {
            image_url: IMAGE_REF,
            // eslint-disable-next-line no-script-url
            button_link: 'javascript:alert(document.cookie)',
        })

        expect(res.status).toBe(422)
        expect(mockPrisma.storeBanner.create.mock.calls.length).toBe(0)
    })

    it('refuses a data: button link', async () => {
        hasStore()
        ownsImage()

        const res = await post(app, '/api/store/banners', {
            image_url: IMAGE_REF,
            button_link: 'data:text/html,<script>alert(1)</script>',
        })

        expect(res.status).toBe(422)
        expect(mockPrisma.storeBanner.create.mock.calls.length).toBe(0)
    })

    it('accepts a storefront-relative path and an https link', async () => {
        for (const link of ['/category/shoes', 'https://example.com/sale']) {
            resetAllMocks()
            hasStore()
            ownsImage()
            mockPrisma.storeBanner.count.mockResolvedValueOnce(0)
            mockPrisma.storeBanner.create.mockResolvedValueOnce({ id: BANNER_ID })

            const res = await post(app, '/api/store/banners', {
                image_url: IMAGE_REF,
                button_link: link,
            })

            expect(res.status).toBe(201)
            expect(mockPrisma.storeBanner.create.mock.calls[0]?.[0].data.button_link).toBe(link)
        }
    })

    it('refuses artwork that belongs to another shop', async () => {
        hasStore()
        // The ownership lookup is scoped to the session's shop, so another
        // merchant's asset simply is not found.
        mockPrisma.mediaAsset.findMany.mockResolvedValueOnce([])

        const res = await post(app, '/api/store/banners', { image_url: IMAGE_REF })

        expect(res.status).toBe(422)
        expect(mockPrisma.mediaAsset.findMany.mock.calls[0]?.[0].where.shop_id).toBe(SHOP_ID)
        expect(mockPrisma.storeBanner.create.mock.calls.length).toBe(0)
    })

    it('refuses more than the carousel holds', async () => {
        hasStore()
        ownsImage()
        mockPrisma.storeBanner.count.mockResolvedValueOnce(MAX_STORE_BANNERS)

        const res = await post(app, '/api/store/banners', { image_url: IMAGE_REF })

        expect(res.status).toBe(422)
        const body = await json<{ error: { code: string } }>(res)
        expect(body.error.code).toBe('BANNER_LIMIT')
        expect(mockPrisma.storeBanner.create.mock.calls.length).toBe(0)
    })

    it('appends after the last slide rather than in front of the arrangement', async () => {
        hasStore()
        ownsImage()
        mockPrisma.storeBanner.count.mockResolvedValueOnce(2)
        mockPrisma.storeBanner.findFirst.mockResolvedValueOnce({ position: 4 })
        mockPrisma.storeBanner.create.mockResolvedValueOnce({ id: BANNER_ID })

        const res = await post(app, '/api/store/banners', { image_url: IMAGE_REF })

        expect(res.status).toBe(201)
        const data = mockPrisma.storeBanner.create.mock.calls[0]?.[0].data
        expect(data.position).toBe(5)
        expect(data.store_id).toBe(STORE_ID)
        // Absent copy is stored as null, not as the string "undefined".
        expect(data.title).toBeNull()
        expect(data.is_active).toBe(true)
    })

    it('puts the first banner at position 0', async () => {
        hasStore()
        ownsImage()
        mockPrisma.storeBanner.count.mockResolvedValueOnce(0)
        mockPrisma.storeBanner.findFirst.mockResolvedValueOnce(null)
        mockPrisma.storeBanner.create.mockResolvedValueOnce({ id: BANNER_ID })

        const res = await post(app, '/api/store/banners', { image_url: IMAGE_REF })

        expect(res.status).toBe(201)
        expect(mockPrisma.storeBanner.create.mock.calls[0]?.[0].data.position).toBe(0)
    })

    it('lets staff merchandise the shop front', async () => {
        hasStore()
        ownsImage()
        mockPrisma.storeBanner.count.mockResolvedValueOnce(0)
        mockPrisma.storeBanner.create.mockResolvedValueOnce({ id: BANNER_ID })

        const res = await post(staffApp, '/api/store/banners', { image_url: IMAGE_REF })
        expect(res.status).toBe(201)
    })
})

describe('PATCH /api/store/banners', () => {
    it('scopes the write by the session’s shop, not by the id alone', async () => {
        mockPrisma.storeBanner.updateMany.mockResolvedValueOnce({ count: 1 })

        const res = await patch(app, '/api/store/banners', {
            id: BANNER_ID,
            title: 'Eid sale',
        })

        expect(res.status).toBe(200)
        const where = mockPrisma.storeBanner.updateMany.mock.calls[0]?.[0].where
        expect(where.id).toBe(BANNER_ID)
        expect(where.store.shop_id).toBe(SHOP_ID)
    })

    it('404s another merchant’s banner instead of editing it', async () => {
        mockPrisma.storeBanner.updateMany.mockResolvedValueOnce({ count: 0 })

        const res = await patch(app, '/api/store/banners', {
            id: OTHER_BANNER_ID,
            title: 'Not mine',
        })

        expect(res.status).toBe(404)
    })

    it('clears a caption sent empty rather than leaving the old text', async () => {
        mockPrisma.storeBanner.updateMany.mockResolvedValueOnce({ count: 1 })

        const res = await patch(app, '/api/store/banners', { id: BANNER_ID, title: '' })

        expect(res.status).toBe(200)
        expect(mockPrisma.storeBanner.updateMany.mock.calls[0]?.[0].data.title).toBeNull()
    })

    it('leaves fields the merchant did not touch alone', async () => {
        mockPrisma.storeBanner.updateMany.mockResolvedValueOnce({ count: 1 })

        await patch(app, '/api/store/banners', { id: BANNER_ID, is_active: false })

        const data = mockPrisma.storeBanner.updateMany.mock.calls[0]?.[0].data
        expect(data.is_active).toBe(false)
        expect('title' in data).toBe(false)
        expect('image_url' in data).toBe(false)
    })

    it('re-checks ownership when the artwork is swapped', async () => {
        mockPrisma.mediaAsset.findMany.mockResolvedValueOnce([])

        const res = await patch(app, '/api/store/banners', {
            id: BANNER_ID,
            image_url: IMAGE_REF,
        })

        expect(res.status).toBe(422)
        expect(mockPrisma.storeBanner.updateMany.mock.calls.length).toBe(0)
    })
})

describe('DELETE /api/store/banners/:id', () => {
    it('deletes only within the session’s shop', async () => {
        mockPrisma.storeBanner.deleteMany.mockResolvedValueOnce({ count: 1 })

        const res = await del(app, `/api/store/banners/${BANNER_ID}`)

        expect(res.status).toBe(200)
        const where = mockPrisma.storeBanner.deleteMany.mock.calls[0]?.[0].where
        expect(where.id).toBe(BANNER_ID)
        expect(where.store.shop_id).toBe(SHOP_ID)
    })

    it('404s a banner that is not this shop’s', async () => {
        mockPrisma.storeBanner.deleteMany.mockResolvedValueOnce({ count: 0 })

        const res = await del(app, `/api/store/banners/${OTHER_BANNER_ID}`)
        expect(res.status).toBe(404)
    })

    it('keeps the artwork in the media library', async () => {
        mockPrisma.storeBanner.deleteMany.mockResolvedValueOnce({ count: 1 })

        await del(app, `/api/store/banners/${BANNER_ID}`)

        // Removing a slide must not destroy an image the merchant may be using
        // on a product, or is about to re-add.
        expect(mockPrisma.mediaAsset.delete.mock.calls.length).toBe(0)
        expect(mockPrisma.mediaAsset.deleteMany.mock.calls.length).toBe(0)
    })
})

describe('PATCH /api/store/banners/reorder', () => {
    it('refuses an ordering that omits some of the banners', async () => {
        hasStore()
        mockPrisma.storeBanner.findMany.mockResolvedValueOnce([
            { id: BANNER_ID },
            { id: OTHER_BANNER_ID },
        ])

        const res = await patch(app, '/api/store/banners/reorder', { ids: [BANNER_ID] })

        expect(res.status).toBe(422)
        expect(mockPrisma.$transaction.mock.calls.length).toBe(0)
    })

    it('refuses an id that belongs to another store', async () => {
        hasStore()
        mockPrisma.storeBanner.findMany.mockResolvedValueOnce([{ id: BANNER_ID }])

        const res = await patch(app, '/api/store/banners/reorder', {
            ids: [OTHER_BANNER_ID],
        })

        expect(res.status).toBe(422)
        expect(mockPrisma.$transaction.mock.calls.length).toBe(0)
    })

    it('renumbers every banner consecutively, in one transaction', async () => {
        hasStore()
        mockPrisma.storeBanner.findMany.mockResolvedValueOnce([
            { id: BANNER_ID },
            { id: OTHER_BANNER_ID },
        ])

        const res = await patch(app, '/api/store/banners/reorder', {
            ids: [OTHER_BANNER_ID, BANNER_ID],
        })

        expect(res.status).toBe(200)
        expect(mockPrisma.$transaction.mock.calls.length).toBe(1)

        const updates = mockPrisma.storeBanner.update.mock.calls.map((call: any) => [
            call[0].where.id,
            call[0].data.position,
        ])
        expect(updates).toEqual([
            [OTHER_BANNER_ID, 0],
            [BANNER_ID, 1],
        ])
    })

    it('rejects a non-uuid id before it reaches the database', async () => {
        const res = await patch(app, '/api/store/banners/reorder', { ids: ['not-a-uuid'] })
        expect(res.status).toBe(422)
        expect(mockPrisma.storeBanner.findMany.mock.calls.length).toBe(0)
    })
})
