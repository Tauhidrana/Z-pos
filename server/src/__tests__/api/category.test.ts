import { describe, it, expect, beforeEach } from 'bun:test'
import { mockPrisma, resetAllMocks } from '../preload'
import { createTestApp, post, patch, del, json } from '../setup'

type ApiResponse<T> = { success: boolean; message: string; data: T }

const app = createTestApp()

const CATEGORY_ID = '550e8400-e29b-41d4-a716-446655440010'
const PARENT_ID = '550e8400-e29b-41d4-a716-446655440011'

beforeEach(() => {
    resetAllMocks()
})

describe('POST /api/categories/create', () => {
    it('returns 422 when name is missing', async () => {
        const res = await post(app, '/api/categories/create', {})
        expect(res.status).toBe(422)
    })

    it('returns 400 when a category with the same name already exists', async () => {
        mockPrisma.category.findFirst.mockResolvedValueOnce({ id: 'existing', name: 'Snacks' })

        const res = await post(app, '/api/categories/create', { name: 'Snacks' })
        expect(res.status).toBe(400)
    })

    it('returns 400 when parent_id does not resolve to a real category', async () => {
        mockPrisma.category.findFirst.mockResolvedValueOnce(null)
        mockPrisma.category.findFirst.mockResolvedValueOnce(null)

        const res = await post(app, '/api/categories/create', {
            name: 'Sub Snacks',
            parent_id: PARENT_ID,
        })
        expect(res.status).toBe(400)
    })

    it('creates a category and derives its slug from the name', async () => {
        mockPrisma.category.findFirst.mockResolvedValueOnce(null)

        const res = await post(app, '/api/categories/create', { name: 'Cold Drinks' })
        expect(res.status).toBe(201)

        expect(mockPrisma.category.create.mock.calls[0]?.[0].data.slug).toBe('cold-drinks')
    })

    it('does not crash when parent_id is a non-string value', async () => {
        // Regression: the old hand-rolled check did `parent_id.trim()` on any
        // truthy non-string, which threw a TypeError and returned a 500.
        const res = await post(app, '/api/categories/create', {
            name: 'Bad Parent',
            parent_id: 12345,
        })
        expect(res.status).toBe(422) // clean validation error, not a 500 crash
    })
})

describe('PATCH /api/categories/update', () => {
    it('returns 404 when category does not exist', async () => {
        mockPrisma.category.findFirst.mockResolvedValueOnce(null)

        const res = await patch(app, '/api/categories/update', {
            id: CATEGORY_ID,
            name: 'Renamed',
        })
        expect(res.status).toBe(404)
    })

    it('updates an existing category', async () => {
        mockPrisma.category.findFirst.mockResolvedValueOnce({ id: CATEGORY_ID, name: 'Old Name' })

        const res = await patch(app, '/api/categories/update', {
            id: CATEGORY_ID,
            name: 'New Name',
        })
        expect(res.status).toBe(200)
        expect(mockPrisma.category.update.mock.calls.length).toBe(1)
    })
})

describe('DELETE /api/categories/delete', () => {
    it('returns 404 when category does not exist', async () => {
        mockPrisma.category.findFirst.mockResolvedValueOnce(null)

        const res = await del(app, '/api/categories/delete', { id: CATEGORY_ID })
        expect(res.status).toBe(404)
    })

    it('returns 400 (not a generic 500) when the category has products linked', async () => {
        mockPrisma.category.findFirst.mockResolvedValueOnce({ id: CATEGORY_ID, children: [] })
        mockPrisma.product.findMany.mockResolvedValueOnce([{ id: 'prod-1' }])

        const res = await del(app, '/api/categories/delete', { id: CATEGORY_ID })
        expect(res.status).toBe(400)

        const body = await json<ApiResponse<unknown>>(res)
        expect(body.message).toBe('Category has products linked')
    })

    it('deletes the category and its children when no products are linked', async () => {
        mockPrisma.category.findFirst.mockResolvedValueOnce({
            id: CATEGORY_ID,
            children: [{ id: 'child-1' }],
        })
        mockPrisma.product.findMany.mockResolvedValueOnce([])

        const res = await del(app, '/api/categories/delete', { id: CATEGORY_ID })
        expect(res.status).toBe(200)

        expect(mockPrisma.category.deleteMany.mock.calls.length).toBe(1)
        expect(mockPrisma.category.delete.mock.calls.length).toBe(1)
    })
})

