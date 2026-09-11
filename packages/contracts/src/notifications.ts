/**
 * In-app notifications: what the application tells the people who run it.
 *
 * **Kinds and parameters, never sentences.** A notification stores what
 * happened and the few facts about it; the wording is the client's, in the
 * language that client is set to. Two reasons. Writing English copy into the
 * API to satisfy a language toggle puts presentation in the wrong layer — and
 * a stored "5 menit lalu" is a lie by the time anybody reads it, whereas a
 * timestamp stays true and the browser can say how long ago that was.
 *
 * **Never the raw error text.** A driver's own message routinely carries a
 * connection string, and a notification persists and is read again later by
 * whoever can see the page. So a failure names a cause from the closed list
 * below and the detail stays in the server log, where reading it already
 * requires access to the server.
 */

export const NOTIFICATION_KINDS = [
  "allocation-generated",
  "allocation-failed",
  "device-log-sizes",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** How loudly a notification presents itself. Presentation, not meaning. */
export const NOTIFICATION_TONES = [
  "info",
  "success",
  "warning",
  "danger",
] as const;
export type NotificationTone = (typeof NOTIFICATION_TONES)[number];

/**
 * Why a board could not be built — every reason the engine can actually give.
 *
 * The first three are misconfiguration and name the stage to go and fix. The
 * fourth is everything else: a thrown error, whose text belongs in the log and
 * not on a screen. It says where to look rather than what happened, which is
 * the honest thing to put in front of somebody who cannot act on the detail
 * anyway.
 */
export const ALLOCATION_FAILURES = [
  "no-shift",
  "no-finger-deadline",
  "no-ftw-deadline",
  "unexpected",
] as const;
export type AllocationFailure = (typeof ALLOCATION_FAILURES)[number];

export function isAllocationFailure(value: string): value is AllocationFailure {
  return (ALLOCATION_FAILURES as readonly string[]).includes(value);
}

/**
 * Which end of the muster a machine-size report describes.
 *
 * The machines are shared, and other services' record of the site's attendance
 * depends on their logs surviving. Reporting how much each machine was holding
 * when our collection started, and again when it stopped, is how a count that
 * fell in between becomes visible without watching continuously — and how the
 * question "what did you do to this machine" is answered with numbers from
 * both ends rather than a denial.
 */
export const DEVICE_REPORT_MOMENTS = ["start", "end"] as const;
export type DeviceReportMoment = (typeof DEVICE_REPORT_MOMENTS)[number];
