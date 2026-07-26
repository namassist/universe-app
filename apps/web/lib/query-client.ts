import {
  defaultShouldDehydrateQuery,
  isServer,
  QueryClient,
} from "@tanstack/react-query";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Long enough that a client refetch does not immediately undo the
        // server prefetch it was hydrated from.
        staleTime: 30_000,
        retry: (failureCount, error) => {
          // Never retry an authorization failure: the answer will not change,
          // and retrying turns one redirect into four.
          const status = (error as { status?: number } | null)?.status;
          if (status === 401 || status === 403) return false;
          return failureCount < 2;
        },
      },
      dehydrate: {
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) ||
          query.state.status === "pending",
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

/**
 * A fresh client per request on the server, a singleton in the browser. A
 * server-side singleton would leak one user's cache into another's — which,
 * with a session-scoped permission map in it, is exactly the wrong thing to
 * share.
 */
export function getQueryClient(): QueryClient {
  if (isServer) return makeQueryClient();
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}
