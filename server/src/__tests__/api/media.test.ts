import { describe, it, expect, beforeEach } from 'bun:test'
import { mockPrisma, resetAllMocks } from '../preload'
import { createTestApp, get, post, json } from '../setup'

const app = createTestApp()

// Real magic numbers — the upload path sniffs bytes rather than trusting the
// declared type, so fixtures have to be genuine files.
const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
)
const pngDataUrl = `data:image/png;base64,${PNG.toString('base64')}`

beforeEach(() => {
    resetAllMocks()
})

describe('POST /api/media', () => {
    it('stores an image against the session shop and returns a ref', async () => {
        mockPrisma.mediaAsset.create.mockResolvedValueOnce({
            id: 'asset-1', mime: 'image/png', size: PNG.length, width: 1, height: 1,
        })

        const res = await post(app, '/api/media', { data: pngDataUrl, width: 1, height: 1 })
        expect(res.status).toBe(201)

        const body = await json<{ data: { ref: string } }>(res)
        // A ref, not a URL: a URL would bake this deployment's hostname into
        // every row and break the moment the domain changes.
        expect(body.data.ref).toBe('media:asset-1')
        expect(mockPrisma.mediaAsset.create.mock.calls[0]?.[0].data.shop_id).toBe('test-shop-uuid')
    })

    it('refuses a file that is not really an image, whatever the header claims', async () => {
        const pdf = Buffer.from('%PDF-1.4 this is not a picture').toString('base64')
        const res = await post(app, '/api/media', { data: `data:image/png;base64,${pdf}` })

        expect(res.status).toBe(422)
        expect(mockPrisma.mediaAsset.create.mock.calls.length).toBe(0)
    })

    it('refuses a format outside the allow-list', async () => {
        const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64')
        const res = await post(app, '/api/media', { data: `data:image/svg+xml;base64,${svg}` })
        expect(res.status).toBe(422)
    })

    it('rejects a payload too large to be a shrunk photo', async () => {
        // The schema caps the encoded string before anything is decoded, so an
        // oversized upload never reaches memory as bytes.
        const huge = 'A'.repeat(3_000_000)
        const res = await post(app, '/api/media', { data: `data:image/png;base64,${huge}` })
        expect(res.status).toBe(422)
    })
})

describe('GET /api/media/:id', () => {
    it('serves the bytes with no session at all', async () => {
        mockPrisma.mediaAsset.findUnique.mockResolvedValueOnce({
            mime: 'image/png', data: new Uint8Array(PNG), size: PNG.length,
        })

        const res = await get(app, '/api/media/asset-1')
        expect(res.status).toBe(200)
        expect(res.headers.get('content-type')).toBe('image/png')

        const bytes = Buffer.from(await res.arrayBuffer())
        expect(Buffer.compare(bytes, PNG)).toBe(0)
    })

    it('caches immutably — the bytes at an id never change', async () => {
        mockPrisma.mediaAsset.findUnique.mockResolvedValueOnce({
            mime: 'image/png', data: new Uint8Array(PNG), size: PNG.length,
        })
        const res = await get(app, '/api/media/asset-1')
        expect(res.headers.get('cache-control')).toContain('immutable')
        // Served cross-origin: a storefront subdomain embeds these.
        expect(res.headers.get('access-control-allow-origin')).toBe('*')
        expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    })

    it('404s an unknown id', async () => {
        mockPrisma.mediaAsset.findUnique.mockResolvedValueOnce(null)
        const res = await get(app, '/api/media/nope')
        expect(res.status).toBe(404)
    })
})

describe('image ownership', () => {
    it('refuses to attach an image belonging to another shop', async () => {
        // The ownership query is scoped by shop, so a foreign id matches nothing.
        mockPrisma.mediaAsset.findMany.mockResolvedValueOnce([])
        mockPrisma.product.findFirst.mockResolvedValueOnce({
            id: 'prod-1', name: 'Shirt', slug: 'shirt',
        })

        const res = await app.request('/api/store/products', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: '550e8400-e29b-41d4-a716-446655440000',
                images: [{ url: 'media:11111111-1111-4111-8111-111111111111' }],
            }),
        })

        expect(res.status).toBe(422)
        const body = await json<{ error: { code: string } }>(res)
        expect(body.error.code).toBe('INVALID_IMAGE')
        expect(mockPrisma.mediaAsset.findMany.mock.calls[0]?.[0].where.shop_id).toBe('test-shop-uuid')
    })
})

describe('cross-origin embedding (real app middleware stack)', () => {
    it('serves media with a cross-origin resource policy, and nothing else', async () => {
        // Against the real app, not the test harness: the bug this guards was
        // caused by `secureHeaders` overwriting the handler's own header after
        // it ran, so it only reproduces with the full middleware stack.
        const { app: realApp } = await import('@/app')

        mockPrisma.mediaAsset.findUnique.mockResolvedValueOnce({
            mime: 'image/png', data: new Uint8Array(PNG), size: PNG.length,
        })

        const media = await realApp.fetch(new Request('http://localhost/api/media/asset-1'))
        expect(media.status).toBe(200)
        // Without this a browser refuses the <img> outright, before CORS is
        // even consulted, and every storefront photo silently fails to load.
        expect(media.headers.get('cross-origin-resource-policy')).toBe('cross-origin')

        // The relaxation must not leak to routes that return private data.
        mockPrisma.store.findUnique.mockResolvedValueOnce(null)
        const other = await realApp.fetch(new Request('http://localhost/api/storefront/nope'))
        expect(other.headers.get('cross-origin-resource-policy')).toBe('same-origin')
    })
})
