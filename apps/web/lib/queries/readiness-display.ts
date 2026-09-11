import { queryOptions } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api";

/**
 * The two readiness TVs' own feeds — arrivals, and FTW filings.
 *
 * Thirty seconds, matching the fleet wall. It was a minute, tied to the ingest
 * re-pulling once a scheduler tick — polling faster would have re-read rows
 * that could not have changed.
 *
 * The collection that feeds these readings now asks its machines every thirty
 * seconds rather than every sixty, so the rows can change twice as often and
 * the old pairing no longer holds. Polling slower than the thing that writes
 * adds a whole cycle to the wait before a tap made at the gate appears on the
 * screen above it.
 *
 * `retry: false` as on every kiosk: an unpaired screen gets a 401 no second
 * attempt will change, and the poll underneath recovers on its own once
 * contact returns.
 */
export const READINESS_DISPLAY_POLL_MS = 30_000;

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
