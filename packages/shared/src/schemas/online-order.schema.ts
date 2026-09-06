import { z } from "zod";
import { zodUUID, bangladeshiPhoneSchema } from "./helper";

export const ONLINE_ORDER_STATUSES = [
    "PENDING",
    "CONFIRMED",
    "PROCESSING",
    "SHIPPED",
    "DELIVERED",
    "CANCELLED",
] as const;

export type OnlineOrderStatus = (typeof ONLINE_ORDER_STATUSES)[number];

/**
 * What the storefront checkout posts.
 *
 * Note what is absent: prices. The client sends variant ids and quantities and
 * nothing else about money — every line price, the delivery charge and the
 * total are recomputed on the server from the merchant's own catalog. A cart
 * edited in devtools buys nothing at a discount.
 */
export const placeOrderSchema = z.object({
    items: z
        .array(
            z.object({
                variantId: zodUUID,
                quantity: z
                    .number()
                    .int("Quantity must be a whole number")
                    .min(1, "Quantity must be at least 1")
                    .max(999, "Quantity is too large"),
            }),
        )
        .min(1, "Your cart is empty")
        .max(50, "Too many items in one order"),

    customer: z.object({
        name: z.string().trim().min(2, "Please enter your full name").max(80),
        phone: bangladeshiPhoneSchema,
        email: z.preprocess(
            (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
            z.string().trim().email("Enter a valid email").max(120).optional(),
        ),
    }),

    address: z.object({
        division: z.string().trim().min(1, "Select a division").max(60),
        district: z.string().trim().min(1, "Select a district").max(60),
        upazila: z.string().trim().min(1, "Select an upazila or thana").max(60),
        area: z.preprocess(
            (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
            z.string().trim().max(120).optional(),
        ),
        addressLine: z
            .string()
            .trim()
            .min(6, "Please give a full address a courier can find")
            .max(400),
    }),

    note: z.preprocess(
        (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
        z.string().trim().max(500).optional(),
    ),

    /** Cash on delivery is the only method today; the field pins the contract. */
    paymentMethod: z.literal("COD").default("COD"),
});

export type PlaceOrderPayload = z.infer<typeof placeOrderSchema>;

export const updateOrderStatusSchema = z.object({
    id: zodUUID,
    status: z.enum(ONLINE_ORDER_STATUSES),
});

export type UpdateOrderStatus = z.infer<typeof updateOrderStatusSchema>;
