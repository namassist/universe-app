"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  markAllNotifsRead,
  markNotifRead,
  notificationsKey,
  notificationsQueryOptions,
} from "@/lib/queries/notifications";
import { useRole } from "@/components/providers/role-context";

/**
 * The notification list, and marking it seen.
 *
 * One hook for the bell and the page both, because they are two views of one
 * thing: reading a notification in the dropdown must empty it out of the page
 * too, and the shared query cache is what makes that true without either
 * knowing about the other.
 *
 * **Gated on the menu grant, including the fetch.** A reader without it gets
 * an empty list and no request at all, so the bell can hide itself rather than
 * sitting there permanently empty — which reads as "nothing is happening"
 * rather than "this is not yours to see".
 */
export function useNotifs() {
  const { access } = useRole();
  const canSee = access("notifications") !== undefined;
  const queryClient = useQueryClient();
  const { data } = useQuery(notificationsQueryOptions(canSee));
  const notifs = data ?? [];

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: notificationsKey });

  const read = useMutation({
    mutationFn: markNotifRead,
    onSuccess: refresh,
  });
  const readAll = useMutation({
    mutationFn: markAllNotifsRead,
    onSuccess: refresh,
  });

  return {
    canSee,
    notifs,
    unread: notifs.filter((n) => !n.read).length,
    /* Fire and forget on purpose: a mark that fails leaves the dot where it
       was, which is the honest outcome and needs no apology on screen. */
    markRead: (id: string) => read.mutate(id),
    markAllRead: () => readAll.mutate(),
  };
}