describe('category slugs', () => {
    /** No name clash, and then no slug clash. */
    function noClashes() {
        mockPrisma.category.findFirst.mockResolvedValue(null)
    }

    it('strips punctuation instead of leaving it in the URL', async () => {
        noClashes()

        await post(app, '/api/categories/create', { name: "Men's / Women's" })

        // The old inline version produced "men's-/-women's", which cannot
        // appear in a URL without being escaped.
        expect(mockPrisma.category.create.mock.calls[0]?.[0].data.slug).toBe('men-s-women-s')
    })

    it('folds accents to plain ASCII rather than dropping the letters', async () => {
        noClashes()

        await post(app, '/api/categories/create', { name: 'Café Crème' })

        expect(mockPrisma.category.create.mock.calls[0]?.[0].data.slug).toBe('cafe-creme')
    })

    it('gives a wholly non-Latin name a usable slug instead of an empty one', async () => {
        noClashes()

        await post(app, '/api/categories/create', { name: 'পোশাক' })

        const slug = mockPrisma.category.create.mock.calls[0]?.[0].data.slug
        // An empty slug used to be written, so the second Bengali category a
        // merchant added collided on the shop's unique (shop_id, slug) index.
        expect(slug).toBe('category')
        expect(slug.length).toBeGreaterThan(0)
    })

    it('walks past a slug another category already holds', async () => {
        // Name check passes; the first slug candidate is taken, the second free.
        mockPrisma.category.findFirst
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ id: 'other' })
            .mockResolvedValueOnce(null)

        await post(app, '/api/categories/create', { name: 'Shoes' })

        expect(mockPrisma.category.create.mock.calls[0]?.[0].data.slug).toBe('shoes-2')
    })

    it('re-slugs on a rename', async () => {
        mockPrisma.category.findFirst
            .mockResolvedValueOnce({ id: CATEGORY_ID, name: 'Old Name' })
            .mockResolvedValueOnce(null)

        await patch(app, '/api/categories/update', { id: CATEGORY_ID, name: 'New Name' })

        expect(mockPrisma.category.update.mock.calls[0]?.[0].data.slug).toBe('new-name')
    })

    it('leaves a live storefront URL alone when only the description changed', async () => {
        mockPrisma.category.findFirst.mockResolvedValueOnce({
            id: CATEGORY_ID,
            name: 'Shoes',
        })

        await patch(app, '/api/categories/update', {
            id: CATEGORY_ID,
            description: 'Everything for your feet',
        })

        const data = mockPrisma.category.update.mock.calls[0]?.[0].data
        expect('slug' in data).toBe(false)
    })

    it('does not re-slug when the name is submitted unchanged', async () => {
        mockPrisma.category.findFirst.mockResolvedValueOnce({
            id: CATEGORY_ID,
            name: 'Shoes',
        })

        await patch(app, '/api/categories/update', { id: CATEGORY_ID, name: 'Shoes' })

        expect('slug' in mockPrisma.category.update.mock.calls[0]?.[0].data).toBe(false)
    })

    it('excludes the category itself when checking its new slug', async () => {
        mockPrisma.category.findFirst
            .mockResolvedValueOnce({ id: CATEGORY_ID, name: 'Old Name' })
            .mockResolvedValueOnce(null)

        await patch(app, '/api/categories/update', { id: CATEGORY_ID, name: 'New Name' })

        const where = mockPrisma.category.findFirst.mock.calls[1]?.[0].where
        expect(where.id).toEqual({ not: CATEGORY_ID })
    })
})

describe('category artwork', () => {
    const IMAGE_ID = '550e8400-e29b-41d4-a716-446655440012'
    const IMAGE_REF = `media:${IMAGE_ID}`

    it('refuses an image belonging to another shop', async () => {
        mockPrisma.category.findFirst.mockResolvedValue(null)
        mockPrisma.mediaAsset.findMany.mockResolvedValueOnce([])

        const res = await post(app, '/api/categories/create', {
            name: 'Shoes',
            image_url: IMAGE_REF,
        })

        expect(res.status).toBe(422)
        expect(mockPrisma.mediaAsset.findMany.mock.calls[0]?.[0].where.shop_id).toBe(
            'test-shop-uuid',
        )
        expect(mockPrisma.category.create.mock.calls.length).toBe(0)
    })

    it('stores artwork the shop owns', async () => {
        mockPrisma.category.findFirst.mockResolvedValue(null)
        mockPrisma.mediaAsset.findMany.mockResolvedValueOnce([{ id: IMAGE_ID }])

        const res = await post(app, '/api/categories/create', {
            name: 'Shoes',
            image_url: IMAGE_REF,
        })

        expect(res.status).toBe(201)
        expect(mockPrisma.category.create.mock.calls[0]?.[0].data.image_url).toBe(IMAGE_REF)
    })

    it('clears the artwork when the field is sent empty', async () => {
        mockPrisma.category.findFirst.mockResolvedValueOnce({ id: CATEGORY_ID, name: 'Shoes' })

        const res = await patch(app, '/api/categories/update', {
            id: CATEGORY_ID,
            image_url: '',
        })

        expect(res.status).toBe(200)
        expect(mockPrisma.category.update.mock.calls[0]?.[0].data.image_url).toBeNull()
        // Clearing is not an attach, so there is nothing to ownership-check.
        expect(mockPrisma.mediaAsset.findMany.mock.calls.length).toBe(0)
    })
})
