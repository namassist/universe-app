import { queryOptions } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api";

/**
 * The monitoring TV's own feed.
 *
 * Kept in step with `PROBE_INTERVAL_SECONDS` (30 s): the prober's cycle is what
 * makes the data move, and polling slower than it would add a whole cycle of
 * latency to every outage while polling faster would just re-read the same
 * rows. This is deliberately not tied to the running-text belt's 60 s, which
 * serves a different purpose — that poll is the device heartbeat.
 *
 * `retry: false` for the same reason as the belt: an unpaired screen gets a
 * 401 that a second attempt will not change, and a monitoring wall retrying in
 * a loop would hide the outage it exists to show.
 */
export const FINGERPRINT_DISPLAY_POLL_MS = 30_000;

export const fingerprintDisplayKey = ["fingerprint-display"] as const;

export const fingerprintDisplayQueryOptions = () =>
  queryOptions({
    queryKey: fingerprintDisplayKey,
    queryFn: () => unwrap(api.v1["fingerprint-machines"].display.get()),
    refetchInterval: FINGERPRINT_DISPLAY_POLL_MS,
    refetchIntervalInBackground: true,
    retry: false,
  });

export type FingerprintDisplay = Awaited<
  ReturnType<
    NonNullable<ReturnType<typeof fingerprintDisplayQueryOptions>["queryFn"]>
  >
>;

export type FingerprintDisplayMachine = FingerprintDisplay["machines"][number];
