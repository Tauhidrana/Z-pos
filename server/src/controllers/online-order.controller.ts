/**
 * Merchant-side management of storefront orders.
 *
 * Two rules govern the status transitions:
 *
 *   • Stock left the shelf when the order was placed, so no forward transition
 *     touches inventory. Only cancellation returns it, exactly once, guarded by
 *     `stock_restored`.
 *   • DELIVERED is the moment cash-on-delivery becomes cash. That is when the
 *     order is written into the books as a Sale with a CASH payment, so online
 *     revenue lands in the same reports as the till's — without a second stock
 *     movement, because the first one already happened.
 */

import type { Context } from "hono";
import prisma from "@/lib/prisma";
import { sendError, sendSuccess } from "@/utils/response";
import { AppError } from "@/utils/AppError";
import { mediaUrlResolver } from "@/controllers/media.controller";
import type { UpdateOrderStatus } from "@myapp/shared/schemas/online-order.schema";
import type { MerchantOrderDetail, MerchantOrderRow, MerchantOrderStats } from "@myapp/shared";
import {
    OnlineOrderStatus,
    PaymentMethod,
    Prisma,
    SaleStatus,
    StockDirection,
    StockMovementType,
} from "generated/prisma";
import { Decimal } from "generated/prisma/runtime/client";

/**
 * Which statuses each status may move to.
 *
 * Forward-only, plus cancellation from anything not yet delivered. A delivered
 * order is closed: reversing it would mean un-writing a Sale and a payment, and
 * a merchant who genuinely needs that is describing a return, which this system
 * does not model yet — so it is refused rather than half-done.
 */
const ALLOWED_TRANSITIONS: Record<OnlineOrderStatus, OnlineOrderStatus[]> = {
    PENDING: ["CONFIRMED", "PROCESSING", "CANCELLED"],
    CONFIRMED: ["PROCESSING", "SHIPPED", "CANCELLED"],
    PROCESSING: ["SHIPPED", "CANCELLED"],
    SHIPPED: ["DELIVERED", "CANCELLED"],
    DELIVERED: [],
    CANCELLED: [],
};

const OPEN_STATUSES: OnlineOrderStatus[] = ["PENDING", "CONFIRMED", "PROCESSING", "SHIPPED"];

