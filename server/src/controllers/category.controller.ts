import type { Context } from "hono";
import { sendError, sendSuccess } from "@/utils/response";
import prisma from "@/lib/prisma";
import type { CategoryFormValues, UpdateCategory } from "@myapp/shared/schemas/category.schema";
import { categorySlug } from "@myapp/shared/schemas/category.schema";
import { AppError } from "@/utils/AppError";
import { resolveImageRefs } from "@/controllers/media.controller";

/**
 * A URL segment for a category, unique within the shop.
 *
 * `categorySlug` returns "" for a name with no Latin characters — "পোশাক", say,
 * which is an entirely ordinary category name here. Falling back to a
 * discriminator keeps those routable and, more importantly, keeps them from all
 * colliding on the shop's unique (shop_id, slug) index, which is what an empty
 * slug used to guarantee the moment a merchant added a second Bengali category.
 *
 * The suffix loop covers the ordinary collision too ("Shoes" twice under
 * different parents), so a merchant never sees a unique-constraint error for
 * something they cannot act on.
 */
async function uniqueCategorySlug(
    shopId: string,
    name: string,
    excludeId?: string,
): Promise<string> {
    const base = categorySlug(name) || "category";

    for (let attempt = 0; attempt < 50; attempt++) {
        const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
        const clash = await prisma.category.findFirst({
            where: {
                shop_id: shopId,
                slug: candidate,
                ...(excludeId ? { id: { not: excludeId } } : {}),
            },
            select: { id: true },
        });
        if (!clash) return candidate;
    }

    // Astronomically unlikely; a random tail is still better than a 500.
    return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

export const categoryController = {
    async createCategory(c: Context) {
        const { name, description, parent_id, image_url, position } =
            c.get("validatedBody") as CategoryFormValues;
        const shopId = c.get("shopId") as string;

        // Scoped to the shop: another shop owning this name must not block it.
        const existingCategory = await prisma.category.findFirst({
            where: {
                shop_id: shopId,
                name: {
                    equals: name,
                    mode: "insensitive",
                },
            },
        });

        if (existingCategory) {
            return sendError(c, "Category already exists", "INVALID_INPUT", 400);
        }

        if (parent_id) {
            // findFirst, not findUnique: the id alone would happily resolve a
            // parent belonging to another shop and graft this category onto it.
            const parentCategory = await prisma.category.findFirst({
                where: { id: parent_id, shop_id: shopId },
            });

            if (!parentCategory) {
                return sendError(c, "Parent category not found", "INVALID_INPUT", 400);
            }
        }



        // The artwork has to belong to this shop, or a merchant could point at
        // someone else's uploaded image by quoting its reference.
        if (image_url) {
            const resolved = await resolveImageRefs([image_url], shopId);
            if (!resolved.ok) {
                return sendError(c, resolved.error, "INVALID_INPUT", 422);
            }
        }

        await prisma.category.create({
            data: {
                shop_id: shopId,
                name,
                description: description ?? null,
                image_url: image_url ?? null,
                position: position ?? 0,
                slug: await uniqueCategorySlug(shopId, name),
                parent_id: parent_id || null,
            }
        });
        return sendSuccess(c, {}, "Category created successfully", 201);
    },

    async getCategories(c: Context) {
        // `position` then `name`: an untouched catalogue stays alphabetical
        // (every row defaults to 0), and reordering one category does not
        // scramble the rest.
        const NODE = {
            id: true,
            name: true,
            description: true,
            slug: true,
            image_url: true,
            position: true,
            is_active: true,
        } as const;
        const ORDER = [{ position: "asc" }, { name: "asc" }] as const;

        const categories = await prisma.category.findMany({
            where: {
                shop_id: c.get("shopId") as string,
                parent_id: null
            },
            select: {
                ...NODE,
                children: {
                    select: {
                        ...NODE,
                        children: { select: NODE, orderBy: [...ORDER] },
                    },
                    orderBy: [...ORDER],
                }
            },
            orderBy: [...ORDER],
        });
        return sendSuccess(c, categories, "Categories fetched successfully", 200);
    },

    async updateCategory(c: Context) {
        const body = c.get("validatedBody") as UpdateCategory;
        const { id, name, description, image_url, position, is_active } = body;
        const shopId = c.get("shopId") as string;

        const category = await prisma.category.findFirst({
            where: { id, shop_id: shopId },
            select: { id: true, name: true },
        });

        if (!category) {
            return sendError(c, "Category not found", "NOT_FOUND", 404);
        }

        if (image_url) {
            const resolved = await resolveImageRefs([image_url], shopId);
            if (!resolved.ok) {
                return sendError(c, resolved.error, "INVALID_INPUT", 422);
            }
        }

        // Re-slug only on an actual rename. Doing it on every save would change
        // a live storefront URL because the merchant edited the description,
        // silently breaking any link a customer had already shared.
        const renamed = name !== undefined && name !== category.name;

        await prisma.category.update({
            where: { id },
            data: {
                ...(name !== undefined && { name }),
                ...(renamed && { slug: await uniqueCategorySlug(shopId, name, id) }),
                ...(description !== undefined && { description }),
                ...(image_url !== undefined && { image_url }),
                ...(position !== undefined && { position }),
                ...(is_active !== undefined && { is_active }),
            }
        });
        return sendSuccess(c, {}, "Category updated successfully", 200);
    },

    async deleteCategory(c: Context) {
        const { id } = await c.req.json();
        if (!id || typeof id !== "string" || id.trim() === "") {
            return sendError(c, "Invalid ID", "BAD_REQUEST", 400);
        }

        const category = await prisma.category.findFirst({
            where: { id, shop_id: c.get("shopId") as string },
            include: {
                children: true,
            }
        });

        if (!category) {
            return sendError(c, "Category not found", "NOT_FOUND", 404);
        }

        const childrenIds = category.children.map((child) => child.id);

        await prisma.$transaction(async (tx) => {

            const hasProductsLinked = await tx.product.findMany({
                where: {
                    category_id: {
                        in: [id, ...childrenIds],
                    },
                },
            });

            if (hasProductsLinked.length > 0) {
                throw new AppError("Category has products linked", "INVALID_INPUT", 400);
            }

            if (childrenIds.length > 0) {
                await tx.category.deleteMany({
                    where: { id: { in: childrenIds } },
                });
            }
            await tx.category.delete({
                where: { id },
            });
        });

        return sendSuccess(c, {}, "Category deleted successfully", 200);
    },
};