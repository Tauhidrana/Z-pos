
import { z } from "zod";

export const paymentMethodSchema = z.enum(["CASH", "BKASH", "NAGAD", "ROCKET"]);
export const paymentStatusSchema = z.enum(["PAID", "DUE", "PARTIAL"]);

export const customerInfoSchema = z.object({
    name: z.string().min(1, "Customer name is required"),
    phone: z.string().min(1, "Phone is required"),
    email: z.string().email("Invalid email").or(z.literal("")),
    address: z.string(),
});

export const checkoutPayloadSchema = z.object({
    method: paymentMethodSchema,
    status: paymentStatusSchema,
    paidAmount: z.number().nonnegative("Paid amount cannot be negative"),
    customer: customerInfoSchema,
});

export const saleSchema = z.object({
    cartItems: z
        .array(
            z.object({
                variantId: z.string().min(1),
                quantity: z.number().int().positive("Quantity must be at least 1"),
                /**
                 * The scanned label, when there was one.
                 *
                 * Optional, because a barcode is only ever issued against a
                 * purchase batch, and plenty of real stock never goes through
                 * one — opening stock entered when the product was created, or
                 * a variant added by hand afterwards. Requiring it here meant
                 * such a product could be put on the shelf and counted, but
                 * never rung up.
                 *
                 * When present the line is priced from that batch, which is
                 * what the till has always done. When absent it is priced from
                 * the variant's own shelf price, server-side either way — the
                 * client never sends a price.
                 */
                barcode: z.preprocess(
                    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
                    z.string().min(13).max(13).optional(),
                ),
                discount: z.object({
                    type: z.enum(["percent", "fixed"]),
                    amount: z.number().nonnegative(),
                }),
            })
        )
        .min(1, "Cart cannot be empty"),

    totalAmount: z.number().nonnegative(),
    checkout: checkoutPayloadSchema,
}).refine(
    (data) => {
        if (data.checkout.status === "PAID") {
            return data.checkout.paidAmount >= data.totalAmount;
        }
        if (data.checkout.status === "DUE") {
            return data.checkout.paidAmount === 0;
        }
        if (data.checkout.status === "PARTIAL") {
            return (
                data.checkout.paidAmount > 0 &&
                data.checkout.paidAmount < data.totalAmount
            );
        }
        return true;
    },
    {
        message: "Paid amount is inconsistent with payment status",
        path: ["checkout", "paidAmount"],
    }
);

export type SalePayload = z.infer<typeof saleSchema>;