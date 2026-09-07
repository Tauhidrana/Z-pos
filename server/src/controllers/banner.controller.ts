/**
 * Storefront hero banners, managed from the zPOS dashboard.
 *
 * Every handler here runs inside the authenticated `/api/*` subtree and takes
 * its tenant from the session, never from the caller: a banner is reached by
 * `{ id, store: { shop_id } }`, so quoting another merchant's banner id
 * matches nothing rather than editing their shop front.
 */

import type { Context } from "hono";
import prisma from "@/lib/prisma";
import { sendError, sendSuccess } from "@/utils/response";
import { resolveImageRefs } from "@/controllers/media.controller";
import { MAX_STORE_BANNERS } from "@myapp/shared/schemas/store.schema";
import type {
    CreateBanner,
    ReorderBanners,
    UpdateBanner,
} from "@myapp/shared/schemas/store.schema";

const BANNER_SELECT = {
    id: true,
    image_url: true,
    title: true,
    subtitle: true,
    button_text: true,
    button_link: true,
    position: true,
    is_active: true,
} as const;

/** The caller's own store, or null. Every handler starts here. */
async function ownStore(shopId: string) {
    return prisma.store.findUnique({
        where: { shop_id: shopId },
        select: { id: true },
    });
}

export const BannerController = {
    async list(c: Context) {
        const shopId = c.get("shopId") as string;
        const store = await ownStore(shopId);
        if (!store) return sendError(c, "No store yet", "STORE_NOT_FOUND", 404);

        const banners = await prisma.storeBanner.findMany({
            where: { store_id: store.id },
            select: BANNER_SELECT,
            orderBy: [{ position: "asc" }, { created_at: "asc" }],
        });

        return sendSuccess(c, banners, "Banners fetched successfully");
    },

    async create(c: Context) {
        const shopId = c.get("shopId") as string;
        const body = c.get("validatedBody") as CreateBanner;

        const store = await ownStore(shopId);
        if (!store) return sendError(c, "No store yet", "STORE_NOT_FOUND", 404);

        const resolved = await resolveImageRefs([body.image_url], shopId);
        if (!resolved.ok) return sendError(c, resolved.error, "INVALID_INPUT", 422);

        const count = await prisma.storeBanner.count({ where: { store_id: store.id } });
        if (count >= MAX_STORE_BANNERS) {
            return sendError(
                c,
                `A storefront can show up to ${MAX_STORE_BANNERS} banners. Remove one first.`,
                "BANNER_LIMIT",
                422,
            );
        }

        // Appended, not prepended: a merchant adding a slide expects it at the
        // end of the carousel, not in front of the one they just arranged.
        const last = await prisma.storeBanner.findFirst({
            where: { store_id: store.id },
            select: { position: true },
            orderBy: { position: "desc" },
        });

        const banner = await prisma.storeBanner.create({
            data: {
                store_id: store.id,
                image_url: body.image_url,
                title: body.title ?? null,
                subtitle: body.subtitle ?? null,
                button_text: body.button_text ?? null,
                button_link: body.button_link ?? null,
                is_active: body.is_active ?? true,
                position: (last?.position ?? -1) + 1,
            },
            select: BANNER_SELECT,
        });

        return sendSuccess(c, banner, "Banner added", 201);
    },

    async update(c: Context) {
        const shopId = c.get("shopId") as string;
        const body = c.get("validatedBody") as UpdateBanner;

        if (body.image_url) {
            const resolved = await resolveImageRefs([body.image_url], shopId);
            if (!resolved.ok) return sendError(c, resolved.error, "INVALID_INPUT", 422);
        }

        // updateMany rather than update: it takes a filter, so the ownership
        // check and the write are one statement and a banner belonging to
        // another shop simply matches nothing.
        const result = await prisma.storeBanner.updateMany({
            where: { id: body.id, store: { shop_id: shopId } },
            data: {
                ...(body.image_url !== undefined && { image_url: body.image_url }),
                ...(body.title !== undefined && { title: body.title }),
                ...(body.subtitle !== undefined && { subtitle: body.subtitle }),
                ...(body.button_text !== undefined && { button_text: body.button_text }),
                ...(body.button_link !== undefined && { button_link: body.button_link }),
                ...(body.is_active !== undefined && { is_active: body.is_active }),
            },
        });

        if (result.count === 0) {
            return sendError(c, "Banner not found", "NOT_FOUND", 404);
        }

        return sendSuccess(c, {}, "Banner updated");
    },

    async remove(c: Context) {
        const shopId = c.get("shopId") as string;
        const id = c.req.param("id") ?? "";
        if (!id) return sendError(c, "Banner not found", "NOT_FOUND", 404);

        const result = await prisma.storeBanner.deleteMany({
            where: { id, store: { shop_id: shopId } },
        });

        if (result.count === 0) {
            return sendError(c, "Banner not found", "NOT_FOUND", 404);
        }

        // The image itself is deliberately left in the media library. A merchant
        // who removes a slide to re-add it a minute later, or who used the same
        // artwork somewhere else, would otherwise be looking at a broken image.
        return sendSuccess(c, {}, "Banner removed");
    },

    /**
     * Reorder by sending the whole list of ids in their new order.
     *
     * A whole list rather than a "move this one to index N" call because the
     * client already knows the arrangement it wants, and applying one relative
     * move at a time makes a drag that crosses several positions into several
     * round-trips that can interleave and land out of order.
     *
     * Written in one transaction so a failure halfway cannot leave two banners
     * claiming the same slot.
     */
    async reorder(c: Context) {
        const shopId = c.get("shopId") as string;
        const { ids } = c.get("validatedBody") as ReorderBanners;

        const store = await ownStore(shopId);
        if (!store) return sendError(c, "No store yet", "STORE_NOT_FOUND", 404);

        const owned = await prisma.storeBanner.findMany({
            where: { store_id: store.id },
            select: { id: true },
        });
        const ownedIds = new Set(owned.map((b) => b.id));

        // Every id must be one of this store's, and all of them must be present:
        // a partial list would leave the omitted banners with stale positions
        // that collide with the new ones.
        if (ids.length !== ownedIds.size || !ids.every((id) => ownedIds.has(id))) {
            return sendError(
                c,
                "That ordering does not match your banners. Reload and try again.",
                "INVALID_INPUT",
                422,
            );
        }

        await prisma.$transaction(
            ids.map((id, index) =>
                prisma.storeBanner.update({
                    where: { id },
                    data: { position: index },
                }),
            ),
        );

        return sendSuccess(c, {}, "Banners reordered");
    },
};
