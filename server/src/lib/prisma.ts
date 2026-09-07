import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "generated/prisma/client";

if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not defined");
}

/**
 * True on Vercel (and any other per-request-container host). The pool has to be
 * sized very differently there: a long-lived server wants one big shared pool,
 * while a serverless deployment has N containers that each open their own, so
 * an over-generous per-container `max` multiplies into connection exhaustion on
 * the database — which shows up as requests hanging on connection acquisition
 * rather than as an obvious error.
 */
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    // A serverless container serves one request at a time, so it only needs
    // enough connections for the parallel queries inside a single handler —
    // the dashboard's overview endpoint issues six at once. Six is enough for
    // those to run concurrently without any one container hoarding the
    // database's connection budget.
    max: isServerless ? 6 : 20,
    // Release idle connections quickly on serverless: a container that has
    // gone quiet should not keep holding slots that a live container needs.
    // A long-lived server benefits from the opposite — keeping them warm.
    idleTimeoutMillis: isServerless ? 10_000 : 60_000,
    // Fail fast instead of sitting on the request until Hono's 30s timeout.
    // A pool that cannot hand out a connection in 10s is saturated, and a
    // clear error beats a spinner that never resolves.
    connectionTimeoutMillis: 10_000,
});

const globalForPrisma = global as unknown as {
    prisma: PrismaClient;
};

const prisma =
    globalForPrisma.prisma ||
    new PrismaClient({
        adapter,
    });

// Cached unconditionally, production included. This module can be evaluated
// more than once in a single process — dev hot-reload, and on Vercel where the
// bundled handler is re-imported — and each fresh evaluation used to build a
// whole new client and pool while the old one still held its connections.
globalForPrisma.prisma = prisma;

export default prisma;
