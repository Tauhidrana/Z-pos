import { sendError, sendSuccess } from "@/utils/response";
import type { Context } from "hono";
import prisma from "@/lib/prisma";
import type { Decimal } from "generated/prisma/runtime/client";
import type { CategorySalesEntry, DashboardSalesHistory, DashboardStatTrend, DashboardStats, PaymentMethod, PaymentStatus, TopProductEntry, WeeklySalesEntry } from "@/types";

// ─── helpers ──────────────────────────────────────────────────────────────────

function pctChange(
  current: number,
  previous: number
): { type: "UP" | "DOWN"; percentage: number } {
  if (previous === 0) return { type: "UP", percentage: 0 };
  const pct = ((current - previous) / previous) * 100;
  return {
    type: pct >= 0 ? "UP" : "DOWN",
    percentage: Math.abs(Math.round(pct * 100) / 100),
  };
}

function toNumber(
  val: Decimal | bigint | string | number | null | undefined
): number {
  if (val == null) return 0;
  if (typeof val === "bigint") return Number(val);
  // Raw SQL aggregates come back as Decimal under the pg adapter, but the
  // concrete type depends on the driver, so accept the plain forms too rather
  // than throwing inside a dashboard request.
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const n = Number(val);
    return Number.isFinite(n) ? n : 0;
  }
  return val.toNumber();
}

function getDayBounds(daysAgo: number): { start: Date; end: Date } {
  const start = new Date();
  start.setDate(start.getDate() - daysAgo);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

// ─── raw row types ────────────────────────────────────────────────────────────

type DayStatsRow = {
  revenue: Decimal;
  sales: bigint;
  customers: bigint;
  aov: Decimal; // AVG() returns Decimal in Prisma raw
};

type TrendRow = {
  today_revenue: Decimal;
  today_sales: bigint;
  today_customers: bigint;
  today_aov: Decimal;
  yesterday_revenue: Decimal;
  yesterday_sales: bigint;
  yesterday_customers: bigint;
  yesterday_aov: Decimal;
};


function formatTrend(current: number, previous: number): string {
  if (previous === 0) return current > 0 ? "+100%" : "0%";
  const pct = ((current - previous) / previous) * 100;
  const rounded = Math.round(pct * 10) / 10; // 1dp
  return rounded >= 0 ? `+${rounded}%` : `${rounded}%`;
}


/**
 * Returns the SAT–FRI week bounds containing `now`.
 * Saturday = JS day 6, Friday = JS day 5.
 */
function getCurrentWeekBounds(): { weekStart: Date; weekEnd: Date } {
  const now = new Date();
  const jsDay = now.getDay(); // 0=Sun … 6=Sat

  // Days since last Saturday
  // Sat=6 → 0 days back, Sun=0 → 1 day back, Mon=1 → 2, … Fri=5 → 6
  const daysSinceSat = jsDay === 6 ? 0 : jsDay + 1;

  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - daysSinceSat);
  weekStart.setHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6); // +6 = Friday
  weekEnd.setHours(23, 59, 59, 999);

  return { weekStart, weekEnd };
}

function getTimelineBounds(
  timeline: string
): { start: Date; end: Date } | null {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  switch (timeline) {
    case "today":
      break;
    case "yesterday":
      start.setDate(start.getDate() - 1);
      end.setDate(end.getDate() - 1);
      end.setHours(23, 59, 59, 999);
      break;
    case "7d":
      start.setDate(start.getDate() - 6);
      break;
    case "30d":
      start.setDate(start.getDate() - 29);
      break;
    case "90d":
      start.setDate(start.getDate() - 89);
      break;
    case "this_month": {
      start.setDate(1);
      break;
    }
    case "this_year": {
      start.setMonth(0, 1);
      break;
    }
    default:
      return null; // caller handles the 400
  }

  return { start, end };
}

// ─── raw row types ─────────────────────────────────────────────────────────────

type CategorySalesRow = {
  category_name: string;
  category_revenue: Decimal;
};

type WeeklyRow = {
  sale_date: Date;       // Postgres DATE → JS Date
  revenue: Decimal;
  orders: bigint;
};


// ─── constants ────────────────────────────────────────────────────────────────

const WEEK_DAYS = ["SAT", "SUN", "MON", "TUE", "WED", "THU", "FRI"] as const;
const TOP_N = 4;

// Maps JS getDay() → WEEK_DAYS index (SAT=0 in our week)
// JS: 0=Sun,1=Mon,2=Tue,3=Wed,4=Thu,5=Fri,6=Sat
const JS_DAY_TO_WEEK_IDX: Record<number, number> = {
  6: 0, // SAT
  0: 1, // SUN
  1: 2, // MON
  2: 3, // TUE
  3: 4, // WED
  4: 5, // THU
  5: 6, // FRI
};


// ─── raw row types ────────────────────────────────────────────────────────────

type SaleHeaderRow = {
  sale_id: string;
  customer_id: string | null;
  customer_name: string | null;
  total: Decimal;
  sale_status: string;         // SaleStatus enum string
  created_at: Date;
  paid_amount: Decimal;        // SUM of all payments for this sale
  dominant_method: string;     // payment method with the highest amount
};

type SaleItemRow = {
  sale_id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: Decimal;
};

// ─── mappers ──────────────────────────────────────────────────────────────────

function derivePaymentStatus(
  saleStatus: string,
  total: number,
  paidAmount: number
): PaymentStatus {
  // VOID sales should never appear — filtered in query
  // FULLY_RETURNED — all money back, treat as refunded/paid (no "due")
  if (saleStatus === "RETURNED") return "PAID";
  if (paidAmount <= 0) return "DUE";
  if (paidAmount >= total) return "PAID";
  return "PARTIAL";
}

// ─── controller ───────────────────────────────────────────────────────────────

const PAGE_SIZE = 5;


// ─── raw row types ────────────────────────────────────────────────────────────

type TopProductRow = {
  product_name: string;
  sold: bigint;
  revenue: Decimal;
  prev_revenue: Decimal;
};

// ─── controller ───────────────────────────────────────────────────────────────

const TOP_PRODUCTS_LIMIT = 5;


// ─── controller ──────────────────────────────────────────────────────────────

// ─── loaders ─────────────────────────────────────────────────────────────────
//
// Each of these is the query behind one dashboard card, lifted out of its HTTP
// handler so it can be called two ways: on its own (the single-card endpoints
// below, still used by anything that refreshes one card) and together, inside
// `getDashboardOverview`.
//
// The dashboard renders six cards, and it used to fetch them with six separate
// HTTP requests. On a serverless deployment that is six invocations — six token
// verifications, six connection acquisitions, and up to six cold starts — for
// one screen, and the page could not settle until the slowest of six
// independent round-trips came back. `Promise.all` over these loaders does the
// same work in one request, against one warm connection pool, and the six
// queries still run concurrently in Postgres.

async function loadStats(shopId: string): Promise<DashboardStats> {
  const { start: todayStart, end: todayEnd } = getDayBounds(0);

  const rows = await prisma.$queryRaw<DayStatsRow[]>`
      WITH today_sales AS (
        SELECT
          COALESCE(SUM(total), 0)              AS revenue,
          COUNT(id)                            AS sales,
          COUNT(DISTINCT customer_id)          AS customers,
          COALESCE(AVG(total), 0)              AS aov
        FROM sales
        WHERE
          shop_id = ${shopId}
          AND status NOT IN ('VOID')
          AND created_at >= ${todayStart}
          AND created_at <= ${todayEnd}
      )
      SELECT * FROM today_sales
    `;

  const row = rows[0];

  return {
    totalRevenueToday: toNumber(row?.revenue),
    totalSalesToday: toNumber(row?.sales),
    totalCustomers: toNumber(row?.customers),
    averageOrderValue: toNumber(row?.aov),
  };
}

async function loadStatTrend(shopId: string): Promise<DashboardStatTrend> {
  const { start: todayStart, end: todayEnd } = getDayBounds(0);
  const { start: yestStart } = getDayBounds(1);

  const rows = await prisma.$queryRaw<TrendRow[]>`
      WITH base AS (
        SELECT
          id,
          total,
          customer_id,
          CASE
            WHEN created_at >= ${todayStart} AND created_at <= ${todayEnd}
              THEN 'today'
            ELSE 'yesterday'
          END AS day_bucket
        FROM sales
        WHERE
          shop_id = ${shopId}
          AND status NOT IN ('VOID')
          AND created_at >= ${yestStart}
          AND created_at <= ${todayEnd}
      )
      SELECT
        COALESCE(SUM(CASE WHEN day_bucket = 'today'     THEN total END), 0)  AS today_revenue,
        COALESCE(SUM(CASE WHEN day_bucket = 'yesterday' THEN total END), 0)  AS yesterday_revenue,

        COUNT(DISTINCT CASE WHEN day_bucket = 'today'     THEN id END)       AS today_sales,
        COUNT(DISTINCT CASE WHEN day_bucket = 'yesterday' THEN id END)       AS yesterday_sales,

        COUNT(DISTINCT CASE WHEN day_bucket = 'today'     THEN customer_id END) AS today_customers,
        COUNT(DISTINCT CASE WHEN day_bucket = 'yesterday' THEN customer_id END) AS yesterday_customers,

        COALESCE(AVG(CASE WHEN day_bucket = 'today'     THEN total END), 0)  AS today_aov,
        COALESCE(AVG(CASE WHEN day_bucket = 'yesterday' THEN total END), 0)  AS yesterday_aov
      FROM base
    `;

  const r = rows[0];

  return {
    date: todayStart.toISOString().split("T")[0] || "",
    revenue: pctChange(toNumber(r?.today_revenue), toNumber(r?.yesterday_revenue)),
    sales: pctChange(toNumber(r?.today_sales), toNumber(r?.yesterday_sales)),
    customers: pctChange(toNumber(r?.today_customers), toNumber(r?.yesterday_customers)),
    averageOrderValue: pctChange(toNumber(r?.today_aov), toNumber(r?.yesterday_aov)),
  };
}

async function loadCategoryGraph(
  shopId: string,
  bounds: { start: Date; end: Date },
): Promise<CategorySalesEntry[]> {
  const { start, end } = bounds;

  // CTE breakdown:
  //   1. category_roots — walk each category up to its top-level ancestor
  //   2. valid_sales    — filter out noise (VOID)
  //   3. category_rev   — sum revenue per root category
  //   4. ranked/pivoted — top-N vs "Other", collapsed in SQL so we ship little
  const rows = await prisma.$queryRaw<CategorySalesRow[]>`
  WITH RECURSIVE category_roots AS (
    SELECT
      id,
      name,
      parent_id,
      id   AS root_id,
      name AS root_name
    FROM categories
    WHERE parent_id IS NULL AND shop_id = ${shopId}

    UNION ALL

    SELECT
      c.id,
      c.name,
      c.parent_id,
      cr.root_id,
      cr.root_name
    FROM categories     c
    JOIN category_roots cr ON cr.id = c.parent_id
  ),
  valid_sales AS (
    SELECT
      si.total,
      cr.root_name AS category_name
    FROM   sale_items       si
    JOIN   sales            s   ON s.id  = si.sale_id
    JOIN   product_variants pv  ON pv.id = si.variant_id
    JOIN   products         p   ON p.id  = pv.product_id
    JOIN   category_roots   cr  ON cr.id = p.category_id
    WHERE  s.shop_id = ${shopId}
      AND  s.status NOT IN ('VOID')
      AND  s.created_at >= ${start}
      AND  s.created_at <= ${end}
  ),
  category_rev AS (
    SELECT
      category_name,
      SUM(total) AS revenue
    FROM valid_sales
    GROUP BY category_name
  ),
  ranked AS (
    SELECT
      category_name,
      revenue,
      ROW_NUMBER() OVER (ORDER BY revenue DESC) AS rn
    FROM category_rev
  ),
  pivoted AS (
    SELECT
      CASE WHEN rn <= ${TOP_N} THEN category_name ELSE 'Other' END AS category_name,
      revenue
    FROM ranked
  )
  SELECT
    category_name,
    SUM(revenue) AS category_revenue
  FROM pivoted
  GROUP BY category_name
  ORDER BY category_revenue DESC
`;

  if (rows.length === 0) return [];

  const grandTotal = rows.reduce((acc, r) => acc + toNumber(r.category_revenue), 0);

  // Guarantee "Other" is always last regardless of its revenue
  const sorted = [...rows].sort((a, b) => {
    if (a.category_name === "Other") return 1;
    if (b.category_name === "Other") return -1;
    return toNumber(b.category_revenue) - toNumber(a.category_revenue);
  });

  return sorted.map((r) => ({
    name: r.category_name,
    value:
      grandTotal > 0
        ? Math.round((toNumber(r.category_revenue) / grandTotal) * 10000) / 100
        : 0,
  }));
}

async function loadWeeklySales(shopId: string): Promise<WeeklySalesEntry[]> {
  const { weekStart, weekEnd } = getCurrentWeekBounds();

  const rows = await prisma.$queryRaw<WeeklyRow[]>`
  SELECT
    s.created_at::date          AS sale_date,
    COALESCE(SUM(s.total), 0)   AS revenue,
    COUNT(s.id)                 AS orders
  FROM sales s
  WHERE
    s.shop_id = ${shopId}
    AND s.status NOT IN ('VOID')
    AND s.created_at >= ${weekStart}
    AND s.created_at <= ${weekEnd}
  GROUP BY s.created_at::date
  ORDER BY sale_date ASC
`;

  // Build a lookup: "YYYY-MM-DD" → row.
  //
  // The key must be derived from local calendar parts, not toISOString().
  // The week bounds are local midnights, and toISOString() converts to UTC —
  // at UTC+6 that rolls every day back to the previous date, so no generated
  // key ever matched a row and the chart always rendered zeros.
  const dateKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;

  const rowMap = new Map<string, WeeklyRow>();
  for (const row of rows) {
    // Postgres DATE arrives as UTC midnight, so read it back in UTC.
    const d = new Date(row.sale_date);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(
      2,
      "0"
    )}-${String(d.getUTCDate()).padStart(2, "0")}`;
    rowMap.set(key, row);
  }

  // Generate all 7 days SAT→FRI, zero-fill missing days.
  const result: WeeklySalesEntry[] = [];

  for (let i = 0; i < WEEK_DAYS.length; i++) {
    const day = new Date(weekStart);
    day.setDate(weekStart.getDate() + i);

    const row = rowMap.get(dateKey(day));
    result.push({
      // JS_DAY_TO_WEEK_IDX maps getDay() directly; the previous "- 1" shifted
      // every label one day (Saturday's bar read "FRI", Sunday's was blank).
      day: WEEK_DAYS[JS_DAY_TO_WEEK_IDX[day.getDay()] as number] || "",
      sales: row ? toNumber(row.revenue) : 0,
      orders: row ? toNumber(row.orders) : 0,
    });
  }

  return result;
}

async function loadTopProducts(
  shopId: string,
  bounds: { start: Date; end: Date },
  limit: number,
): Promise<TopProductEntry[]> {
  const { start, end } = bounds;

  // Compute the "previous" window of equal length for trend comparison
  const windowMs = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 1); // 1ms before current window
  const prevStart = new Date(prevEnd.getTime() - windowMs);

  const rows = await prisma.$queryRaw<TopProductRow[]>`
      WITH current_window AS (
        SELECT
          p.id                        AS product_id,
          p.name                      AS product_name,
          SUM(si.quantity)            AS sold,
          SUM(si.total)               AS revenue
        FROM   sale_items       si
        JOIN   sales            s   ON s.id  = si.sale_id
        JOIN   product_variants pv  ON pv.id = si.variant_id
        JOIN   products         p   ON p.id  = pv.product_id
        WHERE  s.shop_id = ${shopId}
          AND  s.status NOT IN ('VOID')
          AND  s.created_at >= ${start}
          AND  s.created_at <= ${end}
        GROUP BY p.id, p.name
      ),
      previous_window AS (
        SELECT
          p.id          AS product_id,
          SUM(si.total) AS revenue
        FROM   sale_items       si
        JOIN   sales            s   ON s.id  = si.sale_id
        JOIN   product_variants pv  ON pv.id = si.variant_id
        JOIN   products         p   ON p.id  = pv.product_id
        WHERE  s.shop_id = ${shopId}
          AND  s.status NOT IN ('VOID')
          AND  s.created_at >= ${prevStart}
          AND  s.created_at <= ${prevEnd}
        GROUP BY p.id
      ),
      joined AS (
        SELECT
          cw.product_name,
          cw.sold,
          cw.revenue,
          COALESCE(pw.revenue, 0) AS prev_revenue
        FROM      current_window cw
        LEFT JOIN previous_window pw ON pw.product_id = cw.product_id
      ),
      ranked AS (
        SELECT
          product_name,
          sold,
          revenue,
          prev_revenue,
          ROW_NUMBER() OVER (ORDER BY revenue DESC) AS rn
        FROM joined
      )
      SELECT
        product_name,
        sold,
        revenue,
        prev_revenue
      FROM ranked
      WHERE rn <= ${limit}
      ORDER BY revenue DESC
    `;

  return rows.map((r) => ({
    name: r.product_name,
    sold: toNumber(r.sold),
    revenue: toNumber(r.revenue),
    trend: formatTrend(toNumber(r.revenue), toNumber(r.prev_revenue)),
  }));
}

async function loadSalesHistory(
  shopId: string,
  bounds: { start: Date; end: Date },
  page: number,
  limit: number,
  statusFilter?: PaymentStatus,
): Promise<DashboardSalesHistory[]> {
  const { start, end } = bounds;
  const offset = (page - 1) * limit;

  // ── Step 1: fetch sale headers with payment aggregates ────────────────────
  // The page of sales is selected FIRST, and the payment aggregate is computed
  // only for those rows.
  //
  // It used to be the other way round: `payment_agg` ran two window functions
  // over the whole `payments` table — every shop, every sale that has ever been
  // paid for — and only then was the result joined to five sales and thrown
  // away. That is a full table scan plus two sorts per dashboard load, growing
  // with total payment volume rather than with what is on screen, and it was
  // the slowest query in the app.
  //
  // Ordering `window_sales` by created_at DESC with a LIMIT lets Postgres walk
  // the `sales(shop_id, created_at)` index and stop, and the join then touches
  // at most `limit` sales' worth of `payments` through `payments(sale_id)`.
  //
  // Dominant method = method whose SUM(amount) is highest for that sale.
  // DISTINCT ON (sale_id) after that ORDER BY gives us exactly that.
  const headers = await prisma.$queryRaw<SaleHeaderRow[]>`
      WITH window_sales AS (
        SELECT
          s.id,
          s.customer_id,
          s.total,
          s.status,
          s.created_at
        FROM sales s
        WHERE
          s.shop_id = ${shopId}
          AND s.status != 'VOID'
          AND s.created_at >= ${start}
          AND s.created_at <= ${end}
        ORDER BY s.created_at DESC
        LIMIT  ${limit}
        OFFSET ${offset}
      ),
      payment_agg AS (
        SELECT DISTINCT ON (p.sale_id)
          p.sale_id,
          SUM(p.amount) OVER (PARTITION BY p.sale_id)     AS paid_amount,
          p.method                                        AS dominant_method
        FROM payments p
        JOIN window_sales ws ON ws.id = p.sale_id
        ORDER BY p.sale_id, SUM(p.amount) OVER (PARTITION BY p.sale_id, p.method) DESC
      )
      SELECT
        ws.id                                     AS sale_id,
        ws.customer_id                            AS customer_id,
        COALESCE(c.name, '')                      AS customer_name,
        ws.total                                  AS total,
        ws.status                                 AS sale_status,
        ws.created_at                             AS created_at,
        COALESCE(pa.paid_amount, 0)               AS paid_amount,
        pa.dominant_method                        AS dominant_method
      FROM      window_sales ws
      LEFT JOIN customers    c  ON c.id = ws.customer_id
      LEFT JOIN payment_agg  pa ON pa.sale_id = ws.id
      ORDER BY ws.created_at DESC
    `;

  if (headers.length === 0) return [];

  // ── Step 2: derive payment status, then apply the caller's filter ─────────
  // Derived from (sale_status, total, paid_amount) — it cannot be filtered in
  // SQL without duplicating that logic there too. For large datasets with heavy
  // status filtering, move this into a generated column instead.
  const headersWithStatus = headers.map((h) => ({
    ...h,
    derivedStatus: derivePaymentStatus(
      h.sale_status,
      toNumber(h.total),
      toNumber(h.paid_amount)
    ),
  }));

  const filtered = statusFilter
    ? headersWithStatus.filter((h) => h.derivedStatus === statusFilter)
    : headersWithStatus;

  if (filtered.length === 0) return [];

  // ── Step 3: fetch items only for the sales we're returning ───────────────
  const saleIds = filtered.map((h) => h.sale_id);

  const items = await prisma.saleItem.findMany({
    where: { sale_id: { in: saleIds } },
    select: {
      sale_id: true,
      quantity: true,
      unit_price: true,
      variant: {
        select: {
          product: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  });

  // ── Step 4: group items by sale_id ───────────────────────────────────────
  const itemsBySaleId = new Map<
    string,
    { productId: string; name: string; qty: number; price: number }[]
  >();

  for (const item of items) {
    const existing = itemsBySaleId.get(item.sale_id) ?? [];
    existing.push({
      productId: item.variant.product.id,
      name: item.variant.product.name,
      qty: item.quantity,
      price: toNumber(item.unit_price),
    });
    itemsBySaleId.set(item.sale_id, existing);
  }

  // ── Step 5: assemble ─────────────────────────────────────────────────────
  return filtered.map((h) => ({
    id: h.sale_id,
    customerId: h.customer_id ?? "",
    customerName: h.customer_name ?? "",
    items: itemsBySaleId.get(h.sale_id) ?? [],
    total: toNumber(h.total),
    status: h.derivedStatus,
    date: h.created_at.toISOString(),
    paymentMethod: h.dominant_method as PaymentMethod,
  }));
}

/** Shared 400 for the `timeline` query parameter. */
function invalidTimeline(c: Context, timeline: string) {
  return sendError(
    c,
    `Invalid timeline '${timeline}'. Use: today | yesterday | 7d | 30d | 90d | this_month | this_year`,
    "INVALID_TIMELINE",
    400
  );
}

/** Clamp a `limit` query parameter to [1, max], falling back to `fallback`. */
function clampLimit(raw: string | undefined, fallback: number, max: number): number {
  const parsed = parseInt(raw ?? String(fallback));
  return isNaN(parsed) || parsed < 1 || parsed > max ? fallback : parsed;
}

// ─── controller ──────────────────────────────────────────────────────────────

export const DashboardController = {
  /**
   * GET /dashboard/get/overview?timeline=7d
   *
   * Every card on the dashboard, in one response. The six single-card
   * endpoints below still exist and still work — this is the one the dashboard
   * itself calls, so opening it costs one round-trip instead of six.
   */
  async getDashboardOverview(c: Context) {
    const shopId = c.get("shopId") as string;
    const timeline = c.req.query("timeline") ?? "7d";
    const bounds = getTimelineBounds(timeline);

    if (!bounds) return invalidTimeline(c, timeline);

    const [stats, statTrend, categoryGraph, weeklySales, topProducts, salesHistory] =
      await Promise.all([
        loadStats(shopId),
        loadStatTrend(shopId),
        loadCategoryGraph(shopId, bounds),
        loadWeeklySales(shopId),
        loadTopProducts(shopId, bounds, TOP_PRODUCTS_LIMIT),
        loadSalesHistory(shopId, bounds, 1, PAGE_SIZE),
      ]);

    return sendSuccess(
      c,
      { stats, statTrend, categoryGraph, weeklySales, topProducts, salesHistory },
      "Dashboard overview fetched successfully",
      200
    );
  },

  async getDashboardStats(c: Context) {
    const stats = await loadStats(c.get("shopId") as string);
    return sendSuccess(c, stats, "Dashboard stats fetched successfully", 200);
  },

  async getDashboardStatTrend(c: Context) {
    const trend = await loadStatTrend(c.get("shopId") as string);
    return sendSuccess(c, trend, "Dashboard stat trend fetched successfully", 200);
  },

  async getDashboardCategoryGraph(c: Context) {
    const timeline = c.req.query("timeline") ?? "7d";
    const bounds = getTimelineBounds(timeline);
    if (!bounds) return invalidTimeline(c, timeline);

    const result = await loadCategoryGraph(c.get("shopId") as string, bounds);
    if (result.length === 0) {
      return sendSuccess(c, [], "No sales data for this period", 200);
    }

    return sendSuccess(c, result, "Category graph data fetched successfully", 200);
  },

  /**
   * GET /dashboard/get/weekly-sales-graph
   *
   * Always returns the current SAT–FRI week.
   * Days with no sales are zero-filled — frontend always gets 7 entries.
   */
  async getDashboardWeeklySalesGraph(c: Context) {
    const result = await loadWeeklySales(c.get("shopId") as string);
    return sendSuccess(c, result, "Weekly sales graph data fetched successfully", 200);
  },

  /**
   * GET /dashboard/top-products?timeline=7d&limit=5
   *
   * Accepted timeline: today | yesterday | 7d | 30d | 90d | this_month | this_year
   * Accepted limit:    1–20  (default 5)
   *
   * Trend = revenue change vs the equivalent-length period immediately before
   * the selected window. e.g. for "7d", trend compares this week vs last week.
   */
  async getDashboardTopProducts(c: Context) {
    const timeline = c.req.query("timeline") ?? "7d";
    const bounds = getTimelineBounds(timeline);
    if (!bounds) return invalidTimeline(c, timeline);

    const limit = clampLimit(c.req.query("limit"), TOP_PRODUCTS_LIMIT, 20);
    const result = await loadTopProducts(c.get("shopId") as string, bounds, limit);

    return sendSuccess(c, result, "Top products fetched successfully", 200);
  },

  /**
   * GET /dashboard/sales-history
   *   ?timeline=7d          (default: 7d)
   *   ?page=1               (default: 1, 1-indexed)
   *   ?limit=20             (default: 20, max: 100)
   *   ?status=paid|due|partial   (optional filter)
   *
   * Returns paginated sales with items, derived payment status, and
   * dominant payment method. VOID sales are always excluded.
   */
  async getDashboardSalesHistory(c: Context) {
    const timeline = c.req.query("timeline") ?? "7d";
    const bounds = getTimelineBounds(timeline);
    if (!bounds) return invalidTimeline(c, timeline);

    const pageParam = parseInt(c.req.query("page") ?? "1");
    const page = isNaN(pageParam) || pageParam < 1 ? 1 : pageParam;
    const limit = clampLimit(c.req.query("limit"), PAGE_SIZE, 100);
    const statusFilter = c.req.query("status") as PaymentStatus | undefined;

    const data = await loadSalesHistory(
      c.get("shopId") as string,
      bounds,
      page,
      limit,
      statusFilter,
    );

    return sendSuccess(
      c,
      data.length === 0 ? { data: [], page, limit, total: 0 } : { data, page, limit },
      "Sales history fetched successfully",
      200
    );
  },
};
