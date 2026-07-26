import { queryOptions } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api";

/**
 * Defined once, imported by both the server prefetch and the client
 * `useQuery`, so the key and the fetcher cannot drift apart.
 */
export const sessionQueryOptions = queryOptions({
  queryKey: ["session"] as const,
  queryFn: () => unwrap(api.v1.auth.session.get()),
  // The session carries the permission map the whole shell renders from, so a
  // stale copy is a wrong sidebar. Refetch on focus rather than trusting it.
  staleTime: 0,
  refetchOnWindowFocus: true,
});

export const sessionKey = sessionQueryOptions.queryKey;
