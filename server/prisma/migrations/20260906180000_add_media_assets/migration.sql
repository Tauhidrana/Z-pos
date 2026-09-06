-- Uploaded images, stored in the database.
--
-- Product photos, store logos and banners were previously referenced by URL —
-- the merchant had to host the picture somewhere else and paste a link, which
-- is not something a shopkeeper with a phone full of photos can reasonably do.
--
-- There is no object storage on this deployment, so the bytes live here and are
-- served by `GET /api/media/:id`. The client shrinks every upload before it is
-- sent (a 5 MB camera photo arrives at roughly 150 kB), and the API refuses
-- anything over its own limit, so rows stay small.

CREATE TABLE "media_assets" (
    "id"         TEXT NOT NULL,
    "shop_id"    TEXT NOT NULL,
    "mime"       TEXT NOT NULL,
    "size"       INTEGER NOT NULL,
    "width"      INTEGER,
    "height"     INTEGER,
    "data"       BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "media_assets_shop_id_idx"            ON "media_assets" ("shop_id");
CREATE INDEX "media_assets_shop_id_created_at_idx" ON "media_assets" ("shop_id", "created_at");

ALTER TABLE "media_assets"
    ADD CONSTRAINT "media_assets_shop_id_fkey"
    FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
