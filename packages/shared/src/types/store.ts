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
    /** The legacy single cover image. Acts as the carousel's fallback slide. */
    bannerUrl: string | null;
    faviconUrl: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    facebookUrl: string | null;
    instagramUrl: string | null;
    whatsappNumber: string | null;
    /** Business location, when the merchant has placed a pin. */
    latitude: number | null;
    longitude: number | null;
    openingHours: string | null;
    /**
     * Overrides for the storefront's <title> and meta description. Null falls
     * back to the store name and description, so every shop still gets tags
     * about itself rather than a generic zPOS one.
     */
    metaTitle: string | null;
    metaDescription: string | null;
    deliveryCharge: number;
    freeDeliveryOver: number | null;
    minOrderAmount: number;
    themeColor: string;
};

/**
 * Long-form pages the merchant publishes. Split out of `StorePublic` because
 * the storefront only needs them on the policy pages themselves — shipping
 * twenty thousand characters of terms with every homepage request would be
 * absurd.
 */
export type StorePolicies = {
    deliveryInfo: string | null;
    returnPolicy: string | null;
    terms: string | null;
    privacyPolicy: string | null;
};

/** Which policy pages actually have content, so the footer can hide the rest. */
export type StorePolicyFlags = {
    hasDeliveryInfo: boolean;
    hasReturnPolicy: boolean;
    hasTerms: boolean;
    hasPrivacyPolicy: boolean;
};

/** One slide in the storefront hero carousel. */
export type StoreBannerPublic = {
    id: string;
    imageUrl: string;
    title: string | null;
    subtitle: string | null;
    buttonText: string | null;
    buttonLink: string | null;
};

/** A banner as the merchant edits it, including its hidden ones. */
export type MerchantBanner = {
    id: string;
    /** Stored reference, so the form can save it back unchanged. */
    imageUrl: string;
    title: string | null;
    subtitle: string | null;
    buttonText: string | null;
    buttonLink: string | null;
    position: number;
    isActive: boolean;
};

export type StoreCategory = {
    id: string;
    name: string;
    slug: string;
    productCount: number;
    /** Merchant-uploaded tile artwork; null falls back to a typographic tile. */
    imageUrl: string | null;
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
    /**
     * Active hero slides in display order. Empty is normal and means the
     * homepage falls back to `store.bannerUrl`, or to a typographic panel when
     * there is no artwork at all — a new shop must still look finished.
     */
    banners: StoreBannerPublic[];
    categories: StoreCategory[];
    featured: StoreProductCard[];
    latest: StoreProductCard[];
    onSale: StoreProductCard[];
    /** Which footer policy links to render. The text itself is fetched per page. */
    policies: StorePolicyFlags;
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

export type MerchantStore = StorePublic &
    StorePolicies & {
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
