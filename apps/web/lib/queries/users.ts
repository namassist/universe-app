import { queryOptions } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api";

export const usersKey = ["users"] as const;

export const usersQueryOptions = queryOptions({
  queryKey: usersKey,
  queryFn: () => unwrap(api.v1.users.get()),
});

export type UserRow = Awaited<
  ReturnType<NonNullable<typeof usersQueryOptions.queryFn>>
>[number];

/** Employees matching a typed NIK or email, for the account form (≤ 8). */
export const loadEmployeeSuggestions = (q: string) =>
  unwrap(api.v1.users["employee-suggestions"].get({ query: { q } }));

export type EmployeeSuggestion = Awaited<
  ReturnType<typeof loadEmployeeSuggestions>
>[number];
