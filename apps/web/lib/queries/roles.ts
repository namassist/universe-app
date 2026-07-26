import { queryOptions } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api";

export const rolesKey = ["roles"] as const;

export const rolesQueryOptions = queryOptions({
  queryKey: rolesKey,
  queryFn: () => unwrap(api.v1.roles.get()),
});

export type RoleRow = Awaited<
  ReturnType<NonNullable<typeof rolesQueryOptions.queryFn>>
>[number];
