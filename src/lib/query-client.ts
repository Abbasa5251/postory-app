import {
  QueryClient,
  defaultShouldDehydrateQuery,
  isServer,
} from "@tanstack/react-query";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Keep client data (better-auth-ui org/session hooks in the shell)
        // cached across navigations instead of refetching each page mount —
        // those calls are slow round-trips. Only refetch when genuinely stale.
        staleTime: 5 * 60 * 1000,
        gcTime: 10 * 60 * 1000,
        refetchOnWindowFocus: false,
      },
      dehydrate: {
        // Also dehydrate pending queries so streamed SSR data hydrates.
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) ||
          query.state.status === "pending",
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

/**
 * TanStack Query SSR pattern: a fresh client per server request, a singleton
 * in the browser (so React re-suspending never loses the cache).
 */
export function getQueryClient() {
  if (isServer) return makeQueryClient();
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}
