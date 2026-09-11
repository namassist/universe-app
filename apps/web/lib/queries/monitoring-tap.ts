import { queryOptions } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api";

export const tapMonitorKey = (date: string, q: string) =>
  ["monitoring-tap", date, q] as const;

/**
 * Polled while somebody is watching a muster.
 *
 * A minute is the freshness the collection itself offers — the machines cannot
 * push, so taps arrive on our cadence — and this only has to keep up with that.
 */
export const tapMonitorQueryOptions = (date: string, q: string) =>
  queryOptions({
    queryKey: tapMonitorKey(date, q),
    queryFn: () => unwrap(api.v1["monitoring-tap"].get({ query: { date, q } })),
    refetchInterval: 30_000,
  });

export type TapRow = Awaited<
  ReturnType<NonNullable<ReturnType<typeof tapMonitorQueryOptions>["queryFn"]>>
>["rows"][number];
