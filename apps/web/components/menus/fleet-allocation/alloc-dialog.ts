/**
 * What the PLAN operator dialog shows of each candidate, kept apart from the
 * markup so it can be tested.
 */

export type SimperBadge = { name: string; match: boolean };

/**
 * An operator's SIMPER codes as the dialog lists them (owner, 2026-10-29): the
 * code this unit requires first, marked, then the rest in the server's order,
 * capped with a count of what did not fit. The unit's code leads so the
 * reason a row is selectable is the first thing read, and is never the one
 * pushed past the cap.
 */
export function simperBadges(
  codes: string[],
  unitCode: string | null | undefined,
  cap: number
): { shown: SimperBadge[]; more: number } {
  const held = !!unitCode && codes.includes(unitCode);
  const ordered: SimperBadge[] = [
    ...(held ? [{ name: unitCode, match: true }] : []),
    ...codes
      .filter((name) => !held || name !== unitCode)
      .map((name) => ({ name, match: false })),
  ];
  return {
    shown: ordered.slice(0, cap),
    more: Math.max(0, ordered.length - cap),
  };
}

export type DialogView = "eligible" | "all";

/**
 * Whether a candidate is listed under the dialog's current view.
 *
 * "Eligible" is staffing the shift running now (owner, 2026-10-29): only the
 * operators who may take the unit *and* are rostered to that shift. Opened at
 * 16:00 on a unit whose two holders work days, it lists who can cover the
 * night. Where the timeline cannot say which shift is running, the roster is
 * not guessed at and eligibility alone decides. "All" lists everybody, so a
 * standing pairing with someone off today can still be made.
 */
export function inDialogView(
  row: { eligible: boolean; onShift?: boolean },
  view: DialogView,
  shiftKnown: boolean
): boolean {
  if (view === "all") return true;
  if (!row.eligible) return false;
  return !shiftKnown || !!row.onShift;
}
