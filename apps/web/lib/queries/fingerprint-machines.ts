import { queryOptions } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api";

export const fingerprintMachinesKey = ["fingerprint-machines"] as const;

export const fingerprintMachinesQueryOptions = () =>
  queryOptions({
    queryKey: fingerprintMachinesKey,
    queryFn: () => unwrap(api.v1["fingerprint-machines"].get()),
  });

export type FingerprintMachineRow = Awaited<
  ReturnType<
    NonNullable<ReturnType<typeof fingerprintMachinesQueryOptions>["queryFn"]>
  >
>[number];
