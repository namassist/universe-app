/**
 * How a booth's health (`apps/api/src/fingerprint-health.ts`) reads on screen.
 *
 * One table for the registry page and the monitoring wall, so the two can
 * never word the same booth differently. "Printer mati" is kept apart from
 * "Offline" on purpose: the machine still records the tap, and whoever walks
 * over needs to know it is the printer they are looking for.
 */

export type BoothHealth =
  | "ready"
  | "offline"
  | "printer_offline"
  | "printer_inactive"
  | "no_printer"
  | "unchecked";

type View = {
  label: string;
  /** A `Badge` variant. A setting (no printer, printer off) is amber; an outage is red. */
  variant: "success" | "danger" | "warning" | "neutral";
};

const VIEWS: Record<BoothHealth, View> = {
  ready: { label: "Siap", variant: "success" },
  offline: { label: "Offline", variant: "danger" },
  printer_offline: { label: "Printer mati", variant: "danger" },
  printer_inactive: { label: "Printer nonaktif", variant: "warning" },
  no_printer: { label: "Tanpa printer", variant: "warning" },
  /* Not yet probed — never called dead before anybody has asked. */
  unchecked: { label: "Belum dicek", variant: "neutral" },
};

export const boothHealthView = (health: BoothHealth): View => VIEWS[health];

/** Anything short of ready means a tap here does not become a slip. */
export const isBoothProblem = (health: BoothHealth): boolean =>
  health !== "ready";
