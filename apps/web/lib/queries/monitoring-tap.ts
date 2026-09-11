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

export const tapCompareKey = (date: string, shift: string) =>
  ["monitoring-tap", "compare", date, shift] as const;

/**
 * Where the old source and the new one disagree, for one shift.
 *
 * Only meaningful while both are running. It exists to be read a few times and
 * then, once the answer is "they agree", to be deleted along with the parallel
 * run it belongs to.
 */
export const tapCompareQueryOptions = (date: string, shift: "day" | "night") =>
  queryOptions({
    queryKey: tapCompareKey(date, shift),
    queryFn: () =>
      unwrap(api.v1["monitoring-tap"].compare.get({ query: { date, shift } })),
    refetchInterval: 60_000,
  });
