# Online Store

Every zPOS shop can open a public, cash-on-delivery storefront that sells its
existing catalog. Nothing about the POS changes: the storefront reads the same
products, categories and stock the till does, and the orders it produces come
back into the same dashboard.

---

## How a request finds its store

One deployment serves every storefront. The tenant is resolved from the URL
before anything renders (`client/src/lib/tenant.ts`), and there are two forms:

| Form | Example | Availability |
|---|---|---|
| **Subdomain** | `tds.zpos.com` | Needs a wildcard domain (below) |
| **Path** | `zpos.vercel.app/s/tds` | Works everywhere, always |

Both resolve to the same slug and mount the same app, so a merchant can hand
out either link.

### The `*.vercel.app` limitation

**Vercel does not issue wildcard subdomains under `vercel.app`.** You cannot add
`*.zpos.vercel.app` to the project, so `tds.zpos.vercel.app` will not resolve —
this is a platform restriction, not something the code can work around.

The path form (`zpos.vercel.app/s/tds`) is therefore the address to give
merchants today, and it is what the dashboard shows as **Live now**.

### Turning on subdomains

Once a custom domain is attached:

1. Add the domain and its wildcard to the Vercel project — `zpos.com` and
   `*.zpos.com`.
2. Point DNS at Vercel: an `A`/`CNAME` for the apex, plus a `CNAME` for `*`.
3. Set the environment variables:
   - Server: `APP_DOMAIN=zpos.com`
   - Client: `VITE_APP_DOMAIN=zpos.com`
4. Redeploy.

`tds.zpos.com` then serves the TDS storefront, and the dashboard starts showing
the subdomain link. The path form keeps working, so no existing link breaks.

Both variables must agree. The client uses `VITE_APP_DOMAIN` to decide whether a
hostname is a storefront; the server uses `APP_DOMAIN` to accept `*.APP_DOMAIN`
as a CORS/CSRF origin without having to enumerate merchant hostnames it cannot
know in advance. Matching is on a label boundary, so `evil-zpos.com` and
`zpos.com.attacker.net` are not tenants (covered by `client/src/__tests__/tenant.test.ts`).

### Local development

- `http://localhost:5173/s/tds` — path form, always works.
- `http://tds.localhost:5173` — Chrome and Safari resolve any `*.localhost` to
  loopback, so subdomain routing is testable without editing `/etc/hosts`.

Seed a demo storefront on the first shop in the database with:

```
cd server && bun run scripts/seed-demo-store.ts tds
```

---

## Architecture

### One bundle, two applications

`client/src/Root.tsx` picks between the dashboard and the storefront at module
scope, before either tree mounts. The storefront therefore never loads Clerk —
a shopper has no account to authenticate, and the auth SDK is ~90 kB that would
otherwise be downloaded on every phone that opens a shop. This is enforced by
the chunking in `vite.config.ts`; if you add a storefront import that reaches
`@/lib/api-request`, Clerk comes back with it.

### API surface

| Prefix | Auth | Purpose |
|---|---|---|
| `/api/storefront/:slug/*` | none | Public catalog + placing an order |
| `/api/store/*` | Clerk session | The merchant's own store, products, orders |

The public router is mounted in `server/src/app.ts` **before** the `/api/*` auth
middleware, which is what lets it answer without a token.

Public responses carry no shop id, user id, cost price or supplier. The tenant
comes from the `:slug` in the URL and nothing else, so there is no identifier in
any request body for a caller to swap.

### Pricing

The till prices a unit from the purchase batch its scanned barcode belongs to.
A web shopper has no barcode, so there is no batch to price from. Instead:

```
price = online_sale_price  (when set and below the regular price)
      ? online_price ?? last_sell_price
```

- `product_variants.last_sell_price` — the sell price of the variant's most
  recent purchase, written on every purchase alongside `stock_on_hand`. This is
  the shelf price.
- `online_price` — an optional per-variant override that applies online only.
- `online_sale_price` — an optional discount. Ignored unless it is genuinely
  below the regular price, so a mistyped "discount" can never raise a charge or
  render a fake strikethrough.

A variant with neither an override nor a purchase behind it has no price, and is
withheld from the storefront rather than shown at ৳0. The dashboard's **Products
online** page flags those explicitly.

### Stock

Stock is committed **when the order is placed**, not when it ships — a customer
who checks out has taken the unit off the shelf as far as everyone else browsing
is concerned, and holding the decrement until dispatch is how a shop oversells.

Every movement goes through the same append-only `stock_ledgers` table the till
writes to, under the same `SELECT … FOR UPDATE` lock on the variant row, so two
shoppers racing for the last unit cannot both win it. `stock_ledgers` gained an
`online_order_id` column and its "one source per row" CHECK now allows four
sources instead of three.

