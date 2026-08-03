import { queryOptions } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api";

export const planBoardKey = ["fleet-allocation", "plan"] as const;

/**
 * The PLAN board arrives composed — units with their pairs, the fleet
 * filter options, and the spare pool — because every part of it answers the
 * same question ("who holds what") and a screen assembling it from four
 * queries would race itself.
 */
export const planBoardQueryOptions = () =>
  queryOptions({
    queryKey: planBoardKey,
    queryFn: () => unwrap(api.v1["fleet-allocation"].plan.get()),
  });

export const planCandidatesKey = (unitCode: string) =>
  ["fleet-allocation", "plan", "candidates", unitCode] as const;

export const planCandidatesQueryOptions = (unitCode: string) =>
  queryOptions({
    queryKey: planCandidatesKey(unitCode),
    queryFn: () =>
      unwrap(
        api.v1["fleet-allocation"].plan.candidates.get({
          query: { unit: unitCode },
        })
      ),
  });

export type PlanBoard = Awaited<
  ReturnType<NonNullable<ReturnType<typeof planBoardQueryOptions>["queryFn"]>>
>;

export type PlanCandidate = Awaited<
  ReturnType<
    NonNullable<ReturnType<typeof planCandidatesQueryOptions>["queryFn"]>
  >
>[number];
