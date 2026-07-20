import { queryOptions } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api";

/**
 * One definition of the users query — its key and its fetcher together.
 *
 * The server prefetches with `prefetchQuery(usersQueryOptions)` and the client
 * reads with `useQuery(usersQueryOptions)`; sharing this object is what stops
 * the key and the fetcher from drifting apart between the two.
 *
 * `unwrap` turns Eden's `{ data, error }` into a value-or-throw, which is the
 * contract TanStack Query wants from a `queryFn`.
 */
export const usersQueryOptions = queryOptions({
  queryKey: ["users"] as const,
  queryFn: () => unwrap(api.v1.users.get()),
});
