import { Hono } from "hono";
import type { AppEnv } from "@/types";
import { validate } from "@/middleware/validate.middleware";
import { StorefrontController } from "@/controllers/storefront.controller";
import { placeOrderSchema } from "@myapp/shared/schemas/online-order.schema";

/**
 * Public storefront routes. Mounted BEFORE the `/api/*` auth middleware in
 * app.ts — a shopper has no zPOS account, so requiring a token here would mean
 * no storefront at all.
 *
 * The tenant is the `:slug` segment and nothing else. There is no id in any
 * body or query that names a shop, so the only store a caller can reach is the
 * one whose address they typed.
 */
const storefrontRouter = new Hono<AppEnv>();

storefrontRouter.get("/:slug", StorefrontController.getHome);
storefrontRouter.get("/:slug/categories", StorefrontController.getCategories);
storefrontRouter.get("/:slug/products", StorefrontController.getProducts);
storefrontRouter.get("/:slug/products/:productSlug", StorefrontController.getProduct);
storefrontRouter.post("/:slug/orders", validate(placeOrderSchema), StorefrontController.placeOrder);
storefrontRouter.get("/:slug/orders/:orderNumber", StorefrontController.getOrder);

export default storefrontRouter;
