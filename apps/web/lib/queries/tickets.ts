import { queryOptions } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api";

/** What the list is narrowed to. Every field optional; absent means "all". */
export type TicketFilters = {
  q?: string;
  department?: string;
  role?: "standing" | "spare";
  shift?: "day" | "night";
  status?: "printed" | "failed" | "dry";
};

export const ticketsKey = (date: string, filters: TicketFilters = {}) =>
  ["tickets", date, filters] as const;

/**
 * Tickets issued on one date, narrowed by whatever the toolbar holds.
 *
 * The filters go to the server rather than being applied to the rows here: the
 * list is cut at five hundred, and narrowing after the cut would show a
 * different set than the counts underneath describe.
 *
 * Slower than the live log on purpose: a ticket is a thing that already
 * happened, and the only reason to watch it is a failure waiting for a
 * reprint.
 */
export const ticketsQueryOptions = (
  date: string,
  filters: TicketFilters = {}
) =>
  queryOptions({
    queryKey: ticketsKey(date, filters),
    queryFn: () => unwrap(api.v1.tickets.get({ query: { date, ...filters } })),
    refetchInterval: 10_000,
  });

export type TicketRow = Awaited<
  ReturnType<NonNullable<ReturnType<typeof ticketsQueryOptions>["queryFn"]>>
>["rows"][number];
