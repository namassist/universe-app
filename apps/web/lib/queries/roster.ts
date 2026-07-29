import { queryOptions } from "@tanstack/react-query";

import type {
  RosterCode,
  RosterDocumentStatus,
  RosterRevisionStatus,
} from "@universe/contracts";

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

export type RosterGridPage = { page: number; pageSize: number; q?: string };

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

/* --------------------------------------------------------------- revisions */

export type RevisionFilters = {
  q?: string;
  status?: RosterRevisionStatus;
  documentId?: string;
};

export const rosterRevisionsKey = (filters: RevisionFilters = {}) =>
  ["roster-revisions", filters] as const;

export const rosterRevisionsQueryOptions = (filters: RevisionFilters = {}) =>
  queryOptions({
    queryKey: rosterRevisionsKey(filters),
    queryFn: () =>
      unwrap(
        api.v1["roster-revisions"].get({
          query: {
            ...(filters.q ? { q: filters.q } : {}),
            ...(filters.status ? { status: filters.status } : {}),
            ...(filters.documentId ? { documentId: filters.documentId } : {}),
          },
        })
      ),
  });

export type ApprovalFilters = { q?: string; status?: RosterRevisionStatus };

export const rosterQueueKey = (filters: ApprovalFilters = {}) =>
  ["roster-approval-queue", filters] as const;

/**
 * The approval queue — a different grant from the list above, so a different
 * key: a caller who may read revisions but not decide them gets 403 here, and
 * sharing a cache entry would hand one screen's failure to the other.
 */
export const rosterQueueQueryOptions = (filters: ApprovalFilters = {}) =>
  queryOptions({
    queryKey: rosterQueueKey(filters),
    queryFn: () =>
      unwrap(
        api.v1["roster-revisions"].queue.get({
          query: {
            ...(filters.q ? { q: filters.q } : {}),
            ...(filters.status ? { status: filters.status } : {}),
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

export type RosterRevisionRow = Awaited<
  ReturnType<
    NonNullable<ReturnType<typeof rosterRevisionsQueryOptions>["queryFn"]>
  >
>[number];

export type RosterRevisionItemRow = RosterRevisionRow["items"][number];

/* ------------------------------------------------------------------- files */

/**
 * Where a month's template is downloaded from.
 *
 * A URL rather than an Eden call, for the reason `fetchBlob` documents: Treaty
 * decodes an unrecognised body as text, and a spreadsheet that survives that
 * round trip downloads and then refuses to open.
 *
 * `departmentId` is sent only when the caller has one to choose. A scoped
 * caller's is resolved server-side from their own record and anything sent is
 * ignored, so omitting it here is the honest call rather than a shortcut.
 */
export const rosterTemplateUrl = (month: string, departmentId?: string) => {
  const query = new URLSearchParams({ month });
  if (departmentId) query.set("departmentId", departmentId);
  return `/v1/roster/import/template?${query}`;
};

export { API_URL };
