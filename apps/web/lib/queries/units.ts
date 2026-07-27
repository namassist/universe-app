import { queryOptions } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api";

/**
 * The value `departmentId` takes to mean "no department at all".
 *
 * Company-wide assets are a category worth filtering *for*, not an absence, and
 * a select cannot express "is null" with an id. No uuid can collide with it.
 */
export const UNIT_UNASSIGNED = "none";

export type UnitFilters = {
  q?: string;
  /** A department id, or `UNIT_UNASSIGNED` for the units nobody owns. */
  departmentId?: string;
  active?: boolean;
  ftw?: boolean;
};

export const unitsKey = (filters: UnitFilters = {}) =>
  ["units", filters] as const;

/**
 * Search and the filters are served by the API rather than applied to a full
 * list in the browser: the registry is a few hundred rows now and five hundred
 * to a thousand at the site's real size, and the search has to reach the joined
 * catalogue names — code, class, type, model, brand, qualification code — which
 * the client does not index.
 */
export const unitsQueryOptions = (filters: UnitFilters = {}) =>
  queryOptions({
    queryKey: unitsKey(filters),
    queryFn: () =>
      unwrap(
        api.v1.units.get({
          query: {
            ...(filters.q ? { q: filters.q } : {}),
            ...(filters.departmentId
              ? { departmentId: filters.departmentId }
              : {}),
            ...(filters.active !== undefined ? { active: filters.active } : {}),
            ...(filters.ftw !== undefined ? { ftw: filters.ftw } : {}),
          },
        })
      ),
  });

export const unitKey = (code: string) => ["unit", code] as const;

export const unitQueryOptions = (code: string) =>
  queryOptions({
    queryKey: unitKey(code),
    queryFn: () => unwrap(api.v1.units({ code }).get()),
  });

export type UnitRow = Awaited<
  ReturnType<NonNullable<ReturnType<typeof unitsQueryOptions>["queryFn"]>>
>[number];
