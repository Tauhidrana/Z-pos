-- CreateEnum
CREATE TYPE "CustomerTokenKind" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');

-- DropIndex
-- Pre-existing drift, not part of this feature: the schema has only declared
-- @@index([shop_id, normalized_key]) for some time, but a bare
-- normalized_key index was still live in the database. Nothing reads it --
-- normalized_key is only ever written, and every duplicate check is scoped by
-- shop, which the composite index already serves -- so it was pure write
-- overhead on each product insert and update. Dropped here rather than left to
-- reappear as drift in front of every future migration.
DROP INDEX "products_normalized_key_idx";

-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "image_url" TEXT,
ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "online_orders" ADD COLUMN     "landmark" TEXT,
ADD COLUMN     "latitude" DECIMAL(10,7),
ADD COLUMN     "longitude" DECIMAL(10,7),
ADD COLUMN     "postal_code" TEXT,
ADD COLUMN     "store_customer_id" TEXT;

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "delivery_info" TEXT,
ADD COLUMN     "latitude" DECIMAL(10,7),
ADD COLUMN     "longitude" DECIMAL(10,7),
ADD COLUMN     "meta_description" TEXT,
ADD COLUMN     "meta_title" TEXT,
ADD COLUMN     "opening_hours" TEXT,
ADD COLUMN     "privacy_policy" TEXT,
ADD COLUMN     "return_policy" TEXT,
ADD COLUMN     "terms" TEXT;

-- CreateTable
CREATE TABLE "store_banners" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "image_url" TEXT NOT NULL,
    "title" TEXT,
    "subtitle" TEXT,
    "button_text" TEXT,
    "button_link" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_banners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_customers" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "password_hash" TEXT NOT NULL,
    "email_verified_at" TIMESTAMP(3),
    "password_version" INTEGER NOT NULL DEFAULT 0,
    "customer_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_tokens" (
    "id" TEXT NOT NULL,
    "store_customer_id" TEXT NOT NULL,
    "kind" "CustomerTokenKind" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_addresses" (
    "id" TEXT NOT NULL,
    "store_customer_id" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'Home',
    "recipient_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "division" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "upazila" TEXT NOT NULL,
    "area" TEXT,
    "address_line" TEXT NOT NULL,
    "landmark" TEXT,
    "postal_code" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "delivery_note" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wishlist_items" (
    "id" TEXT NOT NULL,
    "store_customer_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wishlist_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "store_banners_store_id_position_idx" ON "store_banners"("store_id", "position");

-- CreateIndex
CREATE INDEX "store_banners_store_id_is_active_position_idx" ON "store_banners"("store_id", "is_active", "position");

-- CreateIndex
CREATE INDEX "store_customers_store_id_idx" ON "store_customers"("store_id");

-- CreateIndex
CREATE INDEX "store_customers_shop_id_idx" ON "store_customers"("shop_id");

-- CreateIndex
CREATE INDEX "store_customers_customer_id_idx" ON "store_customers"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "store_customers_store_id_email_key" ON "store_customers"("store_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "customer_tokens_token_hash_key" ON "customer_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "customer_tokens_store_customer_id_kind_idx" ON "customer_tokens"("store_customer_id", "kind");

-- CreateIndex
CREATE INDEX "customer_tokens_expires_at_idx" ON "customer_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "customer_addresses_store_customer_id_idx" ON "customer_addresses"("store_customer_id");

-- CreateIndex
CREATE INDEX "customer_addresses_store_customer_id_is_default_idx" ON "customer_addresses"("store_customer_id", "is_default");

-- CreateIndex
CREATE INDEX "wishlist_items_store_customer_id_created_at_idx" ON "wishlist_items"("store_customer_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "wishlist_items_store_customer_id_product_id_key" ON "wishlist_items"("store_customer_id", "product_id");

-- CreateIndex
CREATE INDEX "online_orders_store_customer_id_placed_at_idx" ON "online_orders"("store_customer_id", "placed_at");

-- AddForeignKey
ALTER TABLE "store_banners" ADD CONSTRAINT "store_banners_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_customers" ADD CONSTRAINT "store_customers_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_customers" ADD CONSTRAINT "store_customers_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_tokens" ADD CONSTRAINT "customer_tokens_store_customer_id_fkey" FOREIGN KEY ("store_customer_id") REFERENCES "store_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_store_customer_id_fkey" FOREIGN KEY ("store_customer_id") REFERENCES "store_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_store_customer_id_fkey" FOREIGN KEY ("store_customer_id") REFERENCES "store_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_store_customer_id_fkey" FOREIGN KEY ("store_customer_id") REFERENCES "store_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
