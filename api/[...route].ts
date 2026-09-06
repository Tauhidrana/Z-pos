/**
 * Vercel serverless entry for the API.
 *
 * The Hono app is runtime-agnostic — `server/index.ts` only wraps it in
 * `@hono/node-server` for local development — so the same app is handed to
 * Vercel's Node runtime here. Routes are already registered under `/api/*`
 * inside the app and Vercel passes the full path through, so the app's own
 * router resolves them with no prefix rewrite.
 *
 * The filename is a catch-all on purpose. `api/index.ts` only answers `/api`
 * itself, and the optional form `[[...route]]` compiled to a single-segment
 * matcher that caught `/api/me` and missed anything deeper. `[...route]` claims
 * one-or-more segments, which is the whole `/api/*` subtree.
 *
 * `_app.mjs` is produced by the build command, not committed: Vercel's Node
 * builder only transpiles an entry point and never resolves the `@/…` and
 * `@myapp/…` path aliases the server is written against, so importing `@/app`
 * directly builds fine and then dies with ERR_MODULE_NOT_FOUND.
 *
 * The request bridge is hand-written rather than `@hono/node-server/vercel`.
 * That adapter builds the request body with `Readable.toWeb(incoming)`, but
 * Vercel's launcher runs with `shouldAddHelpers: true` and has already drained
 * the stream into `req.body` by then. Reading the drained stream never yields
 * and never ends, so every POST/PATCH/PUT hung until Hono's 30s timeout fired
 * and returned a 504 — checkout would spin forever and then fail. Preferring
 * the parsed body and only falling back to the stream fixes it.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
// @ts-expect-error — generated at build time by `bun build` (see vercel.json).
import { app } from "./_app.mjs";

export const config = {
  runtime: "nodejs",
};

/** Re-serialise whatever Vercel's body helper left us, preserving the raw bytes when it did not run. */
async function readBody(
  req: IncomingMessage & { body?: unknown },
): Promise<{ body: BodyInit | undefined; contentType?: string }> {
  if (req.method === "GET" || req.method === "HEAD") return { body: undefined };

  // Helpers ran: `req.body` is already a string, Buffer or parsed object.
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === "string") return { body: req.body };
    if (Buffer.isBuffer(req.body)) return { body: new Uint8Array(req.body) };
    return { body: JSON.stringify(req.body), contentType: "application/json" };
  }

  // Helpers did not run (or the body was empty): drain the stream ourselves.
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return { body: chunks.length ? new Uint8Array(Buffer.concat(chunks)) : undefined };
}

export default async function handler(
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse,
): Promise<void> {
  const proto = (req.headers["x-forwarded-proto"] as string) ?? "https";
  const host = (req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost") as string;
  const url = new URL(req.url ?? "/", `${proto}://${host}`);

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    // Dropped deliberately: the body is re-serialised below, so an inherited
    // length or chunked marker would describe bytes that no longer exist.
    if (key === "content-length" || key === "transfer-encoding") continue;
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
    else headers.set(key, value);
  }

  const { body, contentType } = await readBody(req);
  if (contentType && !headers.has("content-type")) headers.set("content-type", contentType);

  const response = await app.fetch(
    new Request(url, { method: req.method, headers, body }),
  );

  res.statusCode = response.status;
  for (const [key, value] of response.headers) {
    // `Headers` collapses repeated Set-Cookie into one comma-joined value,
    // which browsers read as a single malformed cookie.
    if (key.toLowerCase() === "set-cookie") continue;
    res.setHeader(key, value);
  }
  const cookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [];
  if (cookies.length) res.setHeader("set-cookie", cookies);

  if (response.body) {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
  }
  res.end();
}
