import { queryOptions } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api";

export const busSchedulesKey = ["bus-schedules"] as const;

export const busSchedulesQueryOptions = () =>
  queryOptions({
    queryKey: busSchedulesKey,
    queryFn: () => unwrap(api.v1["bus-schedules"].get()),
  });

export const busUnitsKey = ["bus-schedules", "units"] as const;

/**
 * The units a schedule may be created for — type `BUS`, and nothing else.
 *
 * Its own endpoint rather than a filter on `/units` because this screen is
 * governed by the `bus` menu: a caller who may schedule a bus need hold no
 * grant on `database-unit`, and asking that route would refuse them.
 */
export const busUnitsQueryOptions = () =>
  queryOptions({
    queryKey: busUnitsKey,
    queryFn: () => unwrap(api.v1["bus-schedules"].units.get()),
  });

export type BusScheduleRow = Awaited<
  ReturnType<
    NonNullable<ReturnType<typeof busSchedulesQueryOptions>["queryFn"]>
  >
>[number];
