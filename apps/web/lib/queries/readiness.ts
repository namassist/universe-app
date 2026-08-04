import { queryOptions } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api";

/**
 * The two readiness snapshots (FTW verdicts, fingerprint taps), read by date
 * range. The screens filter and sort client-side — a range is a page of days,
 * a few hundred to a few thousand rows, and "show me the red ones" is a view
 * of the same rows, not a different question for the server.
 *
 * Keys carry the range: two ranges are two cache entries, and a manual sync
 * invalidates the whole family by prefix.
 */

export const ftwKey = (from: string, to: string) =>
  ["fit-to-work", from, to] as const;

export const ftwQueryOptions = (from: string, to: string) =>
  queryOptions({
    queryKey: ftwKey(from, to),
    queryFn: () => unwrap(api.v1["fit-to-work"].get({ query: { from, to } })),
  });

export type FtwList = Awaited<
  ReturnType<NonNullable<ReturnType<typeof ftwQueryOptions>["queryFn"]>>
>;
export type FtwRow = FtwList["rows"][number];

export const attendanceKey = (from: string, to: string) =>
  ["attendance", from, to] as const;

export const attendanceQueryOptions = (from: string, to: string) =>
  queryOptions({
    queryKey: attendanceKey(from, to),
    queryFn: () => unwrap(api.v1.attendance.get({ query: { from, to } })),
  });

export type AttendanceList = Awaited<
  ReturnType<NonNullable<ReturnType<typeof attendanceQueryOptions>["queryFn"]>>
>;
export type AttendanceRow = AttendanceList["rows"][number];

/** One immediate pull from the source — the button beside the timeline. */
export const syncFtw = () => unwrap(api.v1["fit-to-work"].sync.post());
export const syncAttendance = () => unwrap(api.v1.attendance.sync.post());
