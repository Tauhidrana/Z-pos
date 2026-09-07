-- Blob storage for images.
--
-- New uploads go to the blob store and are referenced by their CDN URL, so a
-- storefront's product photographs, banners and category art load without ever
-- touching this API. The row stays behind to record which shop owns the image,
-- which is what lets `resolveImageRefs` keep one shop from attaching another's
-- picture to its own product.
--
-- `data` becomes nullable rather than being dropped: images uploaded before
-- this change still have their bytes here and are still served from
-- /api/media/:id. Nothing is migrated and no existing image breaks.
ALTER TABLE "media_assets" ADD COLUMN     "pathname" TEXT,
ADD COLUMN     "url" TEXT,
ALTER COLUMN "data" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_url_key" ON "media_assets"("url");
