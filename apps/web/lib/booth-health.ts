import type { Dict } from "./i18n";

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
  /** Read through `t` — the same words on both screens, in either language. */
  label: keyof Dict;
  /** A `Badge` variant. A setting (no printer, printer off) is amber; an outage is red. */
  variant: "success" | "danger" | "warning" | "neutral";
};

const VIEWS: Record<BoothHealth, View> = {
  ready: { label: "bhReady", variant: "success" },
  offline: { label: "bhOffline", variant: "danger" },
  printer_offline: { label: "bhPrinterOff", variant: "danger" },
  printer_inactive: { label: "bhPrinterInactive", variant: "warning" },
  no_printer: { label: "bhNoPrinter", variant: "warning" },
  /* Not yet probed — never called dead before anybody has asked. */
  unchecked: { label: "bhUnchecked", variant: "neutral" },
};

export const boothHealthView = (health: BoothHealth): View => VIEWS[health];

/** Anything short of ready means a tap here does not become a slip. */
export const isBoothProblem = (health: BoothHealth): boolean =>
  health !== "ready";

/**
 * The registry page's readiness filter. "" is every machine.
 *
 * A dead machine and a dead printer are separate choices rather than one
 * "online on one side only": they send a technician to different devices. A
 * missing or switched-off printer is one choice — a setting, not an outage.
 */
export type ReadinessFilter =
  | ""
  | "ready"
  | "problem"
  | "offline"
  | "printer_offline"
  | "setting"
  | "unchecked";

export const READINESS_FILTERS: {
  value: ReadinessFilter;
  label: keyof Dict;
}[] = [
  { value: "ready", label: "bhReady" },
  { value: "problem", label: "bhfProblem" },
  { value: "offline", label: "bhfOffline" },
  { value: "printer_offline", label: "bhPrinterOff" },
  { value: "setting", label: "bhfSetting" },
  { value: "unchecked", label: "bhUnchecked" },
];

export function matchesReadiness(
  machine: { active: boolean; health: BoothHealth },
  filter: ReadinessFilter
): boolean {
  if (filter === "") return true;
  /* An inactive machine is not probed, so it has no readiness to match. */
  if (!machine.active) return false;
  switch (filter) {
    case "problem":
      return isBoothProblem(machine.health);
    case "setting":
      return (
        machine.health === "no_printer" || machine.health === "printer_inactive"
      );
    default:
      return machine.health === filter;
  }
}
