import {
  defaultShouldDehydrateQuery,
  isServer,
  QueryClient,
} from "@tanstack/react-query";

/**
 * One QueryClient factory shared by the server (prefetch) and the browser.
 *
 * The rules that make TanStack Query safe under the App Router:
 *   - On the server, make a *fresh* client per request. A module-level
 *     singleton on the server would leak one user's cache into another's.
 *   - In the browser, reuse a singleton so state survives re-renders and
 *     Fast Refresh, and so every component reads the same cache.
 */
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Data prefetched on the server is considered fresh for this long, so
        // the client does not immediately refetch on mount and throw away the
        // server render. Tune per query where you need it tighter.
        staleTime: 60 * 1000,
      },
      dehydrate: {
        // Also ship queries that are still pending, so a query prefetched
        // without `await` can stream its result into the client.
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) ||
          query.state.status === "pending",
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

export function getQueryClient() {
  if (isServer) return makeQueryClient();
  // Lazily create once; keep the same instance for the tab's lifetime.
  return (browserQueryClient ??= makeQueryClient());
}
