/**
 * The wire contract between the storefront and the API.
 *
 * Two shapes on purpose. `Store*` types are what the *public* storefront sees
 * and carry nothing private — no shop id, no user, no cost price, no supplier.
 * `Merchant*` types are what the signed-in dashboard sees.
 */

import type { OnlineOrderStatus } from "../schemas/online-order.schema";

export type { OnlineOrderStatus };

// ── Public storefront ────────────────────────────────────────────────────────

export type StorePublic = {
    slug: string;
    name: string;
    description: string | null;
    logoUrl: string | null;
    bannerUrl: string | null;
    faviconUrl: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    facebookUrl: string | null;
    instagramUrl: string | null;
    whatsappNumber: string | null;
    deliveryCharge: number;
    freeDeliveryOver: number | null;
    minOrderAmount: number;
    themeColor: string;
};

export type StoreCategory = {
    id: string;
    name: string;
    slug: string;
    productCount: number;
};

/** One purchasable option of a product. */
export type StoreVariant = {
    id: string;
    name: string | null;
    color: string | null;
    size: string | null;
    /** What the customer pays. */
    price: number;
    /** Struck-through price — present only when the variant is on sale. */
    compareAtPrice: number | null;
    stock: number;
    inStock: boolean;
};

export type StoreProductCard = {
    id: string;
    slug: string;
    name: string;
    brand: string | null;
    categoryName: string;
    categorySlug: string;
    imageUrl: string | null;
    price: number;
    compareAtPrice: number | null;
    discountPercent: number | null;
    inStock: boolean;
    totalStock: number;
    isFeatured: boolean;
    /** Added to the catalog in the last 30 days. */
    isNew: boolean;
};

export type StoreProductDetail = StoreProductCard & {
    description: string | null;
    images: { url: string; alt: string | null }[];
    variants: StoreVariant[];
    sku: string | null;
};

export type StoreHome = {
    store: StorePublic;
    categories: StoreCategory[];
    featured: StoreProductCard[];
    latest: StoreProductCard[];
    onSale: StoreProductCard[];
};

export type StoreProductList = {
    items: StoreProductCard[];
    total: number;
    page: number;
    totalPages: number;
};

export type StoreOrderConfirmation = {
    orderNumber: string;
    status: OnlineOrderStatus;
    placedAt: string;
    customerName: string;
    customerPhone: string;
    address: {
        division: string;
        district: string;
        upazila: string;
        area: string | null;
        addressLine: string;
    };
    items: {
        productName: string;
        variantName: string | null;
        imageUrl: string | null;
        unitPrice: number;
        quantity: number;
        total: number;
    }[];
    subtotal: number;
    deliveryCharge: number;
    total: number;
    paymentMethod: "COD";
    note: string | null;
};

// ── Merchant dashboard ───────────────────────────────────────────────────────

export type MerchantStore = StorePublic & {
    id: string;
    isActive: boolean;
    createdAt: string;
};

export type MerchantStoreProduct = {
    id: string;
    name: string;
    slug: string | null;
    categoryName: string;
    onlineVisible: boolean;
    isFeatured: boolean;
    isActive: boolean;
    imageCount: number;
    primaryImageUrl: string | null;
    /** Null when no purchase has ever set a shelf price and no override exists. */
    price: number | null;
    compareAtPrice: number | null;
    totalStock: number;
    variantCount: number;
};

export type MerchantStoreProductDetail = {
    id: string;
    name: string;
    slug: string | null;
    description: string | null;
    brand: string | null;
    categoryName: string;
    onlineVisible: boolean;
    isFeatured: boolean;
    isActive: boolean;
    images: { id: string; url: string; alt: string | null; position: number }[];
    variants: {
        id: string;
        name: string | null;
        isActive: boolean;
        stock: number;
        /** Sell price of the most recent purchase batch. */
        shelfPrice: number | null;
        onlinePrice: number | null;
        onlineSalePrice: number | null;
        effectivePrice: number | null;
    }[];
};

export type MerchantOrderRow = {
    id: string;
    orderNumber: string;
    status: OnlineOrderStatus;
    customerName: string;
    customerPhone: string;
    itemCount: number;
    total: number;
    placedAt: string;
};

export type MerchantOrderDetail = {
    id: string;
    orderNumber: string;
    status: OnlineOrderStatus;
    paymentMethod: "COD";
    customerName: string;
    customerPhone: string;
    customerEmail: string | null;
    address: {
        division: string;
        district: string;
        upazila: string;
        area: string | null;
        addressLine: string;
    };
    note: string | null;
    items: {
        id: string;
        productName: string;
        variantName: string | null;
        imageUrl: string | null;
        unitPrice: number;
        quantity: number;
        total: number;
    }[];
    subtotal: number;
    deliveryCharge: number;
    total: number;
    placedAt: string;
    deliveredAt: string | null;
    cancelledAt: string | null;
    stockRestored: boolean;
    /** Invoice of the Sale written when the order was delivered, if any. */
    invoiceNumber: string | null;
};

export type MerchantOrderStats = {
    pending: number;
    processing: number;
    delivered: number;
    cancelled: number;
    revenue: number;
    ordersToday: number;
};
