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

export const recordType = (row: MasterRecord): string =>
  "type" in row ? row.type : "";
