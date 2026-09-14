import { queryOptions } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api";

export const ticketsKey = (date: string) => ["tickets", date] as const;

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
    queryFn: () => unwrap(api.v1.tickets.get({ query: { date } })),
    refetchInterval: 10_000,
  });

export type TicketRow = Awaited<
  ReturnType<NonNullable<ReturnType<typeof ticketsQueryOptions>["queryFn"]>>
>["rows"][number];
