import { queryOptions } from "@tanstack/react-query";

import type { MasterKind } from "@universe/contracts";

import { api, unwrap } from "@/lib/api";

export const masterKey = (kind: MasterKind, activeOnly = false) =>
  ["master", kind, activeOnly ? "active" : "all"] as const;

/**
 * One factory for all nine catalogues, matching the one generic route behind
 * them (design D3).
 *
 * `activeOnly` is the difference between the two things a catalogue is read
 * for: a management screen lists every record including the retired ones, and a
 * dropdown offers only what may still be chosen. They are separate cache
 * entries because they are separate questions — sharing one would mean a
 * dropdown either showing retired options or a management screen hiding them.
 */
export const masterQueryOptions = (kind: MasterKind, activeOnly = false) =>
  queryOptions({
    queryKey: masterKey(kind, activeOnly),
    queryFn: () =>
      unwrap(
        api.v1
          .master({ kind })
          .get(activeOnly ? { query: { active: true } } : { query: {} })
      ),
  });

export type MasterRecord = Awaited<
  ReturnType<NonNullable<ReturnType<typeof masterQueryOptions>["queryFn"]>>
>[number];

/** Not every catalogue carries these; the narrowing is per kind, not per row. */
export const recordDescription = (row: MasterRecord): string =>
  "description" in row ? row.description : "";

/** Companies only — the short form the site refers to them by. */
export const recordCode = (row: MasterRecord): string =>
  "code" in row ? row.code : "";

/** Positions only — whether the allocation engine may draw from this one. */
export const recordFleetAllocation = (row: MasterRecord): boolean =>
  "fleetAllocation" in row ? row.fleetAllocation : false;

/**
 * The owner's id, for the two catalogues that have one.
 *
 * One accessor rather than two, because every caller asks the same question —
 * "what does this row hang off" — and which column answers it is a detail of
 * the kind, not of the caller.
 */
export const recordParentId = (row: MasterRecord): string =>
  "companyId" in row
    ? row.companyId
    : "departmentId" in row
      ? row.departmentId
      : "";
