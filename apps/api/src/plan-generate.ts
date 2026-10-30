/**
 * PLAN Generate — spares onto the units nobody works today (owner, 2026-10-30).
 *
 * The PLAN tab's own fill, for the morning a unit's operator is on leave: it
 * pairs the shift's spares with its empty units, in the PLAN rather than on a
 * board. It is the engine's spare step without the readiness half — no FTW, no
 * finger — because it runs before either is known, and it writes standing
 * pairings that Reset takes back to the default once the operator returns.
 *
 * Pure: the routes load the units, holders and spares and write the answer.
 *
 * - **Shift** from the clock: before noon the day shift, after it the night.
 * - **Empty** is `vacantOn` on the web: in allocation, and no `aktif` holder
 *   rostered to the shift.
 * - **Spare**: no PLAN slot anywhere and rostered to the shift. Eligibility
 *   is `pairingRefusal` without the planning flag, so `aktif` only.
 * - **Order**: Prioritas Alokasi rank, unranked last, ties in the given
 *   (register `asc(code)`) order — the engine's own. Spares by NIK.
 * - **Full unit** (two holders, neither on the shift): one holder is released
 *   to make room — standby first, then one not working today, then one on the
 *   other shift, then the lower NIK.
 */

import { createHash } from "node:crypto";

import {
  rosterShift,
  type EmployeeStatus,
  type RosterCode,
  type ShiftKind,
} from "@universe/contracts";

import {
  FA_PLAN_MAX_OPS,
  pairingRefusal,
  type AllocPerson,
} from "./routes/fleet-allocation";

/** The hour the night shift's Generate begins, site-local. */
const NIGHT_FROM_HOUR = 12;

export type GenerateHolder = {
  employeeId: string;
  nik: string;
  name: string;
  status: EmployeeStatus;
  rosterCode: RosterCode | null;
};

/** A unit in allocation, with its standing holders. */
export type GenerateUnit = {
  id: string;
  code: string;
  simperCodeId: string | null;
  simperCodeName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  priority: number | null;
  holders: GenerateHolder[];
};

/** An allocatable operator with no PLAN slot. */
export type GenerateSpare = AllocPerson & {
  rosterCode: RosterCode | null;
  simperCodeIds: ReadonlySet<string>;
};

export type GenerateRelease = {
  employeeId: string;
  nik: string;
  name: string;
  rosterCode: RosterCode | null;
  standby: boolean;
};

export type GenerateAssignment = {
  unitId: string;
  unit: string;
  simperCode: string | null;
  priority: number | null;
  employeeId: string;
  nik: string;
  name: string;
  released: GenerateRelease | null;
};

export type GenerateUnfilled = {
  unitId: string;
  unit: string;
  simperCode: string | null;
  priority: number | null;
};

export type GenerateOutcome = {
  assign: GenerateAssignment[];
  unfilled: GenerateUnfilled[];
  sparesLeft: number;
};

/** The shift Generate fills, from the clock it was pressed at. */
export function generateShiftAt(now: Date): ShiftKind {
  return now.getHours() < NIGHT_FROM_HOUR ? "day" : "night";
}

const fillsSeat = (h: GenerateHolder, shift: ShiftKind) =>
  h.status === "aktif" && !!h.rosterCode && rosterShift(h.rosterCode) === shift;

/** 0 goes first: on light duty, then not working today, then the other shift. */
const releaseRank = (h: GenerateHolder) => {
  if (h.status !== "aktif") return 0;
  return h.rosterCode && rosterShift(h.rosterCode) ? 2 : 1;
};

function releaseOf(holders: GenerateHolder[]): GenerateRelease | null {
  if (holders.length < FA_PLAN_MAX_OPS) return null;
  const [out] = [...holders].sort(
    (a, b) => releaseRank(a) - releaseRank(b) || a.nik.localeCompare(b.nik)
  );
  if (!out) return null;
  return {
    employeeId: out.employeeId,
    nik: out.nik,
    name: out.name,
    rosterCode: out.rosterCode,
    standby: out.status === "standby",
  };
}

const byPriority = (units: GenerateUnit[]) => {
  const given = new Map(units.map((u, index) => [u.id, index]));
  return [...units].sort(
    (a, b) =>
      (a.priority ?? Number.MAX_SAFE_INTEGER) -
        (b.priority ?? Number.MAX_SAFE_INTEGER) ||
      given.get(a.id)! - given.get(b.id)!
  );
};

export function planGenerate(input: {
  units: GenerateUnit[];
  spares: GenerateSpare[];
  shift: ShiftKind;
  /** Site-local today, for the SIMPER expiry comparison. */
  today: string;
}): GenerateOutcome {
  const { shift, today } = input;
  const pool = input.spares
    .filter((s) => !!s.rosterCode && rosterShift(s.rosterCode) === shift)
    .sort((a, b) => a.nik.localeCompare(b.nik));
  const taken = new Set<string>();

  const assign: GenerateAssignment[] = [];
  const unfilled: GenerateUnfilled[] = [];

  const vacancies = byPriority(input.units).filter(
    (u) => !u.holders.some((h) => fillsSeat(h, shift))
  );
  for (const unit of vacancies) {
    const spare = pool.find(
      (s) =>
        !taken.has(s.id) &&
        pairingRefusal(unit, s, {
          holdsCode:
            !!unit.simperCodeId && s.simperCodeIds.has(unit.simperCodeId),
          today,
        }) === null
    );
    const facts = {
      unitId: unit.id,
      unit: unit.code,
      simperCode: unit.simperCodeName,
      priority: unit.priority,
    };
    if (!spare) {
      unfilled.push(facts);
      continue;
    }
    taken.add(spare.id);
    assign.push({
      ...facts,
      employeeId: spare.id,
      nik: spare.nik,
      name: spare.name,
      released: releaseOf(unit.holders),
    });
  }

  return { assign, unfilled, sparesLeft: pool.length - taken.size };
}

/**
 * A fingerprint of an outcome's pairings and releases, so the commit can
 * refuse to write anything other than what the dialog showed. Order-free:
 * the same pairings in another order are the same answer.
 */
export function generateToken(outcome: GenerateOutcome): string {
  const lines = outcome.assign
    .map((a) => `${a.unitId}|${a.employeeId}|${a.released?.employeeId ?? ""}`)
    .sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}
