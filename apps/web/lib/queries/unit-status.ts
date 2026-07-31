import { queryOptions } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api";

export const unitStatusKey = ["unit-status"] as const;

/**
 * The whole board in one read — the screen filters and sorts client-side,
 * because "show me the breakdowns" is a view of the same few hundred rows,
 * not a different question for the server.
 */
export const unitStatusQueryOptions = () =>
  queryOptions({
    queryKey: unitStatusKey,
    queryFn: () => unwrap(api.v1["unit-status"].get()),
  });

export const unitStatusHistoryKey = (code: string) =>
  ["unit-status", code, "history"] as const;

export const unitStatusHistoryQueryOptions = (code: string) =>
  queryOptions({
    queryKey: unitStatusHistoryKey(code),
    queryFn: () => unwrap(api.v1["unit-status"]({ code }).history.get()),
  });

export type UnitStatusRow = Awaited<
  ReturnType<NonNullable<ReturnType<typeof unitStatusQueryOptions>["queryFn"]>>
>[number];

export type UnitStatusHistoryRow = Awaited<
  ReturnType<
    NonNullable<ReturnType<typeof unitStatusHistoryQueryOptions>["queryFn"]>
  >
>[number];
