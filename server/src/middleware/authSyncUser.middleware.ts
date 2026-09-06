import { createClerkClient } from "@clerk/backend";
import type { Context, Next } from "hono";
import type { AppEnv } from "@/types";
import prisma from "@/lib/prisma";
import { sendError } from "@/utils/response";
import { getCachedSession, setCachedSession } from "@/lib/session-cache";

/**
 * Emails provisioned as active OWNERs the first time they sign in, even though
 * nobody invited them.
 *
 * Access here is invite-only: a Clerk account with no matching `users` row is
 * rejected, and the only way to create that row is the admin UI, which itself
 * requires an account that already has access. A fresh database — or one where
 * the operator's address was recorded with a typo — is therefore unrecoverable
 * without direct SQL. This allowlist is the escape hatch, and it lives in the
 * environment so using it takes deploy access, not merely a sign-up.
 */
const BOOTSTRAP_OWNER_EMAILS = new Set(
    (process.env.BOOTSTRAP_OWNER_EMAILS ?? "")
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
);

const clerk = createClerkClient({
    secretKey: process.env.CLERK_SECRET_KEY!,
});

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
            const clerkUser = await clerk.users.getUser(clerkUserId);
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

export async function syncUser(c: Context<AppEnv>, next: Next) {
    const clerkUserId = c.get("clerkUserId");

    try {
        // ── 1. Hot path: fully cached identity + authorization decision ──────
        const cached = getCachedSession(clerkUserId);
        if (cached) {
            c.set("userId", cached.userId);
            c.set("userRole", cached.role);
            return next();
        }

        // ── 2. Warm path: already linked, so one indexed lookup is enough.
        //       No Clerk API call — clerk_id is the join key. ────────────────
        let user = await prisma.user.findUnique({
            where: { clerk_id: clerkUserId },
            select: { id: true, role: true, is_active: true },
        });

        // ── 3. Cold path: first sign-in for this Clerk account. We only need
        //       Clerk here, to resolve the email that the invite was issued to.
        if (!user) {
            const clerkUser = await clerk.users.getUser(clerkUserId);
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
                    select: { id: true, role: true, is_active: true, status: true },
                })) ??
                (await prisma.user.findFirst({
                    where: { email: { equals: email, mode: "insensitive" } },
                    select: { id: true, role: true, is_active: true, status: true },
                }));

            // Not in DB = not invited = blocked, unless the environment has
            // explicitly designated this address as a bootstrap owner.
            if (!invited) {
                if (!BOOTSTRAP_OWNER_EMAILS.has(email.toLowerCase())) {
                    return sendError(
                        c,
                        "Access denied. Your account has not been granted access to this system.",
                        "FORBIDDEN",
                        403,
                    );
                }

                const created = await prisma.user.create({
                    data: {
                        email,
                        clerk_id: clerkUserId,
                        name: clerkDisplayName(clerkUser),
                        role: "OWNER",
                        status: "ACCEPTED",
                        is_active: true,
                    },
                    select: { id: true, role: true, is_active: true },
                });

                console.warn(
                    `[syncUser] bootstrapped OWNER ${email} from BOOTSTRAP_OWNER_EMAILS`,
                );

                lastProfileSync.set(created.id, Date.now());
                setCachedSession(clerkUserId, { userId: created.id, role: created.role });
                c.set("userId", created.id);
                c.set("userRole", created.role);
                return next();
            }

            // Link the Clerk account to the invited row so every later request
            // takes the warm path above.
            await prisma.user.update({
                where: { id: invited.id },
                data: {
                    clerk_id: clerkUserId,
                    status: invited.status === "PENDING" ? "ACCEPTED" : invited.status,
                    name: clerkDisplayName(clerkUser),
                },
            });

            lastProfileSync.set(invited.id, Date.now());
            user = { id: invited.id, role: invited.role, is_active: invited.is_active };
        } else {
            refreshProfileInBackground(user.id, clerkUserId);
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

        setCachedSession(clerkUserId, { userId: user.id, role: user.role });

        c.set("userId", user.id);
        c.set("userRole", user.role);

        await next();
    } catch (err) {
        console.error("[syncUser]", err);
        return sendError(c, "Authentication failed", "INTERNAL_ERROR", 500);
    }
}
