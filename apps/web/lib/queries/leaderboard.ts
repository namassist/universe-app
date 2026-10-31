import { keepPreviousData, queryOptions } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api";

/** The departments this caller may narrow the board to — scoped by the API. */
export const leaderboardDepartmentsQueryOptions = () =>
  queryOptions({
    queryKey: ["leaderboard", "departments"] as const,
    queryFn: () => unwrap(api.v1.leaderboard.departments.get()),
  });

export type LeaderboardFilter = {
  /** "YYYY-MM-DD", both ends counted. */
  from: string;
  to: string;
  /** A unit type id; empty for every type. */
  unitType: string;
  /** Empty for the whole site. */
  department: string;
};

export const leaderboardQueryOptions = (filter: LeaderboardFilter) => {
  const query = {
    from: filter.from,
    to: filter.to,
    ...(filter.unitType ? { unitType: filter.unitType } : {}),
    ...(filter.department ? { department: filter.department } : {}),
  };
  return queryOptions({
    queryKey: [
      "leaderboard",
      filter.from,
      filter.to,
      filter.unitType,
      filter.department,
    ] as const,
    queryFn: () => unwrap(api.v1.leaderboard.get({ query })),
    /* The previous board stays up while the next loads: its type tabs, title
       and podium would otherwise vanish under the click that asked for it. */
    placeholderData: keepPreviousData,
  });
};

export type LeaderboardBoard = Awaited<
  ReturnType<NonNullable<ReturnType<typeof leaderboardQueryOptions>["queryFn"]>>
>;
export type LeaderboardRow = LeaderboardBoard["rows"][number];
