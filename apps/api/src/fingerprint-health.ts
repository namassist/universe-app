/**
 * Is this booth ready for a muster — can a tap here become a slip?
 *
 * One verdict, computed in one place, so the registry page, the monitoring
 * wall and the counts on top of it cannot disagree. The machine answering is
 * not enough: a tap at a machine whose printer is dead is recorded and the
 * slip never comes out, and every screen used to call that machine "online"
 * (2026-10-10). So the printer is half of the answer.
 *
 * Read from the prober's rows, never from a socket — the same rule as the
 * wall's machine status.
 */

export type BoothHealth =
  | "ready"
  | "offline"
  | "printer_offline"
  | "printer_inactive"
  | "no_printer"
  | "unchecked";

/** Worst first: the order the wall pins its problem cards in. */
export const BOOTH_HEALTH = [
  "offline",
  "printer_offline",
  "printer_inactive",
  "no_printer",
  "unchecked",
  "ready",
] as const satisfies readonly BoothHealth[];

/**
 * In order of what blocks a slip first: no machine, then no printer.
 *
 * "Unchecked" is kept apart from "offline": a device's `online` starts false,
 * so before its first probe it would read as dead. Right after machines were
 * switched on, every printer beside them said "Printer mati" for up to a
 * cycle (2026-10-10). Not yet asked is not the same as asked and silent.
 */
export function boothHealth(
  machine: { online: boolean; checkedAt: Date | null },
  printer: { active: boolean; online: boolean; checkedAt: Date | null } | null
): BoothHealth {
  if (machine.checkedAt === null) return "unchecked";
  if (!machine.online) return "offline";
  if (!printer) return "no_printer";
  /* `ticket-issue.ts` never prints to an inactive printer, so it is as
     unusable as a dead one — but it is a setting, not an outage. */
  if (!printer.active) return "printer_inactive";
  if (printer.checkedAt === null) return "unchecked";
  if (!printer.online) return "printer_offline";
  return "ready";
}
