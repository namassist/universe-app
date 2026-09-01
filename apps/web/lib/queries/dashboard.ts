import { queryOptions } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api";

export const dashboardKey = ["dashboard"] as const;

/**
 * The dashboard's counts, composed server-side and gated there.
 *
 * A section arrives as `null` when the caller holds no grant for it — the
 * screen therefore renders a card if and only if the data for it exists, and
 * never has to re-derive a permission the API already applied.
 *
 * Polled: the numbers move as the shift does — taps arrive, the board is
 * generated, a kiosk drops off — and a dashboard that only refreshed on a
 * reload would be read as current when it was not.
 */
export const DASHBOARD_POLL_MS = 60_000;

export const dashboardQueryOptions = () =>
  queryOptions({
    queryKey: dashboardKey,
    queryFn: () => unwrap(api.v1.dashboard.get()),
    refetchInterval: DASHBOARD_POLL_MS,
  });

export type Dashboard = Awaited<
  ReturnType<NonNullable<ReturnType<typeof dashboardQueryOptions>["queryFn"]>>
>;
export type AttentionFact = Dashboard["attention"][number];
