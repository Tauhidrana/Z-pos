import { Hono } from 'hono'
import type { Context } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { secureHeaders } from 'hono/secure-headers'
import { timeout } from 'hono/timeout'
import { rateLimiter } from 'hono-rate-limiter'
import { csrf } from 'hono/csrf'
import { compress } from 'hono/compress'
import { HTTPException } from 'hono/http-exception'
import { AppError } from '@/utils/AppError'
import { sendError, sendSuccess } from '@/utils/response'
import productRouter from './routes/product.route'
import categoryRouter from './routes/category.route'
import purchaseRouter from './routes/purchase.route'
import saleRouter from './routes/sale.route'
import dashboardRouter from './routes/dashbord.route'
import customerRouter from './routes/customer.route'
import analyticsRouter from './routes/analytics.route'
import adminRouter from './routes/admin.route'
import labelRouter from './routes/label.route'
import storeRouter from './routes/store.route'
import storefrontRouter from './routes/storefront.route'
import mediaRouter, { mediaPublicRouter } from './routes/media.route'

import { requireAuth } from './middleware/auth.middleware'
import { syncUser } from './middleware/authSyncUser.middleware'
import { isAllowedOrigin } from './lib/origin'
import type { AppEnv } from './types'

export const app = new Hono<AppEnv>()

// --- Media: relax one header, from outside the security middleware ---------
// `secureHeaders` sets `Cross-Origin-Resource-Policy: same-origin` on every
// response, after the handler has run — so a header set inside the media
// handler is overwritten. A browser refuses a cross-origin <img> on that header
// before it ever considers CORS, which meant storefront product photos simply
// did not load whenever the site and the API were on different origins.
//
// Registered BEFORE secureHeaders on purpose: an outer middleware's code after
// `await next()` runs last, so this gets the final word — and only for
// `/api/media/*`, which serves nothing but public product photographs.
app.use('/api/media/*', async (c, next) => {
    await next()
    c.res.headers.set('Cross-Origin-Resource-Policy', 'cross-origin')
})

// --- Security Headers ---
app.use('*', secureHeaders({
    contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
    },
    xFrameOptions: 'DENY',
    referrerPolicy: 'strict-origin-when-cross-origin',
}))

const isDev = process.env.NODE_ENV === 'development'

// --- CSRF Protection (skip in dev) ---
// A predicate rather than a fixed list: storefronts live on per-merchant
// subdomains that are created at runtime, so their origins cannot be enumerated
// at boot. `isAllowedOrigin` matches them by shape against APP_DOMAIN.
if (!isDev) {
    app.use('*', csrf({ origin: (origin) => isAllowedOrigin(origin) }))
}

// --- CORS ---
app.use('*', cors({
    origin: (origin) => (isDev ? origin || '*' : isAllowedOrigin(origin) ? origin : null),
    allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
    exposeHeaders: ['X-Request-Id'],
    credentials: isDev ? false : true,
    maxAge: 86400,
}))

// The `origin` callback runs per request, so the response varies by the
// request's Origin. Without this a shared cache could hand one storefront's
// CORS headers to another's request.
app.use('*', async (c, next) => {
    await next()
    c.res.headers.append('Vary', 'Origin')
})

// --- Response compression ---
// API payloads are JSON (product lists, sales history, dashboard series) and
// compress by roughly 5-10x. This is the single biggest transfer-size win on
// slow connections.
app.use('*', compress())

// --- Timeout ---
app.use('*', timeout(30_000))

// --- Rate Limiting ---
// Keyed per credential when one is present, falling back to IP. Keying on IP
// alone meant every till in a shop shared a single bucket behind one NAT — a
// busy counter plus a dashboard refresh could exhaust it and start failing real
// requests. The limit is also sized for POS traffic: a scan-heavy checkout
// legitimately issues a burst of calls.
app.use('*', rateLimiter({
    windowMs: 60_000,
    limit: Number(process.env.RATE_LIMIT_PER_MINUTE ?? 600),
    keyGenerator: (c) => {
        const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
        const auth = c.req.header('Authorization')
        // The token tail is stable per session and never logged; it just
        // separates concurrent users sharing an egress IP.
        return auth ? `t:${auth.slice(-32)}` : `ip:${ip}`
    },
}))

// --- Logging ---
// Per-request console I/O is synchronous and shows up under load, so keep the
// verbose logger to development only.
if (isDev) {
    app.use('*', logger())
}

// --- Public routes (no auth required) ---
// Registered on both paths, and BEFORE the `/api/*` auth middleware so neither
// requires a token.
//
// `/health` alone was unreachable in production: Vercel only rewrites `/api/*`
// to this function, so a request for `/health` was served the SPA's index.html
// instead, and `/api/health` — the path that does reach here — fell through to
// `requireAuth` and answered 401. A health check that cannot be called without
// credentials, and 200s with an HTML page when it can, is not a health check.
const health = (c: Context<AppEnv>) =>
    c.json({ status: 'ok', timestamp: new Date().toISOString() })

app.get('/health', health)
app.get('/api/health', health)

// --- Public storefront (no auth) -------------------------------------------
// Registered BEFORE the `/api/*` auth middleware on purpose. Hono runs matched
// handlers in registration order and stops at the first one that returns, so
// these resolve without ever reaching `requireAuth` — which is the point: a
// shopper browsing a merchant's shop has no zPOS account to authenticate with.
//
// It still has to live under `/api/` because that is the only prefix the Vercel
// rewrite forwards to this function.
app.route('/api/storefront', storefrontRouter)

// Product photographs, served to storefront visitors who have no session.
// Same reasoning as above: registered ahead of `requireAuth` on purpose.
app.route('/api/media', mediaPublicRouter)

// --- Auth middleware for all /api/* routes ---
// Must be registered BEFORE app.route() calls
app.use('/api/*', requireAuth, syncUser)

// --- Current user (so the client can gate role-only UI, e.g. /admin) ---
app.get('/api/me', (c) =>
    sendSuccess(c, { userId: c.get('userId'), role: c.get('userRole') })
)

// --- Auth test (useful during development) ---
if (isDev) {
    app.get('/api/auth-test', (c) =>
        c.json({
            clerkUserId: c.get('clerkUserId'),
            userId: c.get('userId'),
            userRole: c.get('userRole'),
        })
    )
}

// --- Routes ---
app.route('/api/products', productRouter)
app.route('/api/categories', categoryRouter)
app.route('/api/purchase', purchaseRouter)
app.route('/api/sales', saleRouter)
app.route('/api/dashboard', dashboardRouter)
app.route('/api/analytics', analyticsRouter)
app.route('/api/customers', customerRouter)
app.route('/api/admin', adminRouter)
app.route('/api/labels', labelRouter)
app.route('/api/store', storeRouter)
app.route('/api/media', mediaRouter)

// --- Error Handling ---
app.onError((err, c) => {
    if (err instanceof AppError) {
        return sendError(c, err.message, err.code, err.status, err.details)
    }
    if (err instanceof HTTPException) {
        return sendError(c, err.message || 'Request failed', 'HTTP_ERROR', err.status as any)
    }
    console.error('[Unhandled]', err)
    return sendError(c, 'Internal server error', 'INTERNAL_ERROR', 500)
})

app.notFound((c) => sendError(c, 'Route not found', 'ROUTE_NOT_FOUND', 404))