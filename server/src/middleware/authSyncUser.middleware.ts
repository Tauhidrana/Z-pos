import { createClerkClient } from "@clerk/backend";
import type { Context, Next } from "hono";
import type { AppEnv } from "@/types";
import prisma from "@/lib/prisma";
import { sendError } from "@/utils/response";
import { getCachedSession, setCachedSession } from "@/lib/session-cache";

/**
 * Addresses that are always admitted as an active OWNER, whatever the database
 * currently says about them.
 *
 * Sign-up is self-serve (see `provisionOwner`), so this list is no longer what
 * grants access — it is what guarantees the operator's own accounts keep it. A
 * row that was deactivated, or demoted to STAFF by another OWNER, is corrected
 * on the next cache miss instead of locking the operator out of their own
 * system with no way back in short of direct SQL.
 *
 * The environment variable keeps its old name so existing deployments that set
 * it carry over unchanged.
 */
const ADMIN_EMAILS = new Set(
    [
        "sabbirahmed565r@gmail.com",
        ...(process.env.BOOTSTRAP_OWNER_EMAILS ?? "").split(","),
    ]
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
);

/**
 * Built on first use, not at import. The Clerk API is only consulted on a cold
 * sign-in — every other request resolves from the cache or `clerk_id` — so a
 * serverless cold start no longer pays to construct a client it will not call.
 */
let clerkClient: ReturnType<typeof createClerkClient> | null = null;

function clerk() {
    clerkClient ??= createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });
    return clerkClient;
}

/**
 * How often a linked user's Clerk profile (name) is refreshed. This used to
 * happen on every request, which meant a Clerk API round-trip plus a DB write
 * per request. A name change is not time-critical, so it now runs at most once
 * per interval, in the background, off the request's critical path.
 */
const PROFILE_SYNC_INTERVAL_MS = Number(
    process.env.PROFILE_SYNC_INTERVAL_MS ?? 12 * 60 * 60 * 1000,
);

/** internal userId -> timestamp of last background profile refresh */
const lastProfileSync = new Map<string, number>();

/** The fields every code path below needs to reach an authorization decision. */
const SESSION_SELECT = {
    id: true,
    role: true,
    is_active: true,
    shop_id: true,
    email: true,
} as const;

type SessionUser = {
    id: string;
    role: "OWNER" | "STAFF";
    is_active: boolean;
    shop_id: string | null;
    email: string;
};

function clerkDisplayName(user: {
    firstName: string | null;
    lastName: string | null;
}): string | undefined {
    return [user.firstName, user.lastName].filter(Boolean).join(" ") || undefined;
}

/**
 * Refresh the cached Clerk profile without blocking the response. Failures are
 * logged and swallowed — a stale display name must never break a request.
 */
function refreshProfileInBackground(userId: string, clerkUserId: string): void {
    const last = lastProfileSync.get(userId) ?? 0;
    if (Date.now() - last < PROFILE_SYNC_INTERVAL_MS) return;

    // Mark it up-front so concurrent requests don't all kick off a refresh.
    lastProfileSync.set(userId, Date.now());

    void (async () => {
        try {
            const clerkUser = await clerk().users.getUser(clerkUserId);
            const name = clerkDisplayName(clerkUser);
            if (!name) return;
            await prisma.user.update({
                where: { id: userId },
                data: { name },
            });
        } catch (err) {
            console.error("[syncUser] background profile refresh failed:", err);
        }
    })();
}

/**
 * Give a Clerk account that nobody invited its own shop, as an OWNER.
 *
 * Access used to be invite-only: a Clerk account with no matching `users` row
 * was rejected outright, and the only way to create that row was the admin UI,
 * which itself required an account that already had access. Anyone who signed
 * up — including the operator on a fresh database — hit "Access denied" on
 * every call and could not so much as create a category.
 *
 * Signing up now provisions the account instead. The shop is new and empty, so
 * a self-serve owner gets the full app over their own catalog and never sees
 * another shop's books; the invite flow is untouched, because an invited email
 * already has a row and is matched below before this ever runs.
 */
async function provisionOwner(
    email: string,
    clerkUserId: string,
    name: string | undefined,
): Promise<SessionUser> {
    try {
        const created = await prisma.user.create({
            data: {
                email,
                clerk_id: clerkUserId,
                name,
                role: "OWNER",
                status: "ACCEPTED",
                is_active: true,
                // A self-serve owner is a new business, so it gets its own
                // empty shop — never someone else's books.
                shop: { create: { name: "My Shop" } },
            },
            select: SESSION_SELECT,
        });
        console.warn(`[syncUser] provisioned new OWNER ${email} with a fresh shop`);
        return created;
    } catch (err) {
        // The first page load fires several API calls at once, and on a brand
        // new account every one of them misses the cache and races to create
        // the same row. Whichever loses on the unique email/clerk_id adopts the
        // row the winner just wrote rather than failing the request.
        if ((err as { code?: string }).code === "P2002") {
            const existing = await prisma.user.findFirst({
                where: { OR: [{ clerk_id: clerkUserId }, { email }] },
                select: SESSION_SELECT,
            });
            if (existing) return existing;
        }
        throw err;
    }
}

