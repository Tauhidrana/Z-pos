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

**Where the bytes go.** New uploads are written to Vercel Blob and referenced by
their CDN URL, so an image-heavy shop front loads its pictures from the edge and
this API is not involved at all. Images that predate that change live in Postgres
(`media_assets.data`) and are still served by `GET /api/media/:id`; nothing was
migrated and nothing broke. A deployment with no `BLOB_READ_WRITE_TOKEN` falls
back to the database path and works exactly as it did.

**The browser shrinks every upload before sending it** (`client/src/lib/image-upload.ts`):
resized to fit 1400px, re-encoded as WebP (JPEG where WebP is unsupported), with
the quality stepped down until it is under ~400 kB. A 5 MB camera photo arrives
at roughly 150 kB. The server enforces its own ceiling on top of that, sniffs
magic numbers rather than trusting the declared type, and refuses anything that
is not a real JPEG, PNG or WebP.

Uploads are posted as base64 JSON rather than multipart, because the serverless
bridge in `api/[...route].ts` re-serialises request bodies and multipart is the
shape that has already broken there once.

**Storage format.** A database-backed row stores `media:<uuid>`, never a URL of
our own — that would bake the current hostname into the database and break when
the domain changes. `mediaUrlResolver` turns it into an absolute URL against the
request's own host on the way out, so the same row renders correctly from
localhost, the dashboard, and every storefront subdomain. A blob-backed row
stores the CDN URL itself, which has no hostname of ours in it to go stale, and
passes through untouched. Other absolute `http(s)://` values still render, for
seeded catalogues pointing at external hosts.

**Tenancy.** Uploading is authenticated and scoped to the session's shop.
Attaching an image verifies it belongs to that shop — `resolveImageRefs`, which
every write that accepts an image calls — so a merchant cannot point their
product, banner, category tile or logo at another shop's asset by quoting its
id. A blob URL is checked the same way, because it is guessable in principle and
still belongs to one shop. Serving is public and unauthenticated — a storefront shopper has no session, and a product
photograph is public by definition; ids are random UUIDs, so the route is not
enumerable.

**One header worth knowing about.** `secureHeaders` sets
`Cross-Origin-Resource-Policy: same-origin` on every response, and a browser
refuses a cross-origin `<img>` on that header *before* it looks at CORS. The
media route needs `cross-origin`, and because `secureHeaders` runs after the
handler, app.ts overrides it from a middleware registered *ahead* of
`secureHeaders` — outer middleware gets the last word after `await next()`.
Every other route keeps the strict default.

Whichever backing store a row uses, callers see the same thing: a reference
going in, a loadable URL coming out.

## The shop front

Everything below is optional. A shop that fills in none of it still gets a
finished-looking storefront — that is the standard each fallback is written to,
because a merchant's first day is the day the page is emptiest.

### Banners

`store_banners` is a list, not a column. Up to `MAX_STORE_BANNERS` (five) slides,
each with optional title, subtitle and button, ordered by `position` and
individually switchable with `is_active` — so a seasonal banner can be retired
without deleting the artwork.

The merchant manages them at **/store/banners**; the storefront renders them in
`hero-carousel.tsx`, a CSS scroll-snap track rather than a carousel library. The
browser already does momentum, snapping and touch better than JavaScript can, it
costs no bundle, and a shopper on a slow phone can swipe before any script has
run. Autoplay stops for `prefers-reduced-motion` and for a hidden tab.

Reordering sends the **whole list of ids** in their new order, not "move this one
to index N": the client already knows the arrangement it wants, and one relative
move per request can interleave and land out of order. The server refuses a list
that is not exactly the store's own banners, and renumbers inside a transaction
so a failure halfway cannot leave two slides claiming one slot.

`Store.banner_url` — the original single cover image — is untouched and acts as
the implicit first slide, so no existing storefront lost its cover. With no
banners and no cover, the hero falls back to a typographic panel.

**A banner button is merchant-supplied text rendered into an `href`**, so
`bannerLinkSchema` accepts a storefront-relative path or an absolute `http(s)`
URL and nothing else. Without that, `javascript:` in a banner link is stored XSS
on every shopper's homepage.

### Category artwork and order

