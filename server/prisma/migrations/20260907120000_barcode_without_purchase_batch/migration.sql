-- A barcode no longer has to name a purchase batch.
--
-- Stock that never came through a purchase — opening stock entered with the
-- product, a variant added by hand, or a manufacturer's own barcode linked to
-- something already on the shelf — had no batch to point at, so it could not be
-- allocated a barcode at all. Such a unit is priced from
-- `product_variants.last_sell_price` instead.
ALTER TABLE "variant_barcode_allocations"
  ALTER COLUMN "purchase_item_id" DROP NOT NULL;
