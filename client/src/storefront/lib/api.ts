/**
 * The storefront's data layer.
 *
 * Separate from the dashboard's `api-request.ts` for one reason: every hook
 * there calls Clerk's `useAuth` to attach a bearer token. A shopper has no zPOS
 * account, so the storefront must never mount Clerk at all — doing so would
 * both fail and drag an authentication SDK into a page whose whole job is to
 * load fast on a phone.
 */

import {
    useQuery,
    useMutation,
    keepPreviousData,
    type UseQueryOptions,
} from "@tanstack/react-query";

/**
 * Base for every request. Note that `VITE_API_URL` already ends in `/api`
 * (`http://localhost:3000/api` locally, `/api` on Vercel) — the same value the
 * dashboard uses — so paths passed to `request` are relative to that and must
 * NOT repeat the prefix: `/storefront/tds`, never `/api/storefront/tds`.
 */
const API_URL = import.meta.env.VITE_API_URL as string;
if (!API_URL) throw new Error("Missing VITE_API_URL");

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * The error shape the API returns, so callers can branch on the code rather
 * than string-matching a message.
 *
 * Fields are declared and assigned rather than written as constructor parameter
 * properties: the client compiles with `erasableSyntaxOnly`, which rejects any
 * TypeScript that emits runtime code.
 */
export class StorefrontError extends Error {
    code: string;
    status: number;

    constructor(message: string, code: string, status: number) {
        super(message);
        this.name = "StorefrontError";
        this.code = code;
        this.status = status;
    }
}

export type ApiEnvelope<T> = { success: boolean; message: string; data: T };

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let res: Response;
    try {
        res = await fetch(`${API_URL}${path}`, {
            ...init,
            headers: {
                ...(init.body ? { "Content-Type": "application/json" } : {}),
                ...init.headers,
            },
            signal: controller.signal,
        });
    } catch (err) {
        // A wedged network must surface as a real error the UI can show, not as
        // a spinner that never resolves.
        throw new StorefrontError(
            err instanceof DOMException && err.name === "AbortError"
                ? "The shop is taking too long to respond. Please try again."
                : "Could not reach the shop. Check your internet connection.",
            "NETWORK_ERROR",
            0,
        );
    } finally {
        clearTimeout(timer);
    }

    const isJson = (res.headers.get("content-type") ?? "").includes("application/json");
    const body = isJson ? await res.json() : await res.text();

    if (!res.ok) {
        const message =
            isJson && body && typeof body === "object" && "message" in body
                ? String((body as { message: unknown }).message)
                : "Something went wrong. Please try again.";
        const code =
            isJson && body && typeof body === "object" && "error" in body
                ? String((body as { error?: { code?: string } }).error?.code ?? "ERROR")
                : "ERROR";
        throw new StorefrontError(message, code, res.status);
    }

    return (body as ApiEnvelope<T>).data;
}

export function useStoreQuery<T>(
    path: string | null,
    key: unknown[],
    options?: Omit<UseQueryOptions<T, StorefrontError>, "queryKey" | "queryFn">,
) {
    return useQuery<T, StorefrontError>({
        queryKey: key,
        queryFn: () => request<T>(path!),
        enabled: path !== null,
        // Catalog data is edited from the POS during opening hours, so it goes
        // stale in minutes, not seconds — but a shopper flicking between the
        // grid and a product should never wait twice for the same rows.
        staleTime: 60_000,
        gcTime: 10 * 60 * 1000,
        retry: 1,
        refetchOnWindowFocus: false,
        ...options,
    });
}

export function useStoreListQuery<T>(
    path: string,
    key: unknown[],
    options?: Omit<UseQueryOptions<T, StorefrontError>, "queryKey" | "queryFn">,
) {
    return useStoreQuery<T>(path, key, {
        placeholderData: keepPreviousData,
        ...options,
    } as Omit<UseQueryOptions<T, StorefrontError>, "queryKey" | "queryFn">);
}

export function useStoreMutation<TInput, TOutput>(path: string) {
    return useMutation<TOutput, StorefrontError, TInput>({
        mutationFn: (input) =>
            request<TOutput>(path, { method: "POST", body: JSON.stringify(input) }),
        retry: 0,
    });
}

export { request as storefrontRequest };
