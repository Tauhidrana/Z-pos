import { z } from "zod";
import { zodUUID, decimalNumber, zodDate, bangladeshiPhoneSchema, emailOptional, textOptional } from "./helper";

const product = z.object({
    variantId: zodUUID,
    unitCost: decimalNumber,
    quantity: decimalNumber,
    sellingPrice: decimalNumber,
})


export const newPurchaseSchema = z.object({
    date: zodDate,
    invoiceNo: textOptional,
    supplier: z.string().trim().min(1, "Supplier name is required"),
    // Blank means "no email", not "an invalid one" — the form labels this
    // field optional and has to behave that way.
    email: emailOptional,
    phone: bangladeshiPhoneSchema,
    note: textOptional,
    products: z.array(product).min(1, "Add at least one item to the order"),
})

export type NewPurchase = z.input<typeof newPurchaseSchema>
export type NewPurchaseProduct = z.input<typeof product>
