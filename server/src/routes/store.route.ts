import { Hono } from "hono";
import type { AppEnv } from "@/types";
import { validate } from "@/middleware/validate.middleware";
import { requireRole } from "@/middleware/requireRole.middleware";
import { StoreController } from "@/controllers/store.controller";
import { OnlineOrderController } from "@/controllers/online-order.controller";
import {
    createStoreSchema,
    updateStoreSchema,
    updateStoreProductSchema,
    updateStoreVariantSchema,
} from "@myapp/shared/schemas/store.schema";
import { updateOrderStatusSchema } from "@myapp/shared/schemas/online-order.schema";

/**
 * Merchant-side store management. Mounted under the authenticated `/api/*`
 * subtree, so every handler already has the session's own `shopId` and never
 * takes one from the caller.
 *
 * Opening, renaming or closing a store is an OWNER decision — it changes the
 * business's public face and its web address. Day-to-day work (listing
 * products online, pricing them, moving orders along) is open to STAFF, who are
 * the people actually packing the boxes.
 */
const storeRouter = new Hono<AppEnv>();

storeRouter.get("/", StoreController.getMyStore);
storeRouter.get("/slug-check", StoreController.checkSlug);
storeRouter.post("/", requireRole("OWNER"), validate(createStoreSchema), StoreController.createStore);
storeRouter.patch("/", requireRole("OWNER"), validate(updateStoreSchema), StoreController.updateStore);

storeRouter.get("/products", StoreController.getStoreProducts);
storeRouter.get("/products/:id", StoreController.getStoreProduct);
storeRouter.patch(
    "/products",
    validate(updateStoreProductSchema),
    StoreController.updateStoreProduct,
);
storeRouter.patch(
    "/variants",
    validate(updateStoreVariantSchema),
    StoreController.updateStoreVariant,
);

storeRouter.get("/orders/stats", OnlineOrderController.getStats);
storeRouter.get("/orders", OnlineOrderController.getOrders);
storeRouter.get("/orders/:id", OnlineOrderController.getOrder);
storeRouter.patch(
    "/orders/status",
    validate(updateOrderStatusSchema),
    OnlineOrderController.updateStatus,
);

export default storeRouter;
