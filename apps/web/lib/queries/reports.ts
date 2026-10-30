import { queryOptions } from "@tanstack/react-query";

import {
  REPORT_TODAY_ONLY,
  type ReportKind,
  type ShiftKind,
} from "@universe/contracts";

import { api, unwrap } from "@/lib/api";

/** The departments this caller may narrow a report to — scoped by the API. */
export const reportDepartmentsQueryOptions = () =>
  queryOptions({
    queryKey: ["reports", "departments"] as const,
    queryFn: () => unwrap(api.v1.reports.departments.get()),
  });

export type ReportFilter = {
  kind: ReportKind;
  /**
   * Not sent for a today-only report: the API reads its own today. The
   * caller still sets it to today there, because the cache is keyed by it.
   */
  date: string;
  /** Not sent for a today-only report, which is about the whole day. */
  shift: ShiftKind;
  /** Empty for the whole site. */
  department: string;
  /**
   * Empty for every position. Final Validation only (owner, 2026-10-11): it
   * is never sent for another report, so a choice left over from it cannot
   * narrow one silently.
   */
  position: string;
};

type ReportQuery = {
  date?: string;
  shift?: ShiftKind;
  department?: string;
  position?: string;
};

/**
 * What a report is asked with — the report and its export alike. A
 * today-only report sends no date and no shift (owner, 2026-10-30): the API
 * reads today by its own clock and refuses any other day, so a date carried
 * over from another report must not reach it.
 */
const reportQuery = (filter: ReportFilter): ReportQuery => ({
  ...(REPORT_TODAY_ONLY[filter.kind]
    ? {}
    : { date: filter.date, shift: filter.shift }),
  ...(filter.department ? { department: filter.department } : {}),
  ...(filter.kind === "final-validation" && filter.position
    ? { position: filter.position }
    : {}),
});

/** The query string both the report and its export are asked with. */
export const reportParams = (filter: ReportFilter): URLSearchParams =>
  new URLSearchParams(reportQuery(filter));

export const reportQueryOptions = (filter: ReportFilter) => {
  const query = reportQuery(filter);
  return queryOptions({
    queryKey: [
      "reports",
      filter.kind,
      /* A today-only report sends no date, but its rows are still one day's:
         keyed by the caller's today (`filter.date`), a page left open past
         midnight asks again rather than showing yesterday's from the cache. */
      filter.date,
      query.shift ?? "",
      query.department ?? "",
      query.position ?? "",
    ] as const,
    queryFn: () => unwrap(api.v1.reports({ kind: filter.kind }).get({ query })),
  });
};
