import { queryOptions } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api";

export const runTextsKey = ["run-texts"] as const;

export const runTextsQueryOptions = () =>
  queryOptions({
    queryKey: runTextsKey,
    queryFn: () => unwrap(api.v1["run-texts"].get({ query: {} })),
  });

export type RunTextRow = Awaited<
  ReturnType<NonNullable<ReturnType<typeof runTextsQueryOptions>["queryFn"]>>
>[number];

export const deviceRunTextsKey = (deviceId: string) =>
  ["device-run-texts", deviceId] as const;

/**
 * A device's own texts. An empty array is not "no data" — it is the device
 * following the master list (design D8), which is why the screen has to be able
 * to tell an empty result from a pending one.
 */
export const deviceRunTextsQueryOptions = (deviceId: string) =>
  queryOptions({
    queryKey: deviceRunTextsKey(deviceId),
    queryFn: () => unwrap(api.v1.devices({ id: deviceId })["run-texts"].get()),
  });
