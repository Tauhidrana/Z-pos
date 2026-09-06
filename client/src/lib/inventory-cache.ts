import type { QueryClient } from "@tanstack/react-query";

/** Stock and catalog mutations affect several independently cached screens. */
export async function refreshInventoryQueries(client: QueryClient, endpoint: unknown) {
  if (typeof endpoint !== "string" || !/^\/(products|purchase|sales|store\/products|store\/orders)(\/|$)/.test(endpoint)) {
    return;
  }

  await client.invalidateQueries({
    // useGetData appends the endpoint after caller-supplied search/page keys,
    // so a prefix such as ["products"] does not match all product lists.
    predicate: ({ queryKey }) => queryKey.some(
      (key) => typeof key === "string" &&
        /^\/(products|purchase|dashboard|store\/products)(\/|\?|$)/.test(key),
    ),
  });
}