export async function syncUser(c: Context<AppEnv>, next: Next) {
    const clerkUserId = c.get("clerkUserId");

    try {
        // ── 1. Hot path: fully cached identity + authorization decision ──────
        const cached = getCachedSession(clerkUserId);
        if (cached) {
            c.set("userId", cached.userId);
            c.set("userRole", cached.role);
            c.set("shopId", cached.shopId);
            return next();
        }

        // ── 2. Warm path: already linked, so one indexed lookup is enough.
        //       No Clerk API call — clerk_id is the join key. ────────────────
        let user: SessionUser | null = await prisma.user.findUnique({
            where: { clerk_id: clerkUserId },
            select: SESSION_SELECT,
        });

        // ── 3. Cold path: first sign-in for this Clerk account. We only need
        //       Clerk here, to resolve the email the account signed up with.
        if (!user) {
            const clerkUser = await clerk().users.getUser(clerkUserId);
            const email = clerkUser.emailAddresses[0]?.emailAddress;

            if (!email) {
                return sendError(
                    c,
                    "No email associated with this account",
                    "UNAUTHORIZED",
                    401,
                );
            }

            // Clerk normalizes addresses to lower case, but an invite typed
            // into the admin form can carry capitals. The exact match runs
            // first so the common case stays on the unique index; the
            // insensitive pass only costs a query when that misses.
            const invited =
                (await prisma.user.findUnique({
                    where: { email },
                    select: { ...SESSION_SELECT, status: true },
                })) ??
                (await prisma.user.findFirst({
                    where: { email: { equals: email, mode: "insensitive" } },
                    select: { ...SESSION_SELECT, status: true },
                }));

            if (!invited) {
                // Nobody invited this address — sign them up with their own shop.
                user = await provisionOwner(
                    email,
                    clerkUserId,
                    clerkDisplayName(clerkUser),
                );
                lastProfileSync.set(user.id, Date.now());
            } else {
                // Link the Clerk account to the invited row so every later
                // request takes the warm path above.
                await prisma.user.update({
                    where: { id: invited.id },
                    data: {
                        clerk_id: clerkUserId,
                        status: invited.status === "PENDING" ? "ACCEPTED" : invited.status,
                        name: clerkDisplayName(clerkUser),
                    },
                });

                lastProfileSync.set(invited.id, Date.now());
                user = {
                    id: invited.id,
                    role: invited.role,
                    is_active: invited.is_active,
                    shop_id: invited.shop_id,
                    email: invited.email,
                };
            }
        } else {
            refreshProfileInBackground(user.id, clerkUserId);
        }

        // Re-assert the operator's own accounts on every cache miss, so a
        // deactivation or demotion can never lock them out of the admin area.
        if (
            ADMIN_EMAILS.has(user.email.toLowerCase()) &&
            (!user.is_active || user.role !== "OWNER")
        ) {
            user = await prisma.user.update({
                where: { id: user.id },
                data: { role: "OWNER", is_active: true },
                select: SESSION_SELECT,
            });
        }

        // In DB but deactivated = blocked. Checked before caching so a
        // deactivated user is never admitted from cache.
        if (!user.is_active) {
            return sendError(
                c,
                "Your account has been deactivated. Contact your administrator.",
                "FORBIDDEN",
                403,
            );
        }

        // An OWNER with no shop predates tenancy (or had theirs deleted); give
        // them their own rather than leaving them unable to use the app. STAFF
        // are never auto-provisioned a shop — they belong to the one that
        // invited them, and inventing a second empty shop would silently hide
        // the catalog they are meant to be selling from.
        let shopId = user.shop_id;
        if (!shopId) {
            if (user.role !== "OWNER") {
                return sendError(
                    c,
                    "Your account is not attached to a shop. Ask the shop owner to re-send your invite.",
                    "FORBIDDEN",
                    403,
                );
            }
            const shop = await prisma.shop.create({
                data: { name: "My Shop", users: { connect: { id: user.id } } },
                select: { id: true },
            });
            shopId = shop.id;
        }

        setCachedSession(clerkUserId, { userId: user.id, role: user.role, shopId });

        c.set("userId", user.id);
        c.set("userRole", user.role);
        c.set("shopId", shopId);

        await next();
    } catch (err) {
        console.error("[syncUser]", err);
        return sendError(c, "Authentication failed", "INTERNAL_ERROR", 500);
    }
}
