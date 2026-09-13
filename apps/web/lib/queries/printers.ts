import { queryOptions } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api";

export const printersKey = ["printers"] as const;

export const printersQueryOptions = () =>
  queryOptions({
    queryKey: printersKey,
    queryFn: () => unwrap(api.v1.printers.get()),
  });

export type PrinterRow = Awaited<
  ReturnType<NonNullable<ReturnType<typeof printersQueryOptions>["queryFn"]>>
>[number];
