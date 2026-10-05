import { queryOptions } from "@tanstack/react-query";

import type { ReportKind, ShiftKind } from "@universe/contracts";

import { api, unwrap } from "@/lib/api";

/** The departments this caller may narrow a report to — scoped by the API. */
export const reportDepartmentsQueryOptions = () =>
  queryOptions({
    queryKey: ["reports", "departments"] as const,
    queryFn: () => unwrap(api.v1.reports.departments.get()),
  });

export type ReportFilter = {
  kind: ReportKind;
  date: string;
  shift: ShiftKind;
  /** Empty for the whole site. */
  department: string;
};

/** The query string both the report and its export are asked with. */
export const reportParams = (filter: ReportFilter): URLSearchParams => {
  const params = new URLSearchParams({
    date: filter.date,
    shift: filter.shift,
  });
  if (filter.department) params.set("department", filter.department);
  return params;
};

export const reportQueryOptions = (filter: ReportFilter) =>
  queryOptions({
    queryKey: [
      "reports",
      filter.kind,
      filter.date,
      filter.shift,
      filter.department,
    ] as const,
    queryFn: () =>
      unwrap(
        api.v1.reports({ kind: filter.kind }).get({
          query: {
            date: filter.date,
            shift: filter.shift,
            ...(filter.department ? { department: filter.department } : {}),
          },
        })
      ),
  });
