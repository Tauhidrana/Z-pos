import { Hono } from "hono";
import type { AppEnv } from "@/types";
import { validate } from "@/middleware/validate.middleware";
import { MediaController } from "@/controllers/media.controller";
import { uploadImageSchema } from "@myapp/shared/schemas/media.schema";

/**
 * Uploading needs a session; this router is mounted under the authenticated
 * `/api/*` subtree. Serving does NOT — see `mediaPublicRouter`, which app.ts
 * mounts ahead of the auth middleware, because storefront shoppers have no
 * account and still have to see the pictures.
 */
const mediaRouter = new Hono<AppEnv>();

mediaRouter.post("/", validate(uploadImageSchema), MediaController.upload);

export default mediaRouter;

export const mediaPublicRouter = new Hono<AppEnv>().get("/:id", MediaController.serve);
