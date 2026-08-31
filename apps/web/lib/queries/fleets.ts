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

export const noFleetKey = ["fleets", "no-fleet"] as const;

/**
 * The no-fleet entry — the units that take part in allocation without
 * belonging to a formation.
 *
 * Its own query rather than a row in the list above, because it is not a
 * fleet: no digger, no area, no bus, and nothing to disband. Fleet Setting
 * pins it above the formations and the allocation board offers it as the last
 * option in the formation filter.
 */
export const noFleetQueryOptions = () =>
  queryOptions({
    queryKey: noFleetKey,
    queryFn: () => unwrap(api.v1.fleets["no-fleet"].get()),
  });

export const saveNoFleetUnits = (unitIds: string[]) =>
  unwrap(api.v1.fleets["no-fleet"].units.put({ unitIds }));
