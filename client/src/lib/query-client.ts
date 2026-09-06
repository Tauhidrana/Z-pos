import { MutationCache, QueryClient } from "@tanstack/react-query";
import { refreshInventoryQueries } from "./inventory-cache";

/**
 * Shared client. This used to be constructed inline in App.tsx with library
 * defaults, which meant cached pages were thrown away after 5 minutes and every
 * navigation re-fetched from scratch.
 */
export const queryClient: QueryClient = new QueryClient({
  mutationCache: new MutationCache({
    onSuccess: (_data, _variables, _context, mutation) =>
      refreshInventoryQueries(queryClient, mutation.options.mutationKey?.[0]),
  }),
  defaultOptions: {
    queries: {
      // POS data changes often, but not within a few seconds of itself. This
      // is what stops a back-and-forth between two pages from re-requesting
      // everything each time.
      staleTime: 30_000,
      // Keep evicted-from-view data around long enough that returning to a
      // page renders instantly from cache while any refetch happens behind it.
      gcTime: 10 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: 1,
    },
    mutations: {
      retry: 0,
    },
  },
});
