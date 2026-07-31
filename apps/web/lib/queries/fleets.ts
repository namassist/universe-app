import { queryOptions } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api";

export const fleetsKey = ["fleets"] as const;

/**
 * The whole fleet list in one document — a site runs a handful of fleets, and
 * the screen needs every one anyway to hide diggers and haulers other fleets
 * already hold.
 */
export const fleetsQueryOptions = () =>
  queryOptions({
    queryKey: fleetsKey,
    queryFn: () => unwrap(api.v1.fleets.get()),
  });

export type FleetRow = Awaited<
  ReturnType<NonNullable<ReturnType<typeof fleetsQueryOptions>["queryFn"]>>
>[number];
