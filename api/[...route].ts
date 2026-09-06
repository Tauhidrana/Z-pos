/**
 * Vercel serverless entry for the API.
 *
 * The filename is a catch-all on purpose. `api/index.ts` only answers `/api`
 * itself, so every real route (`/api/products/get/all`) 404'd before reaching
 * Hono; the optional form `[[...route]]` fared no better here — Vercel compiled
 * it to a single-segment matcher (`^/api/([^/]+)$`) that caught `/api/me` and
 * still missed anything deeper. `[...route]` claims one-or-more segments, which
 * is the whole `/api/*` subtree, and hands the untouched path to the router.
 *
 * `package.json` beside this file sets `"type": "module"`. Without it Vercel's
 * emitted `.js` is loaded as CommonJS and dies on its own `import` statement.
 *
 * The adapter is `@hono/node-server/vercel`, not `hono/vercel`. The latter is
 * for Vercel's Edge runtime and expects a Web `Request`; on the Node runtime it
 * receives Node's `IncomingMessage` and dies with
 * "this.raw.headers.get is not a function" inside the first middleware. Edge is
 * not an option here anyway — Prisma talks to Postgres over TCP.
 *
 * The Hono app is runtime-agnostic — `server/index.ts` only wraps it in
 * `@hono/node-server` for local development — so the same app can be handed to
 * Vercel's Node runtime unchanged. Routes are already registered under
 * `/api/*` inside the app and Vercel passes the full path through, so the
 * app's own router resolves them with no prefix rewrite.
 *
 * `_app.mjs` is produced by the build command, not committed. It has to be a
 * pre-bundled file because Vercel's Node builder only transpiles an entry
 * point — it never resolves the `@/…` and `@myapp/…` TypeScript path aliases
 * that the server source is written against, so importing `@/app` directly
 * builds fine and then dies at runtime with ERR_MODULE_NOT_FOUND. Bundling
 * from inside `server/` resolves those aliases against the tsconfig that
 * defines them, and inlines Prisma's WASM query compiler as base64 so the
 * function needs no sidecar files.
 *
 * `validateEnv()` is deliberately not called: it ends the process on a missing
 * variable, which is right for a long-lived server and wrong for a function,
 * where it would turn one bad config into an opaque crash loop.
 */
import { handle } from "@hono/node-server/vercel";
// @ts-expect-error — generated at build time by `bun build` (see vercel.json).
import { app } from "./_app.mjs";

export const config = {
  runtime: "nodejs",
};

export default handle(app);
