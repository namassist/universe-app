import { queryOptions } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api";

export const notificationsKey = ["notifications"] as const;

/**
 * Polled rather than pushed. The events are a couple a day and the reader is
 * a person with the page open, so a minute of staleness costs nothing and a
 * socket for it would be machinery with no user.
 */
export const notificationsQueryOptions = (enabled = true) =>
  queryOptions({
    queryKey: notificationsKey,
    queryFn: () => unwrap(api.v1.notifications.get()),
    refetchInterval: 60_000,
    enabled,
  });

export type Notif = Awaited<
  ReturnType<
    NonNullable<ReturnType<typeof notificationsQueryOptions>["queryFn"]>
  >
>[number];

export const markNotifRead = (id: string) =>
  unwrap(api.v1.notifications({ id }).read.post());

export const markAllNotifsRead = () =>
  unwrap(api.v1.notifications["read-all"].post());
