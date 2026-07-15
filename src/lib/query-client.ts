import {
  QueryClient,
  defaultShouldDehydrateQuery,
  isServer,
} from "@tanstack/react-query";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Avoid immediate client refetch of data just streamed from the server.
        staleTime: 60 * 1000,
      },
      dehydrate: {
        // Also dehydrate pending queries so streamed SSR data hydrates.
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) || query.state.status === "pending",
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
