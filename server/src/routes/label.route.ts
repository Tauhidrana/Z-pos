import { Hono } from "hono";
import type { AppEnv } from "@/types";
import { LabelController } from "@/controllers/label.controller";
import { validate } from "@/middleware/validate.middleware";
import { issueBarcodeSchema } from "@myapp/shared/schemas/product.schema";

const labelRouter = new Hono<AppEnv>();

labelRouter.get("/sources", LabelController.getLabelSources);
labelRouter.post("/issue", validate(issueBarcodeSchema), LabelController.issueBarcode);

export default labelRouter;