Categories gained `image_url` and `position`. The storefront's category rail and
grid render a square tile: the artwork when there is one, a typographic panel
when there is not. Ordering is `position` then `name`, and every row defaults to
0, so an untouched catalogue stays alphabetical.

Slugs are generated by `categorySlug` in the shared schema package rather than
inline. The old `name.toLowerCase().replace(/\s+/g, "-")` left apostrophes,
slashes and ampersands in the URL, and returned an **empty string** for a wholly
non-Latin name like "পোশাক" — which are common here, and which then collided
with each other on the shop's unique `(shop_id, slug)` index. Empty now falls
back to a discriminator, and the controller walks a numeric suffix past any
clash.

A category is re-slugged **only on an actual rename**. Re-deriving it on every
save would change a live storefront URL because the merchant edited a
description, silently breaking links customers had already shared.

### Policy pages

`delivery_info`, `return_policy`, `terms` and `privacy_policy` are long text on
`stores`, each rendered as its own storefront page (`/delivery`, `/returns`,
`/terms`, `/privacy`).

They are **not** part of the homepage payload. Terms and a privacy policy can run
to twenty thousand characters each, and the homepage only needs to know whether
to draw a footer link — so `GET /:slug` returns four booleans derived in SQL
(`policyFlags`), and `GET /:slug/policies` returns the text, fetched only when a
shopper opens one of the pages and cached for five minutes.

The footer links only to pages that have content. A link leading to an empty
"Return policy" is worse than no link: a shopper deciding whether to trust an
unfamiliar shop with a cash order reads it as the shop having no policy at all.

Merchant text is rendered with `whitespace-pre-line`, never as HTML — their line
breaks are the only formatting a plain textarea produces, and treating it as
markup would be an injection hole on every shopper's browser.

### Location and hours

`opening_hours` is free text and appears in the footer as typed.

`latitude`/`longitude` are optional and range-checked on write, because a
transposed pair (lat 90.4, lng 23.8 instead of Dhaka's 23.8, 90.4) is the usual
way a pin lands in the Arctic. When both are set the footer address becomes a
link to the phone's own map app, and the homepage's `Store` JSON-LD gains a
`GeoCoordinates`, which is what puts a shop on a local-results map.

`opening_hours` is deliberately *not* emitted as JSON-LD: schema.org wants
`Mo-Th 10:00-20:00`, the merchant typed "Sat–Thu 10am–8pm · Friday closed", and
invalid structured data is treated worse than absent data.

## SEO

Each storefront sets its own `<title>`, description, Open Graph tags, canonical
URL, favicon and JSON-LD (`Store` on the homepage, `Product` with an `Offer` on
a product page) from `client/src/storefront/lib/seo.ts`.

`meta_title` and `meta_description` let a merchant override the first two. Both
fall back to the store's own name and description, so every shop gets tags about
itself rather than a generic zPOS one whether or not anyone fills the boxes in.

These are written into the live document, so Google — which renders JavaScript —
indexes them. A link-preview crawler that does **not** run JS (Facebook,
WhatsApp) reads the static HTML and will show the zPOS defaults instead. Making
previews per-store would require server-rendering the shell, which is a larger
change than this feature warranted; `seo.ts` is shaped so that swap would not
change any caller.

---

## Testing

```
cd server && bun test src/__tests__      # 210 tests, incl. storefront + orders
cd client && bun run test                # tenant resolution
```

`server/src/__tests__/api/storefront.test.ts` covers tenant isolation, price
resolution, overselling, the address/phone validation, and the homepage payload —
active-only banners in order, an unresolvable slide being dropped rather than
shipped broken, and the policy flags arriving without the policy text.
`server/src/__tests__/api/store.test.ts` covers slug rules, the pricing guard,
and every status transition including the restock and the delivered-sale write.
`server/src/__tests__/api/banners.test.ts` covers the `javascript:`/`data:` link
guard, cross-shop artwork, the five-slide limit, appending rather than
prepending, and a reorder that is partial or contains another store's id.
`server/src/__tests__/api/category.test.ts` covers slug generation (punctuation,
accents, a wholly non-Latin name, collisions) and that only a rename re-slugs.
`server/src/__tests__/api/media.test.ts` covers upload validation (including a
non-image wearing an image header), public serving, cross-shop image theft, and
the cross-origin header that product photos will not load without.
