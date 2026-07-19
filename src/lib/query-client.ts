import {
  QueryClient,
  defaultShouldDehydrateQuery,
  isServer,
} from "@tanstack/react-query";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Short freshness only — dedupes rapid navigations without holding
        // identity-scoped data (auth/session/org hooks share this client) stale
        // after sign-out or an org switch. Page speed comes from the fast local
        // DB + per-request getAuthCtx/listBrands memoization, not long caching.
        staleTime: 60 * 1000,
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
