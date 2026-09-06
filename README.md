# zPOS

> A multi-tenant retail operating system for point-of-sale, inventory, purchasing, customer management, analytics, and online storefronts.

[![Runtime](https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun&logoColor=000)](https://bun.sh/)
[![Frontend](https://img.shields.io/badge/frontend-React%2019-149eca?logo=react&logoColor=white)](https://react.dev/)
[![API](https://img.shields.io/badge/API-Hono-ff6b35)](https://hono.dev/)
[![Database](https://img.shields.io/badge/database-PostgreSQL-4169e1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Auth](https://img.shields.io/badge/auth-Clerk-6c47ff)](https://clerk.com/)

zPOS is a full-stack, tenant-isolated retail platform. It gives a shop owner one workspace for daily counter sales and the operational work around them: products, variants, barcodes, stock, purchases, customers, reports, staff access, and a public online store.

The repository is intentionally organised as a small monorepo. The React application, Bun/Hono API, Prisma data layer, and shared validation contracts live together so a feature can move from UI to API to database without duplicating its types.

## Product Surface

### Counter operations

- Fast point-of-sale checkout with product search and barcode workflows.
- Invoice generation, payments, discounts, delivery charges, and sale history.
- Payment methods for cash, bKash, Nagad, and Rocket.
- Computed payment state: `DUE`, `PARTIAL`, `PAID`, or waived balance.

### Catalog and inventory

- Products, categories, brands, variants, pricing, and reorder levels.
- Barcode generation, lookup, allocation, PDF labels, and EAN-13 tooling.
- Purchase entry and supplier tracking.
- Stock movement history for purchases, sales, adjustments, and online orders.
- Decimal-safe monetary values backed by PostgreSQL `Decimal(10,2)` fields.

### Customers and insights

- Customer profiles, contact details, credit balances, and purchase history.
- Dashboard metrics, sales analytics, date filters, and chart data.
- Owner and staff roles with owner-only administration screens.

### Online store

- Merchant storefront configuration and product visibility controls.
- Featured products, product images, storefront slugs, and online pricing.
- Public storefront browsing without requiring a zPOS account.
- Store order management with fulfilment stages from `PENDING` to `DELIVERED` or `CANCELLED`.
- Cash on delivery is currently supported for online orders.

## Architecture

```text
+----------------------+       Clerk token + JSON API calls       +----------------------+
|   React + Vite UI    | --------------------------------------> |   Hono + Bun API     |
| client/              |                                          | server/              |
+----------------------+                                          +----------+-----------+
                                                                                |
                                                                      Prisma + PostgreSQL
                                                                                |
                                                                      +---------v----------+
                                                                      | Tenant-scoped data |
                                                                      | shops, sales,      |
                                                                      | products, orders   |
                                                                      +--------------------+

packages/shared/ -> shared Zod schemas and TypeScript types
```

### Request flow

1. The client authenticates through Clerk and obtains a session token.
2. `client/src/lib/api-request.ts` attaches the token to API requests and applies a request deadline.
3. The server validates Clerk identity, synchronises the user, resolves the shop, and scopes data to that shop.
4. Hono routes validate input with shared schemas and delegate work to controllers and services.
5. Prisma persists tenant-owned records in PostgreSQL.

The public storefront is registered before the authenticated `/api/*` middleware. This lets shoppers browse a merchant store while keeping the dashboard and operational APIs protected.

## Repository Layout

```text
.
├── api/                  Vercel serverless adapter and catch-all route
├── client/               React 19 + Vite application
│   └── src/
│       ├── components/   Shared UI and domain components
│       ├── lib/          API, barcode, cache, sound, and utility helpers
│       ├── pages/        Dashboard, POS, catalog, store, and admin screens
│       └── storefront/   Public online-store experience
├── packages/shared/      Shared TypeScript types and Zod schemas
├── server/               Bun + Hono API
│   ├── prisma/           Schema, migrations, and seed data
│   ├── src/controllers/  Request handlers
│   ├── src/routes/       API route modules
│   ├── src/services/     Domain services
│   └── src/middleware/   Auth, tenant, and request middleware
├── docs/                 Product and launch documentation
├── railway.json          Railway deployment configuration
└── vercel.json           Vercel build, rewrite, and security headers
```

## Requirements

- [Bun](https://bun.sh/) 1.2 or newer.
- PostgreSQL 14 or newer, locally hosted or managed.
- A Clerk application with a publishable key and secret key.
- A Resend API key if invitation or transactional email flows are enabled.

Check the installed versions before starting:

```bash
bun --version
psql --version
```

## Quick Start

### 1. Install workspace dependencies

Run this from the repository root:

```bash
bun install
```

### 2. Configure the API

Create the server environment file from the checked-in template:

```bash
cp server/.env.example server/.env
```

Set real values in `server/.env`:

```dotenv
DATABASE_URL="postgresql://user:password@localhost:5432/zpos?schema=public"
PORT=3000
NODE_ENV=development
ALLOWED_ORIGINS=http://localhost:5173
CLERK_SECRET_KEY=sk_test_your_clerk_secret_key
RESEND_API_KEY=re_your_resend_api_key
CLIENT_URL=http://localhost:5173
EMAIL_DOMAIN=yourdomain.com
BOOTSTRAP_OWNER_EMAILS=
APP_DOMAIN=
```

`DATABASE_URL`, `CLERK_SECRET_KEY`, `RESEND_API_KEY`, `CLIENT_URL`, and `EMAIL_DOMAIN` are required by the server at startup. `APP_DOMAIN` is only needed when using subdomain storefronts.

### 3. Configure the client

Create `client/.env`:

```dotenv
VITE_CLERK_PUBLISHABLE_KEY=pk_test_your_clerk_publishable_key
VITE_API_URL=http://localhost:3000/api
VITE_APP_DOMAIN=
```

The client intentionally reads its API location from `VITE_API_URL`; do not hardcode a deployed API URL in application code.

### 4. Prepare the database

Generate the Prisma client and apply migrations:

```bash
cd server
bunx prisma generate
bunx prisma migrate dev
```

For a development database with demo records, inspect `server/prisma/seed.ts` and run the seed script only against a disposable database. Do not run seed or reset commands against production data.

### 5. Start the application

From the repository root, start both workspaces:

```bash
bun run dev
```

Or run each process in its own terminal:

```bash
# Terminal 1
bun run dev:server
```

```bash
# Terminal 2
bun run dev:client
```

The default local addresses are:

- Dashboard: `http://localhost:5173`
- API: `http://localhost:3000`
- Health check: `http://localhost:3000/health`

## Available Commands

| Command | Purpose |
| --- | --- |
| `bun install` | Install all workspace dependencies |
| `bun run dev` | Start client and server development processes |
| `bun run dev:client` | Start Vite only |
| `bun run dev:server` | Start the hot-reloading API only |
| `bun run build` | Build all workspaces |
| `cd client && bun run lint` | Lint the React application |
| `cd client && bun run test` | Run client tests |
| `cd client && bun run build` | Type-check and build the client |
| `cd server && bun test src/__tests__/**/*.test.ts` | Run API tests |
| `cd server && bun run build` | Compile the API binary |
| `cd server && bunx prisma validate` | Validate the Prisma schema |
| `cd server && bunx prisma migrate status` | Inspect migration state |
| `cd server && bunx prisma generate` | Regenerate Prisma client |

## Application Routes

### Dashboard routes

| Path | Screen | Access |
| --- | --- | --- |
| `/` | Dashboard | Authenticated |
| `/pos` | Point of sale | Authenticated |
| `/products` | Product catalogue | Authenticated |
| `/products/:id` | Product details | Authenticated |
| `/customers` | Customers | Authenticated |
| `/purchases` | Purchase history | Authenticated |
| `/purchases/new` | New purchase | Authenticated |
| `/sales` | Sales history | Authenticated |
| `/barcodes` | Barcode generator | Authenticated |
| `/store` | Online store workspace | Authenticated |
| `/store/products` | Store product controls | Authenticated |
| `/store/orders` | Store orders | Authenticated |
| `/store/settings` | Store settings | Authenticated |
| `/admin` | Administration | Owner only |
| `/login` | Clerk sign-in | Public |

### API groups

All protected API calls are under `/api` and use Clerk authentication. The public storefront API is under `/api/storefront`.

| Prefix | Responsibility |
| --- | --- |
| `/api/products` | Products, variants, pricing, and stock-facing catalog operations |
| `/api/categories` | Category hierarchy and management |
| `/api/purchase` | Purchases and supplier-side inventory intake |
| `/api/sales` | POS sales, invoices, payments, and sale history |
| `/api/dashboard` | Dashboard summaries and operational metrics |
| `/api/analytics` | Sales and chart analytics |
| `/api/customers` | Customer records and balances |
| `/api/admin` | Owner administration and invitations |
| `/api/labels` | Barcode and label operations |
| `/api/store` | Merchant online-store management |
| `/api/storefront` | Public store browsing and online ordering |
| `/health` | Deployment and process health check |

## Security and Data Boundaries

- Clerk is the only authentication provider.
- Every shop-owned record is scoped through `shop_id`; owners and invited staff share a shop without sharing data with other tenants.
- Server-side middleware adds security headers, CORS policy, CSRF protection outside development, compression, request timeouts, and rate limiting.
- Production error responses are normalised and do not intentionally expose stack traces or database details.
- Monetary values remain decimal values in the database; avoid converting money to floating-point numbers in domain logic.
- Do not commit `.env`, `.env.*`, Clerk keys, database URLs, Resend keys, or generated credentials.
- When changing the schema, add a new descriptive Prisma migration. Never rewrite an applied production migration.

## Database and Tenancy Model

`Shop` is the tenant boundary. Users, products, categories, customers, suppliers, sales, purchases, stock adjustments, stores, and online orders belong to a shop. A user can be an `OWNER` or `STAFF`; the owner can invite staff into the same operational workspace.

The schema also keeps online fulfilment separate from in-person sale status. A counter sale is completed at the till, while an online order moves through its own lifecycle: `PENDING`, `CONFIRMED`, `PROCESSING`, `SHIPPED`, `DELIVERED`, or `CANCELLED`.

## Deployment

### Railway

`railway.json` is configured for the long-running Bun server:

- Build: install dependencies and generate Prisma client.
- Start: `cd server && bun run start`.
- Health check: `/health`.

Configure the server environment variables in Railway before deploying. Run database migrations as an explicit release step according to your production migration policy.

### Vercel

`vercel.json` configures a combined deployment:

- Builds the server adapter into `api/_app.mjs`.
- Builds the Vite client into `client/dist/public`.
- Rewrites `/api/*` to the serverless catch-all route.
- Rewrites non-API routes to the SPA entrypoint.
- Adds frame, content-type, referrer, and cache-control headers.

For Vercel, set `VITE_API_URL=/api` and provide the server-side environment variables in the project settings. Never use values copied from a local `.env` file in a public issue, screenshot, or commit.

## Testing and Release Checklist

Before opening a pull request or deploying:

```bash
bun run build
cd client && bun run lint && bun run test
cd ../server && bunx prisma validate && bun test src/__tests__/**/*.test.ts
```

Also verify:

- The target database has the expected migration state.
- `VITE_API_URL` contains the `/api` path exactly once.
- Clerk redirect URLs and allowed origins match the deployed host.
- Public storefront requests work without dashboard authentication.
- Owner-only routes reject staff users.
- Payment and stock changes remain transactional and tenant-scoped.
- No sensitive values appear in logs or generated build output.

## Documentation

- [Online store notes](docs/ONLINE_STORE.md)
- [Pre-launch audit](docs/PRE_LAUNCH_AUDIT.md)
- [Database migration log](server/prisma/MIGRATION_LOG.md)
- [Implementation plan](plan.md)

## Contributing

1. Create a focused feature branch.
2. Keep changes inside the owning workspace or shared package.
3. Add or update focused tests for behavior changes.
4. Add a new Prisma migration for every schema change.
5. Run the build, client checks, server tests, and Prisma validation before submitting a pull request.

## License

No public license has been declared for this repository yet. Treat the codebase as proprietary unless the project owner states otherwise.
