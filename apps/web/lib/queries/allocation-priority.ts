import { queryOptions } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api";

export const allocationPriorityKey = ["allocation-priority"] as const;

export const allocationPriorityQueryOptions = () =>
  queryOptions({
    queryKey: allocationPriorityKey,
    queryFn: () => unwrap(api.v1["allocation-priority"].get()),
  });

export type PriorityRow = Awaited<
  ReturnType<
    NonNullable<ReturnType<typeof allocationPriorityQueryOptions>["queryFn"]>
  >
>[number];
