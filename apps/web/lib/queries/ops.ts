import { queryOptions } from "@tanstack/react-query";

import { OPS_POLL_MS } from "@universe/contracts";

import { api, unwrap } from "@/lib/api";

/**
 * The Operations Center's feed.
 *
 * `retry: false` because a 401 means the ops session ended — another attempt
 * will not change that, and the page has to fall back to its password form
 * rather than spin. Polled in the background too: the page is often left open
 * on a second screen, which is exactly when it must keep moving.
 */
export const opsOverviewKey = ["ops-overview"] as const;

export const opsOverviewQueryOptions = () =>
  queryOptions({
    queryKey: opsOverviewKey,
    queryFn: () => unwrap(api.v1.ops.overview.get()),
    refetchInterval: OPS_POLL_MS,
    refetchIntervalInBackground: true,
    retry: false,
  });

export type OpsOverview = Awaited<
  ReturnType<NonNullable<ReturnType<typeof opsOverviewQueryOptions>["queryFn"]>>
>;
