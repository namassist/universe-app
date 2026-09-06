import { queryOptions } from "@tanstack/react-query";

import type { RosterCode, RosterDocumentStatus } from "@universe/contracts";

import { api, API_URL, unwrap } from "@/lib/api";

/* --------------------------------------------------------------- documents */

export type RosterFilters = {
  q?: string;
  /** A department id. */
  departmentId?: string;
  /** `YYYY-MM`. */
  month?: string;
  status?: RosterDocumentStatus;
};

export const rosterDocumentsKey = (filters: RosterFilters = {}) =>
  ["roster-documents", filters] as const;

/**
 * Search and every filter are served by the API, never applied to a full list
 * in the browser.
 *
 * The same reasoning as the employee register, one size larger: the search has
 * to reach the joined department and uploader names, which the client holds
 * only as rendered text — and a year of uploads across a dozen departments is
 * not a list worth shipping whole to filter three rows out of.
 */
export const rosterDocumentsQueryOptions = (filters: RosterFilters = {}) =>
  queryOptions({
    queryKey: rosterDocumentsKey(filters),
    queryFn: () =>
      unwrap(
        api.v1.roster.get({
          query: {
            ...(filters.q ? { q: filters.q } : {}),
            ...(filters.departmentId
              ? { departmentId: filters.departmentId }
              : {}),
            ...(filters.month ? { month: filters.month } : {}),
            ...(filters.status ? { status: filters.status } : {}),
          },
        })
      ),
  });

export const rosterDocumentKey = (id: string) =>
  ["roster-document", id] as const;

export const rosterDocumentQueryOptions = (id: string) =>
  queryOptions({
    queryKey: rosterDocumentKey(id),
    queryFn: () => unwrap(api.v1.roster({ id }).get()),
  });

/* -------------------------------------------------------------------- grid */

export type RosterGridPage = {
  page: number;
  pageSize: number;
  q?: string;
  /** Span bounds within the document's month, `YYYY-MM-DD`, inclusive. */
  from?: string;
  to?: string;
};

export const rosterDaysKey = (id: string, page: RosterGridPage) =>
  ["roster-days", id, page] as const;

/**
 * One page of a document's grid (API design D8).
 *
 * The page is a query key member rather than local state sliced out of a
 * loaded month: a month for a large department is tens of thousands of cells,
 * and the whole point of paging it on the server is not to hold it here.
 */
export const rosterDaysQueryOptions = (id: string, page: RosterGridPage) =>
  queryOptions({
    queryKey: rosterDaysKey(id, page),
    queryFn: () =>
      unwrap(
        api.v1.roster({ id }).days.get({
          query: {
            page: page.page,
            pageSize: page.pageSize,
            ...(page.q ? { q: page.q } : {}),
            ...(page.from ? { from: page.from } : {}),
            ...(page.to ? { to: page.to } : {}),
          },
        })
      ),
  });

/* ---------------------------------------------------------------- in force */

export type InForceFilters = {
  /** ISO `YYYY-MM-DD`. */
  date: string;
  code?: RosterCode;
  departmentId?: string;
};

export const rosterInForceKey = (filters: InForceFilters) =>
  ["roster-in-force", filters] as const;

/** Who carries which code on one date — active documents only. */
export const rosterInForceQueryOptions = (filters: InForceFilters) =>
  queryOptions({
    queryKey: rosterInForceKey(filters),
    queryFn: () =>
      unwrap(
        api.v1.roster["in-force"].get({
          query: {
            date: filters.date,
            ...(filters.code ? { code: filters.code } : {}),
            ...(filters.departmentId
              ? { departmentId: filters.departmentId }
              : {}),
          },
        })
      ),
  });

/* ------------------------------------------------------------------- types */

export type RosterDocumentRow = Awaited<
  ReturnType<
    NonNullable<ReturnType<typeof rosterDocumentsQueryOptions>["queryFn"]>
  >
>[number];

export type RosterGridResult = Awaited<
  ReturnType<NonNullable<ReturnType<typeof rosterDaysQueryOptions>["queryFn"]>>
>;

export { API_URL };
