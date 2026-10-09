import { queryOptions } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api";

/** The prefix every list key shares, for invalidating after a write. */
export const integrationClientsKey = ["integration-clients"] as const;

export const integrationClientsQueryOptions = () =>
  queryOptions({
    queryKey: integrationClientsKey,
    queryFn: () => unwrap(api.v1["integration-clients"].get()),
  });

export type IntegrationClientRow = Awaited<
  ReturnType<
    NonNullable<ReturnType<typeof integrationClientsQueryOptions>["queryFn"]>
  >
>[number];
