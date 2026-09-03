import { queryOptions } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api";

/**
 * The two readiness TVs' own feeds — arrivals, and FTW filings.
 *
 * A minute, matching the fleet wall rather than the fingerprint one. What
 * moves these screens is the ingest, and the ingest re-pulls once a scheduler
 * tick — once a minute — inside its window. Polling faster would re-read rows
 * that cannot have changed; polling slower would add a whole ingest cycle to
 * the wait before a tap made at the gate appears on the screen above it.
 *
 * `retry: false` as on every kiosk: an unpaired screen gets a 401 no second
 * attempt will change, and the poll underneath recovers on its own once
 * contact returns.
 */
export const READINESS_DISPLAY_POLL_MS = 60_000;

export const attendanceDisplayKey = ["attendance-display"] as const;

export const attendanceDisplayQueryOptions = () =>
  queryOptions({
    queryKey: attendanceDisplayKey,
    queryFn: () => unwrap(api.v1.attendance.display.get()),
    refetchInterval: READINESS_DISPLAY_POLL_MS,
    refetchIntervalInBackground: true,
    retry: false,
  });

export type AttendanceDisplay = Awaited<
  ReturnType<
    NonNullable<ReturnType<typeof attendanceDisplayQueryOptions>["queryFn"]>
  >
>;
export type AttendanceDisplayRow = AttendanceDisplay["rows"][number];

export const fitWorkDisplayKey = ["fitwork-display"] as const;

export const fitWorkDisplayQueryOptions = () =>
  queryOptions({
    queryKey: fitWorkDisplayKey,
    queryFn: () => unwrap(api.v1["fit-to-work"].display.get()),
    refetchInterval: READINESS_DISPLAY_POLL_MS,
    refetchIntervalInBackground: true,
    retry: false,
  });

export type FitWorkDisplay = Awaited<
  ReturnType<
    NonNullable<ReturnType<typeof fitWorkDisplayQueryOptions>["queryFn"]>
  >
>;
export type FitWorkDisplayRow = FitWorkDisplay["rows"][number];
