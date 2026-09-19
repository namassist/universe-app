import { queryOptions } from "@tanstack/react-query";

import { api, API_URL, unwrap } from "@/lib/api";

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

/**
 * The attendance TV's scans, for its tickets.
 *
 * Two seconds rather than the walls' thirty: this screen answers the person
 * standing at the booth, and a live tap reaches the database about a second
 * after the finger leaves the glass. Each poll carries the latest hundred
 * scans, so a missed poll loses nothing — the next one repeats them.
 */
export const ATTENDANCE_SCANS_POLL_MS = 2_000;

export const attendanceScansKey = ["attendance-scans"] as const;

export const attendanceScansQueryOptions = () =>
  queryOptions({
    queryKey: attendanceScansKey,
    queryFn: () => unwrap(api.v1.attendance.display.scans.get()),
    refetchInterval: ATTENDANCE_SCANS_POLL_MS,
    refetchIntervalInBackground: true,
    retry: false,
  });

export type AttendanceScans = Awaited<
  ReturnType<
    NonNullable<ReturnType<typeof attendanceScansQueryOptions>["queryFn"]>
  >
>;
export type AttendanceScan = AttendanceScans["scans"][number];

/**
 * Where a ticket's photograph comes from, or null when there is none on file.
 *
 * The attendance wall's own route, which serves only people who scanned this
 * shift — the fleet wall's reasoning, see `fleetPhotoUrl`. The stored file
 * name is the cache-buster, so a replaced photo is picked up without a reload.
 */
export function attendancePhotoUrl(scan: {
  nik: string;
  photoFile: string | null;
}): string | null {
  if (!scan.photoFile) return null;
  const nik = encodeURIComponent(scan.nik);
  return `${API_URL}/v1/attendance/display/photo/${nik}?v=${scan.photoFile}`;
}

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
