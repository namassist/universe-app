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
    /* Half the collection cadence, so a tap is on screen within a cycle of
       landing rather than a cycle and a half. This screen is read while
       somebody is standing at a muster watching for a name. */
    refetchInterval: 15_000,
  });

export type TapRow = Awaited<
  ReturnType<NonNullable<ReturnType<typeof tapMonitorQueryOptions>["queryFn"]>>
>["rows"][number];

export const ticketsKey = (date: string) =>
  ["monitoring-tap", "tickets", date] as const;

/**
 * Tickets issued on one date.
 *
 * Slower than the live log on purpose: a ticket is a thing that already
 * happened, and the only reason to watch it is a failure waiting for a
 * reprint.
 */
export const ticketsQueryOptions = (date: string) =>
  queryOptions({
    queryKey: ticketsKey(date),
    queryFn: () =>
      unwrap(api.v1["monitoring-tap"].tickets.get({ query: { date } })),
    refetchInterval: 10_000,
  });

export type TicketRow = Awaited<
  ReturnType<NonNullable<ReturnType<typeof ticketsQueryOptions>["queryFn"]>>
>["rows"][number];

export const liveLogKey = ["monitoring-tap", "live"] as const;

/**
 * Taps as they land, while somebody is watching the tab.
 *
 * Two seconds: the machine pushes in about one, and this is the only screen
 * where the delay is the thing being measured. Polling rather than a socket —
 * the application has none, and a testing log does not justify the first.
 */
export const liveLogQueryOptions = () =>
  queryOptions({
    queryKey: liveLogKey,
    queryFn: () => unwrap(api.v1["monitoring-tap"].live.get()),
    refetchInterval: 2_000,
  });

export type LiveEventRow = Awaited<
  ReturnType<NonNullable<ReturnType<typeof liveLogQueryOptions>["queryFn"]>>
>["rows"][number];

export const deviceStatusKey = (date: string) =>
  ["monitoring-tap", "devices", date] as const;

/**
 * What the collector can and cannot reach, refreshed while a muster runs.
 *
 * Faster than the tap list on purpose: a tap that arrives a cycle late is
 * still the same tap, but a machine that has gone quiet is only worth knowing
 * about while there is still time to walk over to it.
 */
export const deviceStatusQueryOptions = (date: string) =>
  queryOptions({
    queryKey: deviceStatusKey(date),
    queryFn: () =>
      unwrap(api.v1["monitoring-tap"].devices.get({ query: { date } })),
    refetchInterval: 10_000,
  });

export type DeviceStatusRow = Awaited<
  ReturnType<
    NonNullable<ReturnType<typeof deviceStatusQueryOptions>["queryFn"]>
  >
>["rows"][number];
