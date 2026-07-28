import { queryOptions } from "@tanstack/react-query";

import type { EmployeeStatus } from "@universe/contracts";

import { api, API_URL, unwrap } from "@/lib/api";

export type EmployeeFilters = {
  q?: string;
  /** A department id. */
  departmentId?: string;
  status?: EmployeeStatus;
};

export const employeesKey = (filters: EmployeeFilters = {}) =>
  ["employees", filters] as const;

/**
 * Search and the filters are served by the API rather than applied to a full
 * list in the browser (design D12).
 *
 * Two reasons, and the second is the one that decides it: a real site's
 * register runs to hundreds or thousands of people, and the search has to reach
 * the *joined* catalogue names — department, position, company — which the
 * client holds only as rendered text and does not index.
 */
export const employeesQueryOptions = (filters: EmployeeFilters = {}) =>
  queryOptions({
    queryKey: employeesKey(filters),
    queryFn: () =>
      unwrap(
        api.v1.employees.get({
          query: {
            ...(filters.q ? { q: filters.q } : {}),
            ...(filters.departmentId
              ? { departmentId: filters.departmentId }
              : {}),
            ...(filters.status ? { status: filters.status } : {}),
          },
        })
      ),
  });

export const employeeKey = (nik: string) => ["employee", nik] as const;

export const employeeQueryOptions = (nik: string) =>
  queryOptions({
    queryKey: employeeKey(nik),
    queryFn: () => unwrap(api.v1.employees({ nik }).get()),
  });

export type EmployeeRow = Awaited<
  ReturnType<NonNullable<ReturnType<typeof employeesQueryOptions>["queryFn"]>>
>[number];

/**
 * Where an employee's photo is served from, or `null` when there is none.
 *
 * A plain URL for an `<img>` rather than a fetched blob: the browser caches it,
 * revalidates it, and streams it, and the endpoint already answers 404 for a
 * row whose file is missing. `photoFileName` is in the query string only to
 * bust that cache when the photo is replaced — the server ignores it, and the
 * name is generated so it changes on every upload.
 */
export function photoUrl(row: {
  nik: string;
  photoFileName: string | null;
}): string | null {
  if (!row.photoFileName) return null;
  return `${API_URL}/v1/employees/${encodeURIComponent(row.nik)}/photo?v=${row.photoFileName}`;
}
