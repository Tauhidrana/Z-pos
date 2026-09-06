-- Online store: a public storefront per shop, selling the shop's own catalog.
--
-- Nothing here changes how the POS behaves. Every column added to an existing
-- table is nullable or defaulted, and the two new movement paths (an order
-- reserving stock, a cancellation returning it) go through the same append-only
-- ledger the till already writes to.

-- ── 1. Enums ────────────────────────────────────────────────────────────────
CREATE TYPE "OnlineOrderStatus" AS ENUM (
    'PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'
);
CREATE TYPE "OnlineOrderPaymentMethod" AS ENUM ('COD');

-- ── 2. Storefront columns on the existing catalog ───────────────────────────
ALTER TABLE "products"
    ADD COLUMN "slug"           TEXT,
    ADD COLUMN "online_visible" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "is_featured"    BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "product_variants"
    ADD COLUMN "last_sell_price"   DECIMAL(10,2),
    ADD COLUMN "online_price"      DECIMAL(10,2),
    ADD COLUMN "online_sale_price" DECIMAL(10,2);

ALTER TABLE "sales"
    ADD COLUMN "delivery_charge" DECIMAL(10,2) NOT NULL DEFAULT 0;

ALTER TABLE "stock_ledgers"
    ADD COLUMN "online_order_id" TEXT;

-- The ledger's "one source per row" invariant now has a fourth source to
-- account for. Replacing the constraint rather than adding a second one keeps
-- the rule expressible in a single place.
ALTER TABLE "stock_ledgers" DROP CONSTRAINT IF EXISTS "stock_ledger_one_source";
ALTER TABLE "stock_ledgers"
ADD CONSTRAINT "stock_ledger_one_source" CHECK (
    (("sale_id"         IS NOT NULL)::int +
     ("purchase_id"     IS NOT NULL)::int +
     ("adjustment_id"   IS NOT NULL)::int +
     ("online_order_id" IS NOT NULL)::int) <= 1
);

-- ── 3. Backfill the denormalized shelf price ────────────────────────────────
-- A storefront shopper has no barcode in hand, so it cannot price a unit from
-- the purchase batch the way the till does. `last_sell_price` is the sell price
-- of the variant's most recent purchase — the price the next unit would ring up
-- at — and from here on it is written on every purchase.
UPDATE "product_variants" pv
SET "last_sell_price" = latest.sell_price
FROM (
    SELECT DISTINCT ON (pi."variant_id")
           pi."variant_id",
           pi."sell_price"
    FROM "purchase_items" pi
    JOIN "purchases" p ON p."id" = pi."purchase_id"
    ORDER BY pi."variant_id", p."date" DESC, p."created_at" DESC
) AS latest
WHERE latest."variant_id" = pv."id";

-- ── 4. Backfill product slugs ───────────────────────────────────────────────
-- Slugified name, de-duplicated within the shop by appending -2, -3, … in a
-- stable order. A name that slugifies to nothing (all punctuation, or a script
-- with no ASCII) falls back to a short id fragment so the row still gets one.
WITH slugged AS (
    SELECT
        p."id",
        p."shop_id",
        COALESCE(
            NULLIF(
                TRIM(BOTH '-' FROM REGEXP_REPLACE(LOWER(p."name"), '[^a-z0-9]+', '-', 'g')),
                ''
            ),
            'product-' || SUBSTRING(p."id" FROM 1 FOR 8)
        ) AS base
    FROM "products" p
),
numbered AS (
    SELECT
        "id",
        base,
        ROW_NUMBER() OVER (PARTITION BY "shop_id", base ORDER BY "id") AS rn
    FROM slugged
)
UPDATE "products" p
SET "slug" = CASE WHEN n.rn = 1 THEN n.base ELSE n.base || '-' || n.rn END
FROM numbered n
WHERE n."id" = p."id" AND p."slug" IS NULL;

CREATE UNIQUE INDEX "products_shop_id_slug_key" ON "products" ("shop_id", "slug");
CREATE INDEX "products_shop_id_online_visible_is_active_idx"
    ON "products" ("shop_id", "online_visible", "is_active");

