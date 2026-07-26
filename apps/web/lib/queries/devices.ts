import { queryOptions } from "@tanstack/react-query";

import type { DeviceKind } from "@universe/contracts";

import { api, unwrap } from "@/lib/api";

export const devicesKey = (kind: DeviceKind) => ["devices", kind] as const;

export const devicesQueryOptions = (kind: DeviceKind) =>
  queryOptions({
    queryKey: devicesKey(kind),
    queryFn: () => unwrap(api.v1.devices.get({ query: { kind } })),
    // Online state is derived from a heartbeat, so it goes stale on its own.
    refetchInterval: 30_000,
  });

export type DeviceRow = Awaited<
  ReturnType<NonNullable<ReturnType<typeof devicesQueryOptions>["queryFn"]>>
>[number];
