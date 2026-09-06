import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { Hono } from 'hono'
import { mockPrisma, resetAllMocks } from '../preload'
import type { AppEnv } from '@/types'

// Regression coverage for the fix that replaced invite-only access with
// self-serve sign-up. Before it, a Clerk account with no `users` row got
// "Access denied. Your account has not been granted access to this system."
// on every call — a brand-new sign-in could not create a category, a product,
// or anything else.

// syncUser resolves an unknown account's email through the Clerk API, so the
// client is stubbed. `verifyToken` is stubbed to reject, which is what the real
// one does for the invalid tokens auth.test.ts sends.
const getUser = mock(async (_id: string) => ({
    firstName: 'New',
    lastName: 'Owner',
    emailAddresses: [{ emailAddress: 'new-owner@gmail.com' }],
}))

mock.module('@clerk/backend', () => ({
    createClerkClient: () => ({ users: { getUser } }),
    verifyToken: async () => {
        throw new Error('invalid token')
    },
}))

const { syncUser } = await import('@/middleware/authSyncUser.middleware')

type Session = { userId: string; role: string; shopId: string }

/**
 * Sessions are cached per Clerk id for a minute, so every test uses its own id
 * — a shared one would make the second test read the first one's decision.
 */
function requestAs(clerkUserId: string) {
    const app = new Hono<AppEnv>()
    app.use('*', async (c, next) => {
        c.set('clerkUserId', clerkUserId)
        await next()
    })
    app.get('/', syncUser, (c) =>
        c.json({
            userId: c.get('userId'),
            role: c.get('userRole'),
            shopId: c.get('shopId'),
        }),
    )
    return app.request('/')
}

beforeEach(() => {
    resetAllMocks()
    getUser.mockImplementation(async () => ({
        firstName: 'New',
        lastName: 'Owner',
        emailAddresses: [{ emailAddress: 'new-owner@gmail.com' }],
    }))
})

describe('syncUser — self-serve sign-up', () => {
    it('admits an account nobody invited, as an OWNER of its own new shop', async () => {
        // No row for the clerk id, and none for the email either.
        mockPrisma.user.create.mockResolvedValueOnce({
            id: 'user-1',
            role: 'OWNER',
            is_active: true,
            shop_id: 'shop-1',
            email: 'new-owner@gmail.com',
        })

        const res = await requestAs('clerk_brand_new')
        expect(res.status).toBe(200)

        const body = (await res.json()) as Session
        expect(body.role).toBe('OWNER')
        expect(body.shopId).toBe('shop-1')

        // The shop is created with the user, so a self-serve owner starts on an
        // empty catalog instead of joining someone else's books.
        const created = mockPrisma.user.create.mock.calls[0]?.[0] as any
        expect(created.data.shop.create).toBeDefined()
    })

    it('adopts the row a concurrent first request already created', async () => {
        // Six API calls fire on the first page load; only one create can win.
        mockPrisma.user.create.mockImplementationOnce(() =>
            Promise.reject(Object.assign(new Error('unique constraint'), { code: 'P2002' })),
        )
        mockPrisma.user.findFirst.mockImplementationOnce(() => Promise.resolve(null)) // case-insensitive email lookup
        mockPrisma.user.findFirst.mockImplementationOnce(() =>
            Promise.resolve({
                id: 'user-2',
                role: 'OWNER',
                is_active: true,
                shop_id: 'shop-2',
                email: 'new-owner@gmail.com',
            }),
        )

        const res = await requestAs('clerk_raced')
        expect(res.status).toBe(200)
        expect(((await res.json()) as Session).shopId).toBe('shop-2')
    })

    it('keeps an invited STAFF on the shop that invited them', async () => {
        mockPrisma.user.findUnique.mockImplementationOnce(() => Promise.resolve(null)) // by clerk_id
        mockPrisma.user.findUnique.mockImplementationOnce(() =>
            Promise.resolve({
                id: 'staff-1',
                role: 'STAFF',
                is_active: true,
                shop_id: 'owners-shop',
                email: 'cashier@gmail.com',
                status: 'PENDING',
            }),
        )

        const res = await requestAs('clerk_invited_staff')
        expect(res.status).toBe(200)

        const body = (await res.json()) as Session
        expect(body.role).toBe('STAFF')
        expect(body.shopId).toBe('owners-shop')
        expect(mockPrisma.user.create).not.toHaveBeenCalled()
    })
})

describe('syncUser — admin addresses', () => {
    it('restores an admin address that was deactivated or demoted', async () => {
        mockPrisma.user.findUnique.mockImplementationOnce(() =>
            Promise.resolve({
                id: 'admin-1',
                role: 'STAFF',
                is_active: false,
                shop_id: 'shop-3',
                email: 'sabbirahmed565r@gmail.com',
            }),
        )
        mockPrisma.user.update.mockImplementationOnce(() =>
            Promise.resolve({
                id: 'admin-1',
                role: 'OWNER',
                is_active: true,
                shop_id: 'shop-3',
                email: 'sabbirahmed565r@gmail.com',
            }),
        )

        const res = await requestAs('clerk_admin')
        expect(res.status).toBe(200)
        expect(((await res.json()) as Session).role).toBe('OWNER')
    })

    it('still blocks a deactivated ordinary account', async () => {
        mockPrisma.user.findUnique.mockImplementationOnce(() =>
            Promise.resolve({
                id: 'user-3',
                role: 'STAFF',
                is_active: false,
                shop_id: 'shop-4',
                email: 'fired@gmail.com',
            }),
        )

        const res = await requestAs('clerk_deactivated')
        expect(res.status).toBe(403)
    })
})