export const OnlineOrderController = {
    /** Counters for the orders page header. */
    async getStats(c: Context) {
        const shopId = c.get("shopId") as string;
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);

        const [pending, processing, delivered, cancelled, revenue, ordersToday] =
            await Promise.all([
                prisma.onlineOrder.count({ where: { shop_id: shopId, status: "PENDING" } }),
                prisma.onlineOrder.count({
                    where: { shop_id: shopId, status: { in: ["CONFIRMED", "PROCESSING", "SHIPPED"] } },
                }),
                prisma.onlineOrder.count({ where: { shop_id: shopId, status: "DELIVERED" } }),
                prisma.onlineOrder.count({ where: { shop_id: shopId, status: "CANCELLED" } }),
                // Revenue counts delivered orders only — a pending COD order is
                // a promise, and booking it as income would overstate the shop's
                // takings for as long as it sits unfulfilled.
                prisma.onlineOrder.aggregate({
                    where: { shop_id: shopId, status: "DELIVERED" },
                    _sum: { total: true },
                }),
                prisma.onlineOrder.count({
                    where: { shop_id: shopId, placed_at: { gte: startOfToday } },
                }),
            ]);

        const stats: MerchantOrderStats = {
            pending,
            processing,
            delivered,
            cancelled,
            revenue: Number(revenue._sum.total ?? 0),
            ordersToday,
        };

        return sendSuccess(c, stats, "Order stats fetched successfully");
    },

    async getOrders(c: Context) {
        const shopId = c.get("shopId") as string;
        const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") ?? "20", 10) || 20));
        const search = c.req.query("search")?.trim() ?? "";
        const status = (c.req.query("status")?.trim().toUpperCase() ?? "ALL") as
            | OnlineOrderStatus
            | "ALL"
            | "OPEN";

        const VALID = [...Object.keys(ALLOWED_TRANSITIONS), "ALL", "OPEN"];
        if (!VALID.includes(status)) {
            return sendError(c, "Invalid status filter", "INVALID_REQUEST", 422);
        }

        const where: Prisma.OnlineOrderWhereInput = {
            shop_id: shopId,
            ...(status === "OPEN"
                ? { status: { in: OPEN_STATUSES } }
                : status === "ALL"
                  ? {}
                  : { status: status as OnlineOrderStatus }),
            ...(search
                ? {
                      OR: [
                          { order_number: { contains: search, mode: "insensitive" } },
                          { customer_name: { contains: search, mode: "insensitive" } },
                          { customer_phone: { contains: search } },
                      ],
                  }
                : {}),
        };

        const [rows, total] = await Promise.all([
            prisma.onlineOrder.findMany({
                where,
                select: {
                    id: true,
                    order_number: true,
                    status: true,
                    customer_name: true,
                    customer_phone: true,
                    total: true,
                    placed_at: true,
                    _count: { select: { items: true } },
                },
                orderBy: { placed_at: "desc" },
                skip: (page - 1) * limit,
                take: limit,
            }),
            prisma.onlineOrder.count({ where }),
        ]);

        const items: MerchantOrderRow[] = rows.map((order) => ({
            id: order.id,
            orderNumber: order.order_number,
            status: order.status,
            customerName: order.customer_name,
            customerPhone: order.customer_phone,
            itemCount: order._count.items,
            total: Number(order.total),
            placedAt: order.placed_at.toISOString(),
        }));

        return sendSuccess(
            c,
            { items, total, page, totalPages: Math.max(1, Math.ceil(total / limit)) },
            "Orders fetched successfully",
        );
    },

    async getOrder(c: Context) {
        const mediaUrl = mediaUrlResolver(c);
        const shopId = c.get("shopId") as string;
        const id = c.req.param("id") ?? "";

        // findFirst with the shop in the filter, not findUnique by id: an order
        // id from another shop must resolve to nothing rather than to a row we
        // then have to remember to check.
        const order = await prisma.onlineOrder.findFirst({
            where: { id, shop_id: shopId },
            select: {
                id: true,
                order_number: true,
                status: true,
                payment_method: true,
                customer_name: true,
                customer_phone: true,
                customer_email: true,
                division: true,
                district: true,
                upazila: true,
                area: true,
                address_line: true,
                note: true,
                subtotal: true,
                delivery_charge: true,
                total: true,
                placed_at: true,
                delivered_at: true,
                cancelled_at: true,
                stock_restored: true,
                sale: { select: { invoice_number: true } },
                items: {
                    select: {
                        id: true,
                        product_name: true,
                        variant_name: true,
                        image_url: true,
                        unit_price: true,
                        quantity: true,
                        total: true,
                    },
                },
            },
        });

        if (!order) return sendError(c, "Order not found", "NOT_FOUND", 404);

        const payload: MerchantOrderDetail = {
            id: order.id,
            orderNumber: order.order_number,
            status: order.status,
            paymentMethod: "COD",
            customerName: order.customer_name,
            customerPhone: order.customer_phone,
            customerEmail: order.customer_email,
            address: {
                division: order.division,
                district: order.district,
                upazila: order.upazila,
                area: order.area,
                addressLine: order.address_line,
            },
            note: order.note,
            items: order.items.map((item) => ({
                id: item.id,
                productName: item.product_name,
                variantName: item.variant_name,
                imageUrl: mediaUrl(item.image_url),
                unitPrice: Number(item.unit_price),
                quantity: item.quantity,
                total: Number(item.total),
            })),
            subtotal: Number(order.subtotal),
            deliveryCharge: Number(order.delivery_charge),
            total: Number(order.total),
            placedAt: order.placed_at.toISOString(),
            deliveredAt: order.delivered_at?.toISOString() ?? null,
            cancelledAt: order.cancelled_at?.toISOString() ?? null,
            stockRestored: order.stock_restored,
            invoiceNumber: order.sale?.invoice_number ?? null,
        };

        return sendSuccess(c, payload, "Order fetched successfully");
    },

    async updateStatus(c: Context) {
        const shopId = c.get("shopId") as string;
        const userId = c.get("userId") as string;
        const body = c.get("validatedBody") as UpdateOrderStatus;

        const result = await prisma.$transaction(async (tx) => {
            // Lock the order row for the whole transition. Two staff members
            // tapping "Cancel" at the same moment would otherwise both read
            // `stock_restored = false` and each return the stock.
            const locked = await tx.$queryRaw<
                Array<{ id: string; status: OnlineOrderStatus; stock_restored: boolean }>
            >(Prisma.sql`
                SELECT id, status, stock_restored
                FROM online_orders
                WHERE id = ${body.id} AND shop_id = ${shopId}
                FOR UPDATE
            `);

            const current = locked[0];
            if (!current) throw new AppError("Order not found", "NOT_FOUND", 404);

            if (current.status === body.status) {
                return { status: current.status, changed: false };
            }

            if (!ALLOWED_TRANSITIONS[current.status].includes(body.status)) {
                throw new AppError(
                    `An order that is ${current.status.toLowerCase()} cannot be moved to ${body.status.toLowerCase()}.`,
                    "INVALID_TRANSITION",
                    422,
                );
            }

            if (body.status === "CANCELLED") {
                await restoreStock(tx, current.id, current.stock_restored);
                await tx.onlineOrder.update({
                    where: { id: current.id },
                    data: {
                        status: "CANCELLED",
                        cancelled_at: new Date(),
                        stock_restored: true,
                    },
                });
                return { status: OnlineOrderStatus.CANCELLED, changed: true };
            }

            if (body.status === "DELIVERED") {
                await bookDeliveredOrder(tx, current.id, shopId, userId);
                return { status: OnlineOrderStatus.DELIVERED, changed: true };
            }

            await tx.onlineOrder.update({
                where: { id: current.id },
                data: { status: body.status },
            });
            return { status: body.status, changed: true };
        });

        return sendSuccess(
            c,
            result,
            result.changed ? "Order status updated" : "Order already has that status",
        );
    },
};