-- ── 5. Product imagery ──────────────────────────────────────────────────────
CREATE TABLE "product_images" (
    "id"         TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "url"        TEXT NOT NULL,
    "alt"        TEXT,
    "position"   INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "product_images_product_id_position_idx"
    ON "product_images" ("product_id", "position");
ALTER TABLE "product_images"
    ADD CONSTRAINT "product_images_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 6. The store ────────────────────────────────────────────────────────────
CREATE TABLE "stores" (
    "id"                 TEXT NOT NULL,
    "shop_id"            TEXT NOT NULL,
    "slug"               TEXT NOT NULL,
    "name"               TEXT NOT NULL,
    "description"        TEXT,
    "logo_url"           TEXT,
    "banner_url"         TEXT,
    "favicon_url"        TEXT,
    "phone"              TEXT,
    "email"              TEXT,
    "address"            TEXT,
    "facebook_url"       TEXT,
    "instagram_url"      TEXT,
    "whatsapp_number"    TEXT,
    "delivery_charge"    DECIMAL(10,2) NOT NULL DEFAULT 60,
    "free_delivery_over" DECIMAL(10,2),
    "min_order_amount"   DECIMAL(10,2) NOT NULL DEFAULT 0,
    "theme_color"        TEXT NOT NULL DEFAULT '#a8431d',
    "is_active"          BOOLEAN NOT NULL DEFAULT true,
    "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"         TIMESTAMP(3) NOT NULL,
    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "stores_shop_id_key" ON "stores" ("shop_id");
CREATE UNIQUE INDEX "stores_slug_key"    ON "stores" ("slug");
CREATE INDEX        "stores_slug_idx"    ON "stores" ("slug");
ALTER TABLE "stores"
    ADD CONSTRAINT "stores_shop_id_fkey"
    FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 7. Orders ───────────────────────────────────────────────────────────────
CREATE TABLE "online_orders" (
    "id"              TEXT NOT NULL,
    "shop_id"         TEXT NOT NULL,
    "store_id"        TEXT NOT NULL,
    "order_number"    TEXT NOT NULL,
    "status"          "OnlineOrderStatus" NOT NULL DEFAULT 'PENDING',
    "payment_method"  "OnlineOrderPaymentMethod" NOT NULL DEFAULT 'COD',
    "customer_id"     TEXT,
    "customer_name"   TEXT NOT NULL,
    "customer_phone"  TEXT NOT NULL,
    "customer_email"  TEXT,
    "division"        TEXT NOT NULL,
    "district"        TEXT NOT NULL,
    "upazila"         TEXT NOT NULL,
    "area"            TEXT,
    "address_line"    TEXT NOT NULL,
    "note"            TEXT,
    "subtotal"        DECIMAL(10,2) NOT NULL,
    "delivery_charge" DECIMAL(10,2) NOT NULL,
    "total"           DECIMAL(10,2) NOT NULL,
    "sale_id"         TEXT,
    "stock_restored"  BOOLEAN NOT NULL DEFAULT false,
    "cancelled_at"    TIMESTAMP(3),
    "delivered_at"    TIMESTAMP(3),
    "placed_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL,
    CONSTRAINT "online_orders_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "online_orders_sale_id_key"            ON "online_orders" ("sale_id");
CREATE UNIQUE INDEX "online_orders_shop_id_order_number_key" ON "online_orders" ("shop_id", "order_number");
CREATE INDEX "online_orders_shop_id_status_placed_at_idx"  ON "online_orders" ("shop_id", "status", "placed_at");
CREATE INDEX "online_orders_shop_id_placed_at_idx"         ON "online_orders" ("shop_id", "placed_at");
CREATE INDEX "online_orders_store_id_idx"                  ON "online_orders" ("store_id");
CREATE INDEX "online_orders_customer_id_idx"               ON "online_orders" ("customer_id");
CREATE INDEX "online_orders_customer_phone_idx"            ON "online_orders" ("customer_phone");

ALTER TABLE "online_orders"
    ADD CONSTRAINT "online_orders_shop_id_fkey"
    FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "online_orders"
    ADD CONSTRAINT "online_orders_store_id_fkey"
    FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "online_orders"
    ADD CONSTRAINT "online_orders_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "online_orders"
    ADD CONSTRAINT "online_orders_sale_id_fkey"
    FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "online_order_items" (
    "id"           TEXT NOT NULL,
    "order_id"     TEXT NOT NULL,
    "variant_id"   TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "variant_name" TEXT,
    "image_url"    TEXT,
    "unit_price"   DECIMAL(10,2) NOT NULL,
    "quantity"     INTEGER NOT NULL,
    "total"        DECIMAL(10,2) NOT NULL,
    CONSTRAINT "online_order_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "online_order_items_order_id_idx"   ON "online_order_items" ("order_id");
CREATE INDEX "online_order_items_variant_id_idx" ON "online_order_items" ("variant_id");
ALTER TABLE "online_order_items"
    ADD CONSTRAINT "online_order_items_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "online_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "online_order_items"
    ADD CONSTRAINT "online_order_items_variant_id_fkey"
    FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── 8. Ledger → order foreign key ───────────────────────────────────────────
CREATE INDEX "stock_ledgers_online_order_id_idx" ON "stock_ledgers" ("online_order_id");
ALTER TABLE "stock_ledgers"
    ADD CONSTRAINT "stock_ledgers_online_order_id_fkey"
    FOREIGN KEY ("online_order_id") REFERENCES "online_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
