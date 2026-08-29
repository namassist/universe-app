import { queryOptions } from "@tanstack/react-query";

import type { ShiftKind } from "@universe/contracts";

import { api, unwrap } from "@/lib/api";

export const actualListKey = ["fleet-allocation", "actual"] as const;

/** The generated boards, newest first — the history the Actual tab lists. */
export const actualListQueryOptions = () =>
  queryOptions({
    queryKey: actualListKey,
    queryFn: () => unwrap(api.v1["fleet-allocation"].actual.get()),
  });

export const actualBoardKey = (date: string, shift: ShiftKind) =>
  ["fleet-allocation", "actual", date, shift] as const;

/**
 * One board, unit by unit — vacancies included, because a unit with nobody on
 * it is the thing this screen exists to show.
 */
export const actualBoardQueryOptions = (date: string, shift: ShiftKind) =>
  queryOptions({
    queryKey: actualBoardKey(date, shift),
    queryFn: () =>
      unwrap(api.v1["fleet-allocation"].actual({ date })({ shift }).get()),
  });

export const actualCandidatesKey = (
  date: string,
  shift: ShiftKind,
  unitId: string
) => ["fleet-allocation", "actual", date, shift, "candidates", unitId] as const;

/**
 * Who could take a unit, and what stands in each person's way — refusals
 * included rather than filtered out, because a supervisor overriding the
 * engine is entitled to see what the engine saw, and may place someone it
 * refused.
 */
export const actualCandidatesQueryOptions = (
  date: string,
  shift: ShiftKind,
  unitId: string
) =>
  queryOptions({
    queryKey: actualCandidatesKey(date, shift, unitId),
    queryFn: () =>
      unwrap(
        api.v1["fleet-allocation"]
          .actual({ date })({ shift })
          .candidates({ unitId })
          .get()
      ),
  });

export type ActualDocument = Awaited<
  ReturnType<NonNullable<ReturnType<typeof actualListQueryOptions>["queryFn"]>>
>[number];

export type ActualBoard = Awaited<
  ReturnType<NonNullable<ReturnType<typeof actualBoardQueryOptions>["queryFn"]>>
>;

export type ActualSlot = ActualBoard["slots"][number];

export type ActualCandidate = Awaited<
  ReturnType<
    NonNullable<ReturnType<typeof actualCandidatesQueryOptions>["queryFn"]>
  >
>[number];
