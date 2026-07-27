import { queryOptions } from "@tanstack/react-query";

import type { DeviceKind } from "@universe/contracts";

import { api, unwrap } from "@/lib/api";

/**
 * How often a kiosk asks for its content.
 *
 * This poll *is* the heartbeat — the endpoint stamps `last_seen_at` on every
 * read from a device session — so the interval is also what decides how quickly
 * a TV that has been unplugged stops reading as online. The registry's window
 * is three minutes, so a minute leaves room for two missed polls before a
 * healthy screen would be called offline.
 */
const POLL_MS = 60_000;

export const displayKey = (kind: DeviceKind) => ["display", kind] as const;

export const displayQueryOptions = (kind: DeviceKind) =>
  queryOptions({
    queryKey: displayKey(kind),
    queryFn: () => unwrap(api.v1.display({ kind }).get()),
    refetchInterval: POLL_MS,
    // A TV is left running for days; without this it would stop polling the
    // moment the browser considers the tab backgrounded, and the device would
    // report offline while plainly showing content.
    refetchIntervalInBackground: true,
    retry: false,
  });