// ── Transitions ──────────────────────────────────────────────────────────────

type Tx = Prisma.TransactionClient;

/**
 * Return a cancelled order's units to the shelf.
 *
 * Written as ledger entries in the same shape a purchase uses (an IN movement
 * with the running balance), so the append-only history stays readable and
 * `stock_on_hand` never diverges from it. `alreadyRestored` short-circuits a
 * second pass — the row is locked by the caller, so this check is decisive.
 */
async function restoreStock(tx: Tx, orderId: string, alreadyRestored: boolean): Promise<void> {
    if (alreadyRestored) return;

    const items = await tx.onlineOrderItem.findMany({
        where: { order_id: orderId },
        select: { variant_id: true, quantity: true },
    });
    if (items.length === 0) return;

    // Merge by variant so one variant is locked and ledgered once even if the
    // order somehow carries it on two lines.
    const qtyByVariant = new Map<string, number>();
    for (const item of items) {
        qtyByVariant.set(item.variant_id, (qtyByVariant.get(item.variant_id) ?? 0) + item.quantity);
    }
    const variantIds = [...qtyByVariant.keys()];

    const locked = await tx.$queryRaw<Array<{ id: string; stock_on_hand: number }>>(Prisma.sql`
        SELECT id, stock_on_hand
        FROM product_variants
        WHERE id IN (${Prisma.join(variantIds)})
        FOR UPDATE
    `);
    const stockById = new Map(locked.map((v) => [v.id, Number(v.stock_on_hand)]));

    await tx.stockLedger.createMany({
        data: [...qtyByVariant.entries()].map(([variantId, quantity]) => ({
            variant_id: variantId,
            type: StockMovementType.ADJUSTMENT,
            direction: StockDirection.IN,
            quantity,
            balance_after: (stockById.get(variantId) ?? 0) + quantity,
            online_order_id: orderId,
        })),
    });

    await Promise.all(
        [...qtyByVariant.entries()].map(([variantId, quantity]) =>
            tx.productVariant.update({
                where: { id: variantId },
                data: { stock_on_hand: { increment: quantity } },
            }),
        ),
    );
}

/**
 * Record a delivered COD order as a Sale.
 *
 * This is the point the money exists, so this is where it enters the books: a
 * COMPLETED sale, its line items snapshotted from the order, a CASH payment for
 * the full amount, and the shipping fee kept in its own column so `total` is
 * what the rider actually collected.
 *
 * It deliberately writes no stock ledger entries. The units left the shelf when
 * the order was placed; moving them again here would double-count the sale
 * against inventory.
 */
async function bookDeliveredOrder(
    tx: Tx,
    orderId: string,
    shopId: string,
    userId: string,
): Promise<void> {
    const order = await tx.onlineOrder.findUnique({
        where: { id: orderId },
        select: {
            id: true,
            sale_id: true,
            customer_id: true,
            subtotal: true,
            delivery_charge: true,
            total: true,
            order_number: true,
            note: true,
            items: {
                select: {
                    variant_id: true,
                    product_name: true,
                    variant_name: true,
                    unit_price: true,
                    quantity: true,
                    total: true,
                },
            },
        },
    });

    if (!order) throw new AppError("Order not found", "NOT_FOUND", 404);

    // Already booked (a retried request, say) — mark delivered and stop, rather
    // than writing a second invoice for the same money.
    if (order.sale_id) {
        await tx.onlineOrder.update({
            where: { id: orderId },
            data: { status: "DELIVERED", delivered_at: new Date() },
        });
        return;
    }

    const counter = await tx.counter.upsert({
        where: { shop_id_key: { shop_id: shopId, key: "invoice" } },
        update: { value: { increment: 1 } },
        create: { shop_id: shopId, key: "invoice", value: 1001 },
    });
    const invoiceNumber = `INV-${new Date().getFullYear()}-${String(counter.value).padStart(6, "0")}`;

    const sale = await tx.sale.create({
        data: {
            shop_id: shopId,
            // The staff member who marked it delivered is the one who closed
            // the sale, which is the same relationship the till records.
            user_id: userId,
            customer_id: order.customer_id,
            invoice_number: invoiceNumber,
            invoiced_at: new Date(),
            status: SaleStatus.COMPLETED,
            subtotal: order.subtotal,
            discount_amount: new Decimal(0),
            tax_amount: new Decimal(0),
            delivery_charge: order.delivery_charge,
            total: order.total,
            note: `Online order ${order.order_number}${order.note ? ` — ${order.note}` : ""}`,
            items: {
                create: order.items.map((item) => ({
                    variant_id: item.variant_id,
                    product_name: item.product_name,
                    variant_name: item.variant_name,
                    unit_price: item.unit_price,
                    quantity: item.quantity,
                    discount_amount: new Decimal(0),
                    total: item.total,
                })),
            },
            payments: {
                create: {
                    method: PaymentMethod.CASH,
                    amount: order.total,
                    reference: order.order_number,
                },
            },
        },
        select: { id: true },
    });

    await tx.onlineOrder.update({
        where: { id: orderId },
        data: { status: "DELIVERED", delivered_at: new Date(), sale_id: sale.id },
    });
}
