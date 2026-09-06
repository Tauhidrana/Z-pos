import { describe, it, expect } from "bun:test";
import { resolveTenant } from "../lib/tenant";

/**
 * The tenant resolver decides, for every page load, whether the visitor gets
 * the dashboard or somebody's shop. Getting it wrong in either direction is
 * severe: a merchant locked out of their own admin, or the admin served on a
 * hostname that should have been a storefront.
 *
 * These pin the boundaries. VITE_APP_DOMAIN is unset under `bun test`, so the
 * resolver falls back to its production default, `zpos.vercel.app`.
 */

describe("subdomain form", () => {
    it("reads the first label as the store slug", () => {
        expect(resolveTenant("tds.zpos.vercel.app", "/")).toEqual({
            mode: "storefront",
            slug: "tds",
            basePath: "",
        });
    });

    it("keeps the app domain itself on the dashboard", () => {
        expect(resolveTenant("zpos.vercel.app", "/")).toEqual({ mode: "app" });
    });

    it("keeps infrastructure labels on the dashboard", () => {
        for (const host of [
            "www.zpos.vercel.app",
            "api.zpos.vercel.app",
            "admin.zpos.vercel.app",
            "preview.zpos.vercel.app",
        ]) {
            expect(resolveTenant(host, "/")).toEqual({ mode: "app" });
        }
    });

    it("ignores a deeper hostname than one label", () => {
        // `a.b.zpos.vercel.app` is not a storefront — treating it as one would
        // mean two different hostnames resolving to the same slug.
        expect(resolveTenant("a.b.zpos.vercel.app", "/")).toEqual({ mode: "app" });
    });

    it("does not match a domain that merely ends with the app domain's text", () => {
        // The suffix check must be on a label boundary, or `evilzpos.vercel.app`
        // and lookalikes would be served as tenants of this deployment.
        expect(resolveTenant("evilzpos.vercel.app", "/")).toEqual({ mode: "app" });
        expect(resolveTenant("zpos.vercel.app.attacker.net", "/")).toEqual({ mode: "app" });
    });

    it("serves the dashboard on a Vercel preview host", () => {
        expect(resolveTenant("zpos-git-feat-team.vercel.app", "/")).toEqual({ mode: "app" });
    });

    it("supports *.localhost for local development", () => {
        expect(resolveTenant("tds.localhost", "/")).toEqual({
            mode: "storefront",
            slug: "tds",
            basePath: "",
        });
    });
});

describe("path form", () => {
    it("resolves /s/<slug> on the app domain", () => {
        expect(resolveTenant("zpos.vercel.app", "/s/tds")).toEqual({
            mode: "storefront",
            slug: "tds",
            basePath: "/s/tds",
        });
    });

    it("carries the base through deeper routes", () => {
        expect(resolveTenant("zpos.vercel.app", "/s/tds/product/cotton-shirt")).toEqual({
            mode: "storefront",
            slug: "tds",
            basePath: "/s/tds",
        });
    });

    it("works on localhost, which has no subdomain to use", () => {
        expect(resolveTenant("localhost", "/s/abc")).toEqual({
            mode: "storefront",
            slug: "abc",
            basePath: "/s/abc",
        });
    });

    it("lower-cases a slug typed in capitals", () => {
        expect(resolveTenant("zpos.vercel.app", "/s/TDS")).toEqual({
            mode: "storefront",
            slug: "tds",
            basePath: "/s/tds",
        });
    });

    it("ignores /s alone and /sales, which is a dashboard route", () => {
        expect(resolveTenant("zpos.vercel.app", "/s")).toEqual({ mode: "app" });
        expect(resolveTenant("zpos.vercel.app", "/sales")).toEqual({ mode: "app" });
        expect(resolveTenant("zpos.vercel.app", "/settings")).toEqual({ mode: "app" });
    });

    it("prefers the subdomain when both forms are present", () => {
        // Otherwise one storefront could be nested inside another's router base.
        expect(resolveTenant("tds.zpos.vercel.app", "/s/abc")).toEqual({
            mode: "storefront",
            slug: "tds",
            basePath: "",
        });
    });
});

describe("dashboard routes stay on the dashboard", () => {
    it("never treats an ordinary app route as a store", () => {
        for (const path of ["/", "/pos", "/products", "/store", "/store/orders", "/admin"]) {
            expect(resolveTenant("zpos.vercel.app", path)).toEqual({ mode: "app" });
        }
    });
});
