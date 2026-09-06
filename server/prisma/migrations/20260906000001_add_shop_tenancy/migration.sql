-- Multi-tenancy: scope every owned table to a shop.
--
-- Until now the database held one shared dataset. Any signed-in account saw
-- every other account's products, customers and sales, and an edit by one was
-- an edit for all, because nothing recorded who anything belonged to.
--
-- The boundary is the shop rather than the user, so an OWNER's invited STAFF
-- keep working the same catalog — that is what the invite flow is for.

-- ── 1. The shop table ───────────────────────────────────────────────────────
CREATE TABLE "shops" (
    "id"         TEXT NOT NULL,
    "name"       TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "shops_pkey" PRIMARY KEY ("id")
);

-- ── 2. Nullable columns first, so existing rows survive the add ─────────────
ALTER TABLE "users"             ADD COLUMN "shop_id" TEXT;
ALTER TABLE "categories"        ADD COLUMN "shop_id" TEXT;
ALTER TABLE "products"          ADD COLUMN "shop_id" TEXT;
ALTER TABLE "customers"         ADD COLUMN "shop_id" TEXT;
ALTER TABLE "suppliers"         ADD COLUMN "shop_id" TEXT;
ALTER TABLE "sales"             ADD COLUMN "shop_id" TEXT;
ALTER TABLE "purchases"         ADD COLUMN "shop_id" TEXT;
ALTER TABLE "stock_adjustments" ADD COLUMN "shop_id" TEXT;
ALTER TABLE "counters"          ADD COLUMN "shop_id" TEXT;

-- ── 3. Backfill ────────────────────────────────────────────────────────────
-- All pre-existing data belongs to one shop. Its owner is the account that has
-- been running the system; if that address is absent (a fresh clone), fall back
-- to any OWNER, then to any user at all, so this migration never strands rows.
DO $$
DECLARE
    primary_owner TEXT;
    primary_shop  TEXT;
