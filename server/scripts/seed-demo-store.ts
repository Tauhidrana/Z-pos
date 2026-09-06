/**
 * Creates (or refreshes) a demo storefront on the existing "Demo Shop" seed so
 * the storefront can be opened in a browser. Idempotent — safe to re-run.
 */
import prisma from "./src/lib/prisma";

const SLUG = process.argv[2] ?? "tds";

async function main() {
    const shop = await prisma.shop.findFirst({ orderBy: { created_at: "asc" } });
    if (!shop) throw new Error("No shop found — run `bunx prisma db seed` first.");

    const store = await prisma.store.upsert({
        where: { shop_id: shop.id },
        update: { slug: SLUG, is_active: true },
        create: {
            shop_id: shop.id,
            slug: SLUG,
            name: "TDS Fashion",
            description: "Everyday wear for everyday people. Cash on delivery nationwide.",
            phone: "01711000001",
            email: "hello@tds.example.com",
            address: "Level 3, Bashundhara City, Dhaka",
            delivery_charge: 60,
            free_delivery_over: 2000,
            theme_color: "#a8431d",
        },
    });

    // Make sure something is actually sellable: a price and a photo.
    const variants = await prisma.productVariant.findMany({
        where: { product: { shop_id: shop.id }, last_sell_price: null },
        select: { id: true },
        take: 40,
    });
    if (variants.length) {
        await prisma.productVariant.updateMany({
            where: { id: { in: variants.map((v) => v.id) } },
            data: { last_sell_price: 850 },
        });
    }

    const featured = await prisma.product.findMany({
        where: { shop_id: shop.id, is_active: true },
        select: { id: true, name: true, slug: true, _count: { select: { images: true } } },
        take: 8,
    });
    for (const [index, product] of featured.entries()) {
        if (product._count.images === 0) {
            await prisma.productImage.create({
                data: {
                    product_id: product.id,
                    url: `https://picsum.photos/seed/${encodeURIComponent(product.id)}/800/1000`,
                    position: 0,
                },
            });
        }
        if (index < 4) {
            await prisma.product.update({
                where: { id: product.id },
                data: { is_featured: true },
            });
        }
    }

    const counts = await prisma.product.count({
        where: { shop_id: shop.id, is_active: true, online_visible: true },
    });
    console.log(`store "${store.slug}" ready on shop ${shop.name} — ${counts} products online`);
}

main().finally(() => prisma.$disconnect());