| Event | Ledger | `stock_on_hand` |
|---|---|---|
| Order placed | `SALE` / `OUT` | decremented |
| Order cancelled | `ADJUSTMENT` / `IN` | incremented, once (`stock_restored` guards it) |
| Order delivered | — | unchanged (already deducted at placement) |

### Orders and the books

`OnlineOrder` is its own table rather than a flavour of `Sale`, because a
pending cash-on-delivery order is a promise, and booking it as revenue would
overstate the shop's takings for as long as it sits unfulfilled.

When the merchant marks an order **delivered** — the moment the cash actually
arrives — the order is written into the books as a `COMPLETED` sale with a
`CASH` payment for the full amount, linked back through `online_orders.sale_id`.
No stock moves at that point. `sales.delivery_charge` keeps the shipping fee in
its own column so `total` is what the rider actually collected.

Statuses are forward-only, plus cancellation from anything not yet delivered:

```
PENDING → CONFIRMED → PROCESSING → SHIPPED → DELIVERED
   └──────────┴────────────┴───────────┴──→ CANCELLED
```

A delivered order cannot be reopened: reversing it means un-writing a sale and a
payment, which is a return, and returns are not modelled yet — so it is refused
rather than half-done. The dashboard's buttons are driven by the same table the
server enforces, so the UI never offers a move the API will reject.

### Customers

An online buyer is upserted into the shop's existing `customers` table on
`(shop_id, phone)` — the same upsert the POS checkout performs — so someone who
orders online and later walks into the shop is one customer, not two.

---

## Images

Product photos, store logos, banners and favicons are **uploaded**, not linked.
A shopkeeper's pictures are on their phone, not on a web server they can paste a
URL from, so a URL box asks them to solve a hosting problem before they can list
anything.

There is no object storage on this deployment, so the bytes live in Postgres
(`media_assets`) and are served by `GET /api/media/:id`.

**The browser shrinks every upload before sending it** (`client/src/lib/image-upload.ts`):
resized to fit 1400px, re-encoded as WebP (JPEG where WebP is unsupported), with
the quality stepped down until it is under ~400 kB. A 5 MB camera photo arrives
at roughly 150 kB. The server enforces its own ceiling on top of that, sniffs
magic numbers rather than trusting the declared type, and refuses anything that
is not a real JPEG, PNG or WebP.

Uploads are posted as base64 JSON rather than multipart, because the serverless
bridge in `api/[...route].ts` re-serialises request bodies and multipart is the
shape that has already broken there once.

**Storage format.** A row stores `media:<uuid>`, never a URL — a URL would bake
the current hostname into the database and break when the domain changes. The
API resolves it to an absolute URL against the request's own host on the way
out, so the same row renders correctly from localhost, the dashboard, and every
storefront subdomain. Absolute `http(s)://` values still render, for images that
predate uploads, but nothing in the UI produces one.

**Tenancy.** Uploading is authenticated and scoped to the session's shop.
Attaching an image verifies it belongs to that shop, so a merchant cannot point
their product or logo at another shop's asset by quoting its id. Serving is
public and unauthenticated — a storefront shopper has no session, and a product
photograph is public by definition; ids are random UUIDs, so the route is not
enumerable.

**One header worth knowing about.** `secureHeaders` sets
`Cross-Origin-Resource-Policy: same-origin` on every response, and a browser
refuses a cross-origin `<img>` on that header *before* it looks at CORS. The
media route needs `cross-origin`, and because `secureHeaders` runs after the
handler, app.ts overrides it from a middleware registered *ahead* of
`secureHeaders` — outer middleware gets the last word after `await next()`.
Every other route keeps the strict default.

If an object store is added later, the column that changes is the storage key.
Nothing a caller sees moves.

## SEO

Each storefront sets its own `<title>`, description, Open Graph tags, canonical
URL, favicon and JSON-LD (`Store` on the homepage, `Product` with an `Offer` on
a product page) from `client/src/storefront/lib/seo.ts`.

These are written into the live document, so Google — which renders JavaScript —
indexes them. A link-preview crawler that does **not** run JS (Facebook,
WhatsApp) reads the static HTML and will show the zPOS defaults instead. Making
previews per-store would require server-rendering the shell, which is a larger
change than this feature warranted; `seo.ts` is shaped so that swap would not
change any caller.

---

## Testing

```
cd server && bun test src/__tests__      # 153 tests, incl. storefront + orders
cd client && bun run test                # tenant resolution
```

`server/src/__tests__/api/storefront.test.ts` covers tenant isolation, price
resolution, overselling and the address/phone validation.
`server/src/__tests__/api/store.test.ts` covers slug rules, the pricing guard,
and every status transition including the restock and the delivered-sale write.
`server/src/__tests__/api/media.test.ts` covers upload validation (including a
non-image wearing an image header), public serving, cross-shop image theft, and
the cross-origin header that product photos will not load without.
