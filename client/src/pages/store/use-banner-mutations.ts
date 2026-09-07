import { useState } from "react";
import { useAuth } from "@clerk/react";
import { toast } from "sonner";
import { queryClient } from "@/lib/query-client";

/**
 * Banner writes.
 *
 * Hand-rolled against fetch rather than built on the shared `usePostData`
 * family, because those bind one hook to one endpoint and one method, and this
 * screen needs five verbs against four paths from inside event handlers. The
 * shared hooks would mean five hook instances per render just to reach them.
 *
 * Every call refetches the list rather than patching the cache by hand. The
 * server owns `position`, and a reorder renumbers every row — so the response
 * to "move this one up" is a new ordering for all of them, and guessing it
 * locally is how the screen ends up disagreeing with the shop front.
 */

const API_URL = import.meta.env.VITE_API_URL as string;

type BannerPayload = {
    image_url?: string;
    title?: string;
    subtitle?: string;
    button_text?: string;
    button_link?: string;
    is_active?: boolean;
};

export function useBannerMutations() {
    const { getToken } = useAuth();
    const [busy, setBusy] = useState(false);

    const call = async (
        path: string,
        method: "POST" | "PATCH" | "DELETE",
        body?: unknown,
    ): Promise<boolean> => {
        setBusy(true);
        try {
            const token = await getToken();
            const res = await fetch(`${API_URL}${path}`, {
                method,
                headers: {
                    "Content-Type": "application/json",
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            });

            const parsed = await res.json().catch(() => null);
            if (!res.ok) {
                throw new Error(
                    (parsed as { message?: string })?.message ??
                        "That did not save. Please try again.",
                );
            }

            await queryClient.invalidateQueries({ queryKey: ["store", "banners"] });
            return true;
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Something went wrong.");
            return false;
        } finally {
            setBusy(false);
        }
    };

    return {
        busy,

        async create(payload: BannerPayload) {
            if (await call("/store/banners", "POST", payload)) {
                toast.success("Banner added");
            }
        },

        update(payload: BannerPayload & { id: string }) {
            void (async () => {
                if (await call("/store/banners", "PATCH", payload)) {
                    toast.success("Banner updated");
                }
            })();
        },

        remove(id: string) {
            void (async () => {
                if (await call(`/store/banners/${id}`, "DELETE")) {
                    toast.success("Banner removed");
                }
            })();
        },

        reorder(ids: string[]) {
            // Silent on success: the list visibly moves, so a toast for every
            // press of an arrow is noise.
            void call("/store/banners/reorder", "PATCH", { ids });
        },
    };
}