BEGIN
    SELECT id INTO primary_owner FROM "users" WHERE email = 'tauhidrana00@gmail.com' LIMIT 1;
    IF primary_owner IS NULL THEN
        SELECT id INTO primary_owner FROM "users" WHERE role = 'OWNER' ORDER BY created_at LIMIT 1;
    END IF;
    IF primary_owner IS NULL THEN
        SELECT id INTO primary_owner FROM "users" ORDER BY created_at LIMIT 1;
    END IF;

    -- No users at all means no data to move either; nothing to do.
    IF primary_owner IS NOT NULL THEN
        primary_shop := gen_random_uuid()::text;
        INSERT INTO "shops" ("id", "name", "created_at", "updated_at")
        VALUES (primary_shop, 'My Shop', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

        UPDATE "categories"        SET "shop_id" = primary_shop WHERE "shop_id" IS NULL;
        UPDATE "products"          SET "shop_id" = primary_shop WHERE "shop_id" IS NULL;
        UPDATE "customers"         SET "shop_id" = primary_shop WHERE "shop_id" IS NULL;
        UPDATE "suppliers"         SET "shop_id" = primary_shop WHERE "shop_id" IS NULL;
        UPDATE "sales"             SET "shop_id" = primary_shop WHERE "shop_id" IS NULL;
        UPDATE "purchases"         SET "shop_id" = primary_shop WHERE "shop_id" IS NULL;
        UPDATE "stock_adjustments" SET "shop_id" = primary_shop WHERE "shop_id" IS NULL;
        UPDATE "counters"          SET "shop_id" = primary_shop WHERE "shop_id" IS NULL;

        -- The owner, plus every STAFF account, joins that shop: the staff rows
        -- are the ones that recorded the sales now sitting in it.
        UPDATE "users" SET "shop_id" = primary_shop
        WHERE "id" = primary_owner OR "role" = 'STAFF';
    END IF;
END $$;

-- Every other OWNER gets their own empty shop, so they start isolated rather
-- than being dropped into someone else's books.
DO $$
DECLARE
    u        RECORD;
    new_shop TEXT;
BEGIN
    FOR u IN SELECT id FROM "users" WHERE "role" = 'OWNER' AND "shop_id" IS NULL LOOP
        new_shop := gen_random_uuid()::text;
        INSERT INTO "shops" ("id", "name", "created_at", "updated_at")
        VALUES (new_shop, 'My Shop', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
        UPDATE "users" SET "shop_id" = new_shop WHERE "id" = u.id;
    END LOOP;
END $$;

-- ── 4. Now the columns can be required ─────────────────────────────────────
-- `users.shop_id` stays nullable: an invite row may exist before its shop is
-- resolved. The application refuses a session without one.
ALTER TABLE "categories"        ALTER COLUMN "shop_id" SET NOT NULL;
ALTER TABLE "products"          ALTER COLUMN "shop_id" SET NOT NULL;
ALTER TABLE "customers"         ALTER COLUMN "shop_id" SET NOT NULL;
ALTER TABLE "suppliers"         ALTER COLUMN "shop_id" SET NOT NULL;
ALTER TABLE "sales"             ALTER COLUMN "shop_id" SET NOT NULL;
ALTER TABLE "purchases"         ALTER COLUMN "shop_id" SET NOT NULL;
ALTER TABLE "stock_adjustments" ALTER COLUMN "shop_id" SET NOT NULL;
ALTER TABLE "counters"          ALTER COLUMN "shop_id" SET NOT NULL;

-- ── 5. Counters are keyed per shop, so invoice numbering restarts per shop ──
ALTER TABLE "counters" DROP CONSTRAINT "counters_pkey";
ALTER TABLE "counters" ADD CONSTRAINT "counters_pkey" PRIMARY KEY ("shop_id", "key");

-- ── 6. Global uniques become per-shop ──────────────────────────────────────
-- A phone number, category name or invoice number belonging to one shop must
-- not block another shop from using it.
DROP INDEX "categories_name_key";
DROP INDEX "categories_slug_key";
DROP INDEX "customers_phone_key";
DROP INDEX "suppliers_phone_key";
DROP INDEX "suppliers_email_key";
DROP INDEX "sales_invoice_number_key";

CREATE UNIQUE INDEX "categories_shop_id_name_key"  ON "categories" ("shop_id", "name");
CREATE UNIQUE INDEX "categories_shop_id_slug_key"  ON "categories" ("shop_id", "slug");
CREATE UNIQUE INDEX "customers_shop_id_phone_key"  ON "customers"  ("shop_id", "phone");
CREATE UNIQUE INDEX "suppliers_shop_id_phone_key"  ON "suppliers"  ("shop_id", "phone");
CREATE UNIQUE INDEX "suppliers_shop_id_email_key"  ON "suppliers"  ("shop_id", "email");
CREATE UNIQUE INDEX "sales_shop_id_invoice_number_key" ON "sales"  ("shop_id", "invoice_number");

-- ── 7. Lookup indexes ──────────────────────────────────────────────────────
CREATE INDEX "users_shop_id_idx"             ON "users" ("shop_id");
CREATE INDEX "categories_shop_id_idx"        ON "categories" ("shop_id");
CREATE INDEX "products_shop_id_idx"          ON "products" ("shop_id");
CREATE INDEX "products_shop_id_normalized_key_idx" ON "products" ("shop_id", "normalized_key");
CREATE INDEX "customers_shop_id_idx"         ON "customers" ("shop_id");
CREATE INDEX "suppliers_shop_id_idx"         ON "suppliers" ("shop_id");
CREATE INDEX "sales_shop_id_idx"             ON "sales" ("shop_id");
CREATE INDEX "sales_shop_id_invoiced_at_idx" ON "sales" ("shop_id", "invoiced_at");
CREATE INDEX "sales_shop_id_status_created_at_idx" ON "sales" ("shop_id", "status", "created_at");
CREATE INDEX "purchases_shop_id_idx"         ON "purchases" ("shop_id");
CREATE INDEX "purchases_shop_id_date_idx"    ON "purchases" ("shop_id", "date");
CREATE INDEX "stock_adjustments_shop_id_idx" ON "stock_adjustments" ("shop_id");

-- ── 8. Foreign keys ────────────────────────────────────────────────────────
ALTER TABLE "users"             ADD CONSTRAINT "users_shop_id_fkey"             FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "categories"        ADD CONSTRAINT "categories_shop_id_fkey"        FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "products"          ADD CONSTRAINT "products_shop_id_fkey"          FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customers"         ADD CONSTRAINT "customers_shop_id_fkey"         FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "suppliers"         ADD CONSTRAINT "suppliers_shop_id_fkey"         FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales"             ADD CONSTRAINT "sales_shop_id_fkey"             FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchases"         ADD CONSTRAINT "purchases_shop_id_fkey"         FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "counters"          ADD CONSTRAINT "counters_shop_id_fkey"          FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
