import type { Context } from "hono";
import { sendError, sendSuccess } from "@/utils/response";
import prisma from "@/lib/prisma";
import type { CategoryFormValues, UpdateCategory } from "@myapp/shared/schemas/category.schema";
import { AppError } from "@/utils/AppError";

export const categoryController = {
    async createCategory(c: Context) {
        const { name, description, parent_id } = c.get("validatedBody") as CategoryFormValues;
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



        await prisma.category.create({
            data: {
                shop_id: shopId,
                name,
                description,
                slug: name.toLowerCase().replace(/\s+/g, "-"),
                parent_id: parent_id || null,
            }
        });
        return sendSuccess(c, {}, "Category created successfully", 201);
    },

    async getCategories(c: Context) {
        const categories = await prisma.category.findMany({
            where: {
                shop_id: c.get("shopId") as string,
                parent_id: null
            },
            select: {
                id: true,
                name: true,
                description: true,
                children: {
                    select: {
                        id: true,
                        name: true,
                        description: true,
                        children: {
                            select: {
                                id: true,
                                name: true,
                                description: true,
                            }
                        }
                    }
                }
            }
        });
        return sendSuccess(c, categories, "Categories fetched successfully", 200);
    },

    async updateCategory(c: Context) {
        const body = c.get("validatedBody") as UpdateCategory;
        const { id, name, description } = body;
        const shopId = c.get("shopId") as string;

        const category = await prisma.category.findFirst({
            where: { id, shop_id: shopId },
        });

        if (!category) {
            return sendError(c, "Category not found", "NOT_FOUND", 404);
        }

        await prisma.category.update({
            where: { id },
            data: {
                name,
                description,
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