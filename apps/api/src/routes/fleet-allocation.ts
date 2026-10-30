/**
 * The PLAN board — standing unit ↔ operator pairings, served composed.
 *
 * A unit holds at most two operators, and they are a *shift pair*: one Day,
 * one Night. The pair is validated against the roster on the assignment date
 * — two operators the roster puts on the same shift cannot share a unit,
 * while an operator the roster does not know yet is allowed and flagged,
 * because a missing upload must not block the board from being built.
 *
 * Eligibility is the allocation engine's contract, applied at the pairing:
 * the operator's position enters fleet allocation (the flag the organisation
 * chain added for exactly this), the unit's qualification code — where it
 * has one — is among the operator's skills and their SIMPER is not expired,
 * and a unit a department owns takes only that department's operators. An
 * operator pairs with at most one unit; the unique index is the guarantee
 * and `busyAt` in the candidate list is its explanation.
 *
 * What this file deliberately is not: the ACTUAL generation. FTW and
 * fingerprint reads, spare FCFS substitution, and the per-shift document
 * belong to the engine behind `finger-ingest`/`spare-validate`, which stays
 * a no-op until those modules exist.
 */

import { and, asc, desc, eq, exists, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Elysia, t } from "elysia";
import {
  rosterCodeKind,
  rosterShift,
  type PlanDefaultInfo,
  type PlanHistoryAction,
  type PlanHistorySource,
  type PlanImportPreview,
  type PlanResetEntry,
  type PlanResetSkipped,
  type RosterCode,
  type UnitStatus,
} from "@universe/contracts";

import { requireAuth } from "../auth/macro";
import { currentShift } from "../current-shift";
import {
  db,
  isForeignKeyViolation,
  isUniqueViolation,
  schema,
  type Transaction,
} from "../db";
import { rosterDayInForce } from "../roster-in-force";
import { localDate } from "../scheduler";
import { normalizeNik } from "../sources/nik";
import { shiftGates } from "../stage-time";
import {
  buildPlanTemplate,
  pairingConflicts,
  validatePlanWorkbook,
  type ParsedPlanRow,
  type PlanCatalogues,
} from "./fleet-allocation-import";
import { MAX_IMPORT_BYTES } from "./import-columns";
import {
  ErrorSchema,
  PlanDefaultInfoSchema,
  PlanHistoryRowSchema,
  PlanImportPreviewSchema,
  PlanImportResultSchema,
  PlanResetPreviewSchema,
  PlanResetResultSchema,
  UnitStatusSchema,
} from "./schemas";
import { statusOf } from "./unit-status";

export const FA_PLAN_MAX_OPS = 2;

/** The advisory-lock key that serialises Reset, Generate and the default import. */
export const PLAN_DEFAULT_LOCK = 7_300_001;

const digger = alias(schema.units, "leader_unit");

/* ------------------------------------------------------------------ schemas */

const ShiftKindSchema = t.Nullable(
  t.Union([t.Literal("day"), t.Literal("night")])
);

const SlotSchema = t.Object({
  nik: t.String(),
  name: t.String(),
  simperTypeName: t.Nullable(t.String()),
  rosterShift: ShiftKindSchema,
  /** The operator's own department — not the unit's, which may differ. */
  departmentName: t.String(),
  /**
   * The roster code for today, as written: `D`, `N`, `CR`, `STB`, …
   *
   * `rosterShift` above says only whether that code is a working shift.
   * The crew list states the code itself, because "on leave" and "off" are
   * different answers to "why is this unit empty today".
   */
  rosterCode: t.Nullable(t.String()),
  /** The SIMPER codes this operator holds, by name — what a unit matches on. */
  skills: t.Array(t.String()),
  /**
   * On light duty: the plan may hold them (owner, 2026-09-23), the engine may
   * not seat them. The screen reads the unit as vacant on the strength of
   * this, whatever the roster says.
   */
  standby: t.Boolean(),
});

/**
 * One unit as the PLAN board reads it.
 *
 * Deliberately not the whole unit record: what a card carries is what someone
 * pairing an operator to a machine has to check — which machine, what permit it
 * takes, whose department owns it, which formation it runs in, and whether it
 * needs a Fit To Work.
 *
 * The work area is **not** here. It is a property of the fleet, identical for
 * every unit in one, and it used to be sent twice per unit (as `location` and
 * again inside `fleet`) so the card printed it twice. It now travels once, on
 * the `fleets` list below, where a screen states it for the whole formation.
 */
const BoardUnitSchema = t.Object({
  id: t.String(),
  code: t.String(),
  brandName: t.String(),
  status: UnitStatusSchema,
  /** Which permit this machine takes — the pairing's hard constraint. */
  simperCodeName: t.Nullable(t.String()),
  /** Whether its operator must clear Fit To Work before the shift. */
  requiresFtw: t.Boolean(),
  /** The owning department's name — null for a global unit. */
  departmentName: t.Nullable(t.String()),
  /**
   * Crewed without a formation — a dozer, a water truck, a spare digger.
   *
   * Separate from `fleet` being null, which on this board means several
   * different things: PLAN carries the whole active register, so a forklift
   * nobody crews is null here too.
   */
  fleetSupport: t.Boolean(),
  fleet: t.Nullable(t.Object({ id: t.String(), leaderCode: t.String() })),
  /**
   * In service. An inactive unit reaches this board only when the plan holds
   * somebody on it (owner, 2026-09-23) — the pairing has to be visible to be
   * released — and it is never counted as a vacancy.
   */
  active: t.Boolean(),
  slots: t.Array(SlotSchema),
});

const PlanBoardSchema = t.Object({
  units: t.Array(BoardUnitSchema),
  /** Each formation and the area it works — the one place the area is stated. */
  fleets: t.Array(
    t.Object({ id: t.String(), leaderCode: t.String(), area: t.String() })
  ),
  spares: t.Array(
    t.Object({
      nik: t.String(),
      name: t.String(),
      departmentName: t.String(),
      rosterShift: ShiftKindSchema,
      /** The roster code for today, as written — see `SlotSchema`. */
      rosterCode: t.Nullable(t.String()),
      /**
       * The SIMPER codes this operator holds, by name.
       *
       * The same fact the engine matches on, shown rather than left implicit:
       * a spare is only useful for a unit whose code they carry, and the pool
       * is browsed by someone deciding exactly that.
       */
      skills: t.Array(t.String()),
    })
  ),
  /** The date the roster was read for, `YYYY-MM-DD`. */
  date: t.String(),
});

const CandidateSchema = t.Object({
  nik: t.String(),
  name: t.String(),
  simperTypeName: t.Nullable(t.String()),
  departmentName: t.String(),
  rosterShift: ShiftKindSchema,
  eligible: t.Boolean(),
  /** The unit code holding this operator, when that is what blocks them. */
  busyAt: t.Nullable(t.String()),
  /** True when the unit's current partner works the same shift today. */
  sameShift: t.Boolean(),
  /** False when the unit belongs to a department this operator is not in. */
  deptOk: t.Boolean(),
  /** False when the unit requires a code the operator does not hold. */
  skillOk: t.Boolean(),
  /** True when the operator holds the code but their SIMPER has lapsed. */
  expired: t.Boolean(),
  /**
   * On light duty. Eligible for the plan (owner, 2026-09-23) and never seated
   * by the engine, so the dialog says so beside the name.
   */
  standby: t.Boolean(),
  /** Every SIMPER code the operator holds, by name. */
  simperCodes: t.Array(t.String()),
  /** The roster code on the shift's date; null when the sheet has no cell. */
  rosterCode: t.Nullable(t.String()),
  /** Rostered to the shift running now. False when the timeline cannot say. */
  onShift: t.Boolean(),
  /** The FTW category on the shift's date, as the FTW menu shows it; null
   *  when nothing was uploaded. */
  ftwCategory: t.Nullable(t.String()),
});

const CandidateListSchema = t.Object({
  /** The shift the dialog is about, from the timeline's `shift-start`; null
   *  when the timeline cannot decide. */
  shift: t.Nullable(
    t.Object({
      date: t.String(),
      shift: t.Union([t.Literal("day"), t.Literal("night")]),
    })
  ),
  candidates: t.Array(CandidateSchema),
});

/* ------------------------------------------------------------------ lookups */

/**
 * The roster code each of these employees carries on one date.
 *
 * The code itself, not what it means: a screen listing today's crew states
 * `CR` or `STB` as the roster states it, and `rosterShift` reduces the same
 * rows to the day/night the pairing rules ask about. One query serves both, so
 * the two can never disagree about what the roster says.
 */
export async function rosterCodesOf(
  employeeIds: string[],
  date: string
): Promise<Map<string, RosterCode>> {
  const map = new Map<string, RosterCode>();
  if (!employeeIds.length) return map;
  const rows = await db
    .select({
      employeeId: schema.rosterDays.employeeId,
      code: schema.rosterDays.code,
    })
    .from(schema.rosterDays)
    .where(
      and(
        eq(schema.rosterDays.date, date),
        inArray(schema.rosterDays.employeeId, employeeIds),
        rosterDayInForce
      )
    );
  for (const row of rows) map.set(row.employeeId, row.code);
  return map;
}

/**
 * The operators the plan may draw from: people whose position enters fleet
 * allocation, with what eligibility needs to know about each.
 *
 * `includeStandby` is the dialog's (owner, 2026-09-23): somebody on light duty
 * may be planned onto a unit, so they have to be offered. The spare pool keeps
 * to `aktif` — it answers "who could drive today", which is not the same
 * question.
 */
function allocatablePeople(includeStandby = false) {
  return db
    .select({
      id: schema.employees.id,
      nik: schema.employees.nik,
      name: schema.employees.name,
      departmentId: schema.employees.departmentId,
      departmentName: schema.departments.name,
      simperExp: schema.employees.simperExp,
      simperTypeName: schema.simperTypes.name,
      statusValue: schema.employees.status,
    })
    .from(schema.employees)
    .innerJoin(
      schema.positions,
      eq(schema.positions.id, schema.employees.positionId)
    )
    .innerJoin(
      schema.departments,
      eq(schema.departments.id, schema.employees.departmentId)
    )
    .leftJoin(
      schema.simperTypes,
      eq(schema.simperTypes.id, schema.employees.simperTypeId)
    )
    .where(
      and(
        includeStandby
          ? inArray(schema.employees.status, ["aktif", "standby"])
          : eq(schema.employees.status, "aktif"),
        eq(schema.positions.fleetAllocation, true)
      )
    )
    .orderBy(asc(schema.employees.name));
}

/**
 * employeeId → the SIMPER code *names* they hold, sorted.
 *
 * Names rather than ids because this leaves for a screen, and one query rather
 * than one per operator: the spare pool is the whole allocatable workforce.
 */
export async function skillNamesByEmployee(
  employeeIds: string[]
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (!employeeIds.length) return map;
  const rows = await db
    .select({
      employeeId: schema.employeeSkills.employeeId,
      name: schema.simperCodes.name,
    })
    .from(schema.employeeSkills)
    .innerJoin(
      schema.simperCodes,
      eq(schema.simperCodes.id, schema.employeeSkills.simperCodeId)
    )
    .where(inArray(schema.employeeSkills.employeeId, employeeIds))
    .orderBy(asc(schema.simperCodes.name));
  for (const row of rows) {
    const list = map.get(row.employeeId) ?? [];
    list.push(row.name);
    map.set(row.employeeId, list);
  }
  return map;
}

type SlotHolder = {
  employeeId: string;
  nik: string;
  name: string;
  simperTypeName: string | null;
  departmentName: string;
  /** On light duty — planned, but never seated by the engine. */
  standby: boolean;
};

/** unitId → slot holders, resolved for the board. */
async function slotsByUnit(): Promise<Map<string, SlotHolder[]>> {
  const rows = await db
    .select({
      unitId: schema.fleetPlanSlots.unitId,
      employeeId: schema.employees.id,
      nik: schema.employees.nik,
      name: schema.employees.name,
      simperTypeName: schema.simperTypes.name,
      departmentName: schema.departments.name,
      statusValue: schema.employees.status,
      createdAt: schema.fleetPlanSlots.createdAt,
    })
    .from(schema.fleetPlanSlots)
    .innerJoin(
      schema.employees,
      eq(schema.employees.id, schema.fleetPlanSlots.employeeId)
    )
    .innerJoin(
      schema.departments,
      eq(schema.departments.id, schema.employees.departmentId)
    )
    .leftJoin(
      schema.simperTypes,
      eq(schema.simperTypes.id, schema.employees.simperTypeId)
    )
    .orderBy(asc(schema.fleetPlanSlots.createdAt));
  const map = new Map<string, SlotHolder[]>();
  for (const row of rows) {
    const list = map.get(row.unitId) ?? [];
    list.push({
      employeeId: row.employeeId,
      nik: row.nik,
      name: row.name,
      simperTypeName: row.simperTypeName,
      departmentName: row.departmentName,
      standby: row.statusValue === "standby",
    });
    map.set(row.unitId, list);
  }
  return map;
}

const unitNotFound = {
  code: "unit_not_found",
  message: "Unit tidak ditemukan",
};

/** Whoever made a PLAN change, as the history keeps them. */
type PlanActor = { id: string; name: string } | null;

/* A device session never reaches a write route (the macro refuses it), so a
   null actor only ever means "not a person" rather than "unknown". */
export const planActorOf = (principal: {
  kind: string;
  id: string;
  name: string;
}): PlanActor =>
  principal.kind === "user" ? { id: principal.id, name: principal.name } : null;

type PlanChange = {
  unitId: string;
  employeeId: string;
  nik: string;
  name: string;
  action: PlanHistoryAction;
};

/**
 * Appends to `fleet_plan_history`, inside the caller's transaction — so a
 * pairing and its record commit or roll back together.
 */
export async function recordPlanChanges(
  tx: Transaction,
  changes: PlanChange[],
  source: Exclude<PlanHistorySource, "migration">,
  actor: PlanActor
) {
  if (!changes.length) return;
  await tx.insert(schema.fleetPlanHistory).values(
    changes.map((change) => ({
      ...change,
      source,
      actorUserId: actor?.id ?? null,
      actorName: actor?.name ?? null,
    }))
  );
}

/**
 * A unit as eligibility needs it, by code.
 *
 * Active only by default — a ticket or a board is about machines in service.
 * The PLAN passes `includeInactive` (owner, 2026-09-23): a machine out for
 * repair is still one somebody will crew when it returns, and planning that is
 * the point of the plan.
 */
export async function unitByCode(code: string, includeInactive = false) {
  const [unit] = await db
    .select({
      id: schema.units.id,
      code: schema.units.code,
      simperCodeId: schema.units.simperCodeId,
      simperCodeName: schema.simperCodes.name,
      departmentId: schema.units.departmentId,
      departmentName: schema.departments.name,
    })
    .from(schema.units)
    .leftJoin(
      schema.simperCodes,
      eq(schema.simperCodes.id, schema.units.simperCodeId)
    )
    .leftJoin(
      schema.departments,
      eq(schema.departments.id, schema.units.departmentId)
    )
    .where(
      and(
        eq(schema.units.code, code),
        ...(includeInactive ? [] : [eq(schema.units.active, true)])
      )
    )
    .limit(1);
  return unit;
}

export type AllocUnit = NonNullable<Awaited<ReturnType<typeof unitByCode>>>;

/** An operator as eligibility needs them, by NIK. */
export async function personByNik(nik: string) {
  const [person] = await db
    .select({
      id: schema.employees.id,
      nik: schema.employees.nik,
      name: schema.employees.name,
      statusValue: schema.employees.status,
      departmentId: schema.employees.departmentId,
      simperExp: schema.employees.simperExp,
      positionName: schema.positions.name,
      fleetAllocation: schema.positions.fleetAllocation,
    })
    .from(schema.employees)
    .innerJoin(
      schema.positions,
      eq(schema.positions.id, schema.employees.positionId)
    )
    .where(eq(schema.employees.nik, nik))
    .limit(1);
  return person;
}

export type AllocPerson = NonNullable<Awaited<ReturnType<typeof personByNik>>>;

/**
 * The eligibility rules, worded once — and *only* once.
 *
 * Pure, over data the caller has already loaded, because there are now two
 * kinds of caller with opposite shapes. The single-slot route and the
 * spreadsheet import ask about one pairing and are happy to fetch as they go
 * (`refusePairing` below wraps this for them). The allocation engine asks
 * about vacancies × spares — thousands of pairings in one pass — and a query
 * per question would be an N+1 in the one code path that runs against the
 * clock, minutes before a bus leaves.
 *
 * The alternative was a second copy of the rules written for bulk. Two
 * implementations of one rule drift, and the drift shows up as an operator who
 * may be paired by hand but never by the engine, which reads as a bug in
 * neither place.
 *
 * Returns the refusal message, or null when the pairing is sound.
 *
 * The message names the *unit's* requirement and nothing about the person
 * (owner, 2026-09-02). Every caller already has them: the picker dialog puts
 * the name in the first column of the same row, the import report carries `nik`
 * and `emp` as their own fields beside the issue, and the single-slot route
 * answers a supervisor who chose that operator a second earlier. Repeating it
 * inside the sentence only widened a badge that has to sit in a table cell.
 *
 * Short for the same reason. The advice these used to end with — "tandai
 * posisinya di master Posisi", "perpanjang dulu" — is a thing to do about the
 * refusal rather than the refusal itself, and it was being read in a place with
 * no room for it.
 */
export function pairingRefusal(
  unit: AllocUnit,
  person: AllocPerson,
  facts: {
    /** Whether the person holds the unit's required SIMPER code. */
    holdsCode: boolean;
    /** Site-local today, for the SIMPER expiry comparison. */
    today: string;
    /**
     * Whether this is the standing PLAN rather than a seat on a board.
     *
     * The plan records an intention — who holds which machine when both are
     * in service — so it admits a `standby` operator (owner, 2026-09-23):
     * somebody on light duty keeps their unit on paper, and the engine, which
     * draws only from `aktif`, is what leaves the seat empty on the day. A
     * board, a ticket and a manual intervention are about today and keep the
     * stricter rule.
     */
    planning?: boolean;
  }
): string | null {
  /* `nonaktif` is refused everywhere: they have left. `standby` is refused on
     a board and allowed in the plan — see `facts.planning`. */
  if (
    person.statusValue === "nonaktif" ||
    (!facts.planning && person.statusValue !== "aktif")
  )
    return `Karyawan berstatus ${person.statusValue} — hanya karyawan aktif yang masuk alokasi`;
  if (!person.fleetAllocation)
    return `Posisi "${person.positionName}" tidak masuk alokasi fleet`;
  if (unit.departmentId && person.departmentId !== unit.departmentId)
    return `Beda departemen — unit ini milik "${unit.departmentName}"`;
  if (unit.simperCodeId) {
    if (!facts.holdsCode) return `Tidak punya SIMPER "${unit.simperCodeName}"`;
    if (person.simperExp !== null && person.simperExp < facts.today)
      return `SIMPER kedaluwarsa ${person.simperExp}`;
  }
  return null;
}

/**
 * `pairingRefusal` for one PLAN pairing, fetching the SIMPER fact it needs.
 * Both its callers — the dialog and the spreadsheet import — are planning.
 */
export async function refusePairing(
  unit: AllocUnit,
  person: AllocPerson
): Promise<string | null> {
  let holdsCode = false;
  if (unit.simperCodeId) {
    const [skill] = await db
      .select({ employeeId: schema.employeeSkills.employeeId })
      .from(schema.employeeSkills)
      .where(
        and(
          eq(schema.employeeSkills.employeeId, person.id),
          eq(schema.employeeSkills.simperCodeId, unit.simperCodeId)
        )
      )
      .limit(1);
    holdsCode = !!skill;
  }
  return pairingRefusal(unit, person, {
    holdsCode,
    today: localDate(new Date()),
    planning: true,
  });
}

/* -------------------------------------------------------------- import */

/** One pairing of the saved default, as stored. */
type DefaultRow = {
  unitId: string;
  unitCode: string;
  employeeId: string | null;
  nik: string;
  name: string;
};

/** The saved default's pairings, from `runner` (the db or a transaction). */
async function loadDefaultRows(
  runner: Pick<typeof db, "select"> = db
): Promise<DefaultRow[]> {
  return runner
    .select({
      unitId: schema.fleetPlanDefaults.unitId,
      unitCode: schema.units.code,
      employeeId: schema.fleetPlanDefaults.employeeId,
      nik: schema.fleetPlanDefaults.nik,
      name: schema.fleetPlanDefaults.name,
    })
    .from(schema.fleetPlanDefaults)
    .innerJoin(
      schema.units,
      eq(schema.units.id, schema.fleetPlanDefaults.unitId)
    )
    .orderBy(asc(schema.units.code), asc(schema.fleetPlanDefaults.nik));
}

/**
 * The saved default's description: the newest import row, with the pairings it
 * left. Null until the first import after the feature shipped.
 */
async function savedDefaultInfo(
  runner: Pick<typeof db, "select"> = db
): Promise<PlanDefaultInfo | null> {
  const [latest] = await runner
    .select({
      id: schema.fleetPlanDefaultImports.id,
      fileName: schema.fleetPlanDefaultImports.fileName,
      actorName: schema.fleetPlanDefaultImports.actorName,
      createdAt: schema.fleetPlanDefaultImports.createdAt,
    })
    .from(schema.fleetPlanDefaultImports)
    .orderBy(desc(schema.fleetPlanDefaultImports.createdAt))
    .limit(1);
  if (!latest) return null;
  const [{ pairs } = { pairs: 0 }] = await runner
    .select({ pairs: sql<number>`count(*)::int` })
    .from(schema.fleetPlanDefaults)
    .where(eq(schema.fleetPlanDefaults.importId, latest.id));
  return {
    fileName: latest.fileName,
    actorName: latest.actorName,
    createdAt: latest.createdAt.toISOString(),
    pairs,
  };
}

/** Everything the parser needs to resolve codes and read the saved default. */
async function planCatalogues(
  defaultRows: DefaultRow[]
): Promise<PlanCatalogues> {
  /* Inactive units included (owner, 2026-09-23): the plan may hold a machine
     that is out of service, and the board shows that pairing rather than
     hiding it. */
  const units = await db
    .select({ id: schema.units.id, code: schema.units.code })
    .from(schema.units);
  const people = await db
    .select({
      id: schema.employees.id,
      nik: schema.employees.nik,
      name: schema.employees.name,
    })
    .from(schema.employees);

  return {
    unitsByCode: new Map(units.map((u) => [u.code.toLowerCase(), u])),
    peopleByNik: new Map(people.map((p) => [p.nik, p])),
    defaultOf: new Map(
      defaultRows.flatMap((d) =>
        d.employeeId
          ? [
              [
                d.employeeId,
                { unitId: d.unitId, unitCode: d.unitCode },
              ] as const,
            ]
          : []
      )
    ),
  };
}

type PlanImportOutcome = {
  preview: PlanImportPreview;
  rows: ParsedPlanRow[];
};

/**
 * Parse, hold every surviving row against `refusePairing` — the same
 * function the dialog goes through — then judge capacity within the file
 * alone. Kinds and `removed` are relative to the saved default, never the
 * live plan. The Day/Night pair left this path on 2026-09-23.
 */
async function parsePlanImport(
  file: File
): Promise<PlanImportOutcome | { code: string; message: string }> {
  const defaultRows = await loadDefaultRows();
  const catalogues = await planCatalogues(defaultRows);
  const parsed = await validatePlanWorkbook(
    await file.arrayBuffer(),
    catalogues
  );
  if ("code" in parsed) return parsed;

  const errors = [...parsed.errors];
  const eligible: ParsedPlanRow[] = [];
  for (const row of parsed.rows) {
    const unit = await unitByCode(row.preview.unit, true);
    const person = await personByNik(row.preview.nik);
    // Both resolved a moment ago in the parse; vanishing between the two
    // reads is a re-validate case, not a crash.
    if (!unit || !person) continue;
    const refusal = await refusePairing(unit, person);
    if (refusal) {
      errors.push({
        row: String(row.preview.row),
        nik: row.preview.nik,
        emp: row.preview.name,
        issue: refusal,
        badgeVariant: "danger",
        badge: "Error",
      });
      continue;
    }
    eligible.push(row);
  }

  const conflicts = pairingConflicts(eligible);
  errors.push(...conflicts.errors);
  errors.sort((a, b) => Number(a.row) - Number(b.row));

  const rows = conflicts.rows;
  // A default pairing is "named" by any row about that NIK, even a refused
  // one: the file spoke of it, so it is not silently dropped.
  const named = new Set([
    ...parsed.rows.map((r) => r.preview.nik),
    ...parsed.errors.map((e) => e.nik),
    ...errors.map((e) => e.nik),
  ]);
  const removed = defaultRows
    .filter((d) => !named.has(d.nik))
    .map((d) => ({ unit: d.unitCode, nik: d.nik, name: d.name }));
  return {
    preview: {
      fileName: file.name,
      newCount: rows.filter((r) => r.preview.kind === "new").length,
      movedCount: rows.filter((r) => r.preview.kind === "moved").length,
      unchangedCount: rows.filter((r) => r.preview.kind === "unchanged").length,
      removedCount: removed.length,
      errorCount: errors.length,
      rows: rows.map((r) => r.preview),
      removed,
      errors,
    },
    rows,
  };
}

/* ---------------------------------------------------------------- reset */

type Reader = Pick<typeof db, "select">;

/** A live pairing, with what a release needs to write and record. */
type LivePairing = PlanResetEntry & {
  slotId: string;
  unitId: string;
  employeeId: string;
};

type ResetDiff = {
  release: LivePairing[];
  assign: (PlanResetEntry & { unitId: string; employeeId: string })[];
  skipped: PlanResetSkipped[];
  unchanged: number;
  /** Every unit either plan names, for the caller to lock. */
  unitIds: string[];
};

/** The longest import file name kept for the toolbar's default line. */
const MAX_FILE_NAME = 255;

const EMPLOYEE_DELETED = "Karyawan sudah dihapus dari data karyawan";

/**
 * Live plan versus saved default, as Reset would apply it.
 *
 * Eligibility goes through `pairingRefusal` with the planning flag, the same
 * function the dialog and the import use, so what Reset may seat cannot drift
 * from what a hand-made pairing may. Everything is loaded in bulk (the default
 * can be a few hundred pairings) and the rule itself stays pure.
 *
 * A live pairing that is already in the default stands untouched even if it
 * would be refused today: Reset restores the default, it does not audit it.
 * Every other live pairing is released, which is also what keeps two operators
 * per unit true — the default holds at most two per unit and nothing else
 * remains.
 */
async function resetDiff(reader: Reader): Promise<ResetDiff> {
  const defaults = await loadDefaultRows(reader);
  const live: LivePairing[] = await reader
    .select({
      slotId: schema.fleetPlanSlots.id,
      unitId: schema.fleetPlanSlots.unitId,
      employeeId: schema.fleetPlanSlots.employeeId,
      unit: schema.units.code,
      nik: schema.employees.nik,
      name: schema.employees.name,
    })
    .from(schema.fleetPlanSlots)
    .innerJoin(schema.units, eq(schema.units.id, schema.fleetPlanSlots.unitId))
    .innerJoin(
      schema.employees,
      eq(schema.employees.id, schema.fleetPlanSlots.employeeId)
    )
    .orderBy(asc(schema.units.code), asc(schema.employees.nik));

  const liveUnitOf = new Map(live.map((l) => [l.employeeId, l.unitId]));
  const defaultUnitOf = new Map(
    defaults.flatMap((d) => (d.employeeId ? [[d.employeeId, d.unitId]] : []))
  );

  const release = live.filter(
    (l) => defaultUnitOf.get(l.employeeId) !== l.unitId
  );
  const unchanged = live.length - release.length;
  const toMake = defaults.filter(
    (d) => !d.employeeId || liveUnitOf.get(d.employeeId) !== d.unitId
  );

  const employeeIds = toMake.flatMap((d) =>
    d.employeeId ? [d.employeeId] : []
  );
  const unitIds = [...new Set(toMake.map((d) => d.unitId))];
  const unitRows = unitIds.length
    ? await reader
        .select({
          id: schema.units.id,
          code: schema.units.code,
          simperCodeId: schema.units.simperCodeId,
          simperCodeName: schema.simperCodes.name,
          departmentId: schema.units.departmentId,
          departmentName: schema.departments.name,
        })
        .from(schema.units)
        .leftJoin(
          schema.simperCodes,
          eq(schema.simperCodes.id, schema.units.simperCodeId)
        )
        .leftJoin(
          schema.departments,
          eq(schema.departments.id, schema.units.departmentId)
        )
        .where(inArray(schema.units.id, unitIds))
    : [];
  const personRows = employeeIds.length
    ? await reader
        .select({
          id: schema.employees.id,
          nik: schema.employees.nik,
          name: schema.employees.name,
          statusValue: schema.employees.status,
          departmentId: schema.employees.departmentId,
          simperExp: schema.employees.simperExp,
          positionName: schema.positions.name,
          fleetAllocation: schema.positions.fleetAllocation,
        })
        .from(schema.employees)
        .innerJoin(
          schema.positions,
          eq(schema.positions.id, schema.employees.positionId)
        )
        .where(inArray(schema.employees.id, employeeIds))
    : [];
  const skillRows = employeeIds.length
    ? await reader
        .select({
          employeeId: schema.employeeSkills.employeeId,
          simperCodeId: schema.employeeSkills.simperCodeId,
        })
        .from(schema.employeeSkills)
        .where(inArray(schema.employeeSkills.employeeId, employeeIds))
    : [];
  const unitById = new Map(unitRows.map((u) => [u.id, u]));
  const personById = new Map(personRows.map((p) => [p.id, p]));
  const skills = new Set(
    skillRows.map((k) => `${k.employeeId}:${k.simperCodeId}`)
  );
  const today = localDate(new Date());

  const assign: ResetDiff["assign"] = [];
  const skipped: PlanResetSkipped[] = [];
  for (const d of toMake) {
    const entry = { unit: d.unitCode, nik: d.nik, name: d.name };
    const unit = unitById.get(d.unitId);
    const person = d.employeeId ? personById.get(d.employeeId) : undefined;
    if (!d.employeeId || !person || !unit) {
      skipped.push({ ...entry, reason: EMPLOYEE_DELETED });
      continue;
    }
    const reason = pairingRefusal(unit, person, {
      holdsCode:
        !!unit.simperCodeId && skills.has(`${person.id}:${unit.simperCodeId}`),
      today,
      planning: true,
    });
    if (reason) skipped.push({ ...entry, reason });
    else assign.push({ ...entry, unitId: d.unitId, employeeId: d.employeeId });
  }

  return {
    release,
    assign,
    skipped,
    unchanged,
    unitIds: [
      ...new Set([
        ...live.map((l) => l.unitId),
        ...defaults.map((d) => d.unitId),
      ]),
    ],
  };
}

const entryOf = (e: PlanResetEntry): PlanResetEntry => ({
  unit: e.unit,
  nik: e.nik,
  name: e.name,
});

const noDefault = {
  code: "no_default",
  message: "Belum ada default PLAN — unggah file PLAN dulu",
};

/**
 * A conflict the commit's own recheck finds under lock — the race between
 * validation's read and the write. Thrown to roll the transaction back.
 */
class PlanImportConflict extends Error {
  constructor(
    readonly httpStatus: 409 | 422,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export const fleetAllocationRoutes = new Elysia({
  prefix: "/fleet-allocation",
  tags: ["fleet-allocation"],
})
  .use(requireAuth)

  .get(
    "/plan",
    async () => {
      const today = localDate(new Date());

      const unitRows = await db
        .select({
          id: schema.units.id,
          code: schema.units.code,
          brandName: schema.unitBrands.name,
          simperCodeName: schema.simperCodes.name,
          requiresFtw: schema.units.ftw,
          standby: schema.units.standby,
          breakdown: schema.units.breakdown,
          /* Crewed without a formation. The board carries the whole register,
             so "no fleet" here already meant several different things; this is
             what separates a dozer somebody has to crew from a forklift nobody
             does. */
          fleetSupport: schema.units.fleetSupport,
          active: schema.units.active,
          fleetId: schema.fleets.id,
          leaderCode: digger.code,
          departmentName: schema.departments.name,
        })
        .from(schema.units)
        .innerJoin(
          schema.unitBrands,
          eq(schema.unitBrands.id, schema.units.brandId)
        )
        .leftJoin(
          schema.simperCodes,
          eq(schema.simperCodes.id, schema.units.simperCodeId)
        )
        .leftJoin(
          schema.departments,
          eq(schema.departments.id, schema.units.departmentId)
        )
        .leftJoin(
          schema.fleetUnits,
          eq(schema.fleetUnits.unitId, schema.units.id)
        )
        .leftJoin(
          schema.fleets,
          or(
            eq(schema.fleets.leaderUnitId, schema.units.id),
            eq(schema.fleets.id, schema.fleetUnits.fleetId)
          )
        )
        .leftJoin(digger, eq(digger.id, schema.fleets.leaderUnitId))
        /*
         * The PLAN board carries the whole active register, formation or not
         * (owner, 2026-08-31).
         *
         * PLAN and the engine deliberately have *different* scopes, and the
         * difference is the point. A standing pairing is a fact about a person
         * and a machine — "operator A holds 4019" — and it is true whether or
         * not 4019 is in a formation today. Automatic allocation is a
         * different question, and it answers only about formations.
         *
         * So an operator whose standing unit has no formation is not left out:
         * their pairing is recorded here, and on the board they fall into the
         * **spare pool**, because `buildBoard` scopes `planned` to formations
         * and so never counts them as holding a slot. An operator whose unit
         * *is* in a formation keeps it first, before any spare is offered
         * anything. Both still follow the roster, which is what decides who is
         * a candidate at all.
         *
         * The filter is what keeps this readable: it shows one formation at a
         * time, with the no-fleet entry as its own option, so the register
         * being large costs nothing until somebody asks for it.
         */
        /* The active register, plus any unit the plan still holds somebody on
           (owner, 2026-09-23). A machine taken out of service keeps its
           standing pairing until somebody releases it, and a pairing nobody
           can see is one nobody can release. */
        .where(
          or(
            eq(schema.units.active, true),
            exists(
              db
                .select({ one: sql`1` })
                .from(schema.fleetPlanSlots)
                .where(eq(schema.fleetPlanSlots.unitId, schema.units.id))
            )
          )
        )
        .orderBy(asc(schema.units.code));

      const slots = await slotsByUnit();

      const people = await allocatablePeople();
      const paired = new Set(
        [...slots.values()].flatMap((list) => list.map((s) => s.employeeId))
      );
      const spares = people.filter((p) => !paired.has(p.id));

      /* Everybody the board can name, paired or not: the crew list below the
         board is one table over both halves, so it reads the roster and the
         permits for both in one pass rather than twice with two answers. */
      const everyone = [...paired, ...spares.map((s) => s.id)];
      const codes = await rosterCodesOf(everyone, today);
      const kinds = new Map<string, "day" | "night">();
      for (const [id, code] of codes) {
        const kind = rosterCodeKind(code);
        if (kind === "day" || kind === "night") kinds.set(id, kind);
      }
      const skills = await skillNamesByEmployee(everyone);

      /* The area rides with the formation, not with each of its units: it is
         one value for the whole fleet, and sending it per unit is what had the
         card printing it twice. Stored on the leader since 2026-09-04, with
         every member held to the same value on write. */
      const fleetRows = await db
        .select({
          id: schema.fleets.id,
          leaderCode: digger.code,
          area: digger.workArea,
        })
        .from(schema.fleets)
        .innerJoin(digger, eq(digger.id, schema.fleets.leaderUnitId))
        .orderBy(asc(digger.code));

      return {
        units: unitRows.map((u) => ({
          id: u.id,
          code: u.code,
          brandName: u.brandName,
          status: statusOf(u) as UnitStatus,
          simperCodeName: u.simperCodeName,
          requiresFtw: u.requiresFtw,
          departmentName: u.departmentName,
          fleetSupport: u.fleetSupport,
          fleet:
            u.fleetId && u.leaderCode
              ? { id: u.fleetId, leaderCode: u.leaderCode }
              : null,
          active: u.active,
          slots: (slots.get(u.id) ?? []).map((s) => ({
            nik: s.nik,
            name: s.name,
            simperTypeName: s.simperTypeName,
            rosterShift: kinds.get(s.employeeId) ?? null,
            departmentName: s.departmentName,
            rosterCode: codes.get(s.employeeId) ?? null,
            skills: skills.get(s.employeeId) ?? [],
            standby: s.standby,
          })),
        })),
        fleets: fleetRows.map((f) => ({ ...f, area: f.area ?? "" })),
        spares: spares.map((s) => ({
          nik: s.nik,
          name: s.name,
          departmentName: s.departmentName,
          rosterShift: kinds.get(s.id) ?? null,
          rosterCode: codes.get(s.id) ?? null,
          skills: skills.get(s.id) ?? [],
        })),
        /* The date the roster was read for. Stated rather than assumed: this
           board changes at midnight, and a tab left open overnight would
           otherwise present yesterday's crew as today's. */
        date: today,
      };
    },
    {
      auth: { menu: "fleet-allocation", mode: "view" },
      response: {
        200: PlanBoardSchema,
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: { summary: "The PLAN board, composed — units, pairs, spares" },
    }
  )

  .get(
    "/plan/candidates",
    async ({ query, status }) => {
      const unit = await unitByCode(query.unit, true);
      if (!unit) return status(404, unitNotFound);
      /* The shift the admin is staffing, on the boundary the walls turn over
         on (owner, 2026-10-29): `shift-start`, not noon. Before the day gate
         that is yesterday's night, so the roster and the FTW are read for the
         shift's date rather than the calendar's. */
      const now = new Date();
      const today = localDate(now);
      const shift = currentShift(now, await shiftGates());
      const date = shift?.date ?? today;

      const people = await allocatablePeople(true);

      // What blocks or clears each candidate, resolved in bulk: the unit the
      // plan already gave them, the skill the unit requires, and their shift
      // on the shift's date beside the current partner's.
      const busyRows = await db
        .select({
          employeeId: schema.fleetPlanSlots.employeeId,
          unitId: schema.fleetPlanSlots.unitId,
          code: schema.units.code,
        })
        .from(schema.fleetPlanSlots)
        .innerJoin(
          schema.units,
          eq(schema.units.id, schema.fleetPlanSlots.unitId)
        );
      const busyAt = new Map(busyRows.map((r) => [r.employeeId, r.code]));

      const skilled = unit.simperCodeId
        ? new Set(
            (
              await db
                .select({ employeeId: schema.employeeSkills.employeeId })
                .from(schema.employeeSkills)
                .where(
                  eq(schema.employeeSkills.simperCodeId, unit.simperCodeId)
                )
            ).map((r) => r.employeeId)
          )
        : null;

      const ids = people.map((p) => p.id);
      const [codes, skills, ftwRows] = await Promise.all([
        rosterCodesOf(ids, date),
        skillNamesByEmployee(ids),
        people.length
          ? db
              .select({
                nik: schema.ftwReadings.nik,
                category: schema.ftwReadings.sleepCategory,
              })
              .from(schema.ftwReadings)
              .where(
                and(
                  eq(schema.ftwReadings.date, date),
                  inArray(
                    schema.ftwReadings.nik,
                    people.map((p) => normalizeNik(p.nik))
                  )
                )
              )
          : [],
      ]);
      const ftwByNik = new Map(ftwRows.map((r) => [r.nik, r.category]));
      const kinds = new Map<string, "day" | "night">();
      for (const [id, code] of codes) {
        const kind = rosterShift(code);
        if (kind) kinds.set(id, kind);
      }
      const partnerKinds = busyRows
        .filter((r) => r.unitId === unit.id)
        .map((r) => kinds.get(r.employeeId))
        .filter((k): k is "day" | "night" => k !== undefined);

      const candidates = people.map((p) => {
        const busy = busyAt.get(p.id) ?? null;
        const kind = kinds.get(p.id) ?? null;
        const sameShift = kind !== null && partnerKinds.includes(kind);
        const skillOk = skilled === null || skilled.has(p.id);
        const expired =
          skilled !== null &&
          skillOk &&
          p.simperExp !== null &&
          p.simperExp < today;
        const deptOk =
          unit.departmentId === null || p.departmentId === unit.departmentId;
        return {
          nik: p.nik,
          name: p.name,
          simperTypeName: p.simperTypeName,
          departmentName: p.departmentName,
          rosterShift: kind,
          /* `sameShift` no longer blocks (owner, 2026-09-23): the plan may
             pair two operators of one shift, and the flag stays as something
             the dialog states beside them. */
          eligible: !busy && skillOk && !expired && deptOk,
          busyAt: busy,
          sameShift,
          deptOk,
          skillOk,
          expired,
          standby: p.statusValue === "standby",
          simperCodes: skills.get(p.id) ?? [],
          rosterCode: codes.get(p.id) ?? null,
          onShift: shift !== null && kind === shift.shift,
          ftwCategory: ftwByNik.get(normalizeNik(p.nik)) ?? null,
        };
      });
      return { shift, candidates };
    },
    {
      auth: { menu: "fleet-allocation", mode: "view" },
      query: t.Object({ unit: t.String({ minLength: 1 }) }),
      response: {
        200: CandidateListSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
      },
      detail: { summary: "Who may be paired with this unit, and why not" },
    }
  )

  /* -------------------------------------------------------------- import */

  .get(
    "/plan/import/template",
    async ({ set }) => {
      set.headers["content-type"] =
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      set.headers["content-disposition"] =
        'attachment; filename="template_plan.xlsx"';
      return new Response(new Uint8Array(await buildPlanTemplate()));
    },
    {
      auth: { menu: "fleet-allocation", mode: "manage" },
      // Described by hand rather than with a `response` schema: the body is a
      // binary workbook, and a TypeBox schema would try to validate it.
      detail: {
        summary: "Download the PLAN import template (.xlsx)",
        responses: {
          200: {
            description: "An .xlsx with the columns unit, nik",
            content: {
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
                { schema: { type: "string", format: "binary" } },
            },
          },
          401: { description: "No session" },
          403: { description: "Lacks manage on the fleet-allocation menu" },
        },
      },
    }
  )

  .post(
    "/plan/import/validate",
    async ({ body, status }) => {
      const outcome = await parsePlanImport(body.file);
      if ("code" in outcome) return status(422, outcome);
      return outcome.preview;
    },
    {
      auth: { menu: "fleet-allocation", mode: "manage" },
      body: t.Object({ file: t.File({ maxSize: MAX_IMPORT_BYTES }) }),
      response: {
        200: PlanImportPreviewSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        422: ErrorSchema,
      },
      detail: {
        summary: "Validate a PLAN spreadsheet and preview the pairings",
      },
    }
  )

  .post(
    "/plan/import/commit",
    async ({ body, status, principal }) => {
      // Re-validated rather than trusted from the client: the preview the
      // caller saw is advisory, this parse is what gets saved.
      const outcome = await parsePlanImport(body.file);
      if ("code" in outcome) return status(422, outcome);
      if (outcome.preview.errorCount > 0)
        return status(422, {
          code: "validation_failed",
          message: `${outcome.preview.errorCount} baris masih bermasalah`,
        });
      // An empty file would silently clear the default; that is not an
      // import, and there is no other way to say "no pairings" on purpose.
      if (!outcome.rows.length)
        return status(422, {
          code: "empty_plan",
          message: "File tidak berisi pasangan unit-operator",
        });

      const actor = planActorOf(principal);
      try {
        await db.transaction(async (tx) => {
          // Serialises with Reset (and another import) on the default itself;
          // a plain row lock cannot, because this replaces every row.
          await tx.execute(
            sql`select pg_advisory_xact_lock(${PLAN_DEFAULT_LOCK})`
          );
          await tx.delete(schema.fleetPlanDefaults);
          const [saved] = await tx
            .insert(schema.fleetPlanDefaultImports)
            .values({
              // Shown on the toolbar; a name past this is noise, not a name.
              fileName: body.file.name.slice(0, MAX_FILE_NAME),
              actorUserId: actor?.id ?? null,
              actorName: actor?.name ?? null,
            })
            .returning({ id: schema.fleetPlanDefaultImports.id });
          await tx.insert(schema.fleetPlanDefaults).values(
            outcome.rows.map((r) => ({
              importId: saved!.id,
              unitId: r.unitId,
              employeeId: r.employeeId,
              nik: r.preview.nik,
              name: r.preview.name,
            }))
          );
        });
      } catch (error) {
        // The race the validation cannot see: the same operator twice is
        // refused in the parse, so this is a belt over the unique index.
        if (isUniqueViolation(error, "fleet_plan_defaults_employee_idx"))
          return status(409, {
            code: "operator_duplicated",
            message:
              "Seorang operator muncul dua kali — validasi ulang filenya",
          });
        // A unit or employee removed between the parse and this write.
        if (isForeignKeyViolation(error))
          return status(409, {
            code: "plan_changed",
            message:
              "Unit atau karyawan di file berubah saat disimpan — validasi ulang filenya",
          });
        throw error;
      }

      const { preview } = outcome;
      return {
        pairs: outcome.rows.length,
        created: preview.newCount,
        moved: preview.movedCount,
        removed: preview.removedCount,
      };
    },
    {
      auth: { menu: "fleet-allocation", mode: "manage" },
      body: t.Object({ file: t.File({ maxSize: MAX_IMPORT_BYTES }) }),
      response: {
        200: PlanImportResultSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        409: ErrorSchema,
        422: ErrorSchema,
      },
      detail: {
        summary:
          "Commit a validated PLAN spreadsheet as the saved default (the live plan is untouched)",
      },
    }
  )

  .get(
    "/plan/default",
    // `Response.json` because Elysia sends a bare `null` as an empty body,
    // which no client can parse; this keeps "no default" a real JSON value.
    async () => Response.json(await savedDefaultInfo()),
    {
      auth: { menu: "fleet-allocation", mode: "view" },
      response: {
        200: t.Nullable(PlanDefaultInfoSchema),
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: {
        summary: "The saved default PLAN: file, who, when, pairings (or null)",
      },
    }
  )

  .get(
    "/plan/reset/preview",
    async ({ status }) => {
      const defaultInfo = await savedDefaultInfo();
      if (!defaultInfo) return status(409, noDefault);
      const diff = await resetDiff(db);
      return {
        release: diff.release.map(entryOf),
        assign: diff.assign.map(entryOf),
        skipped: diff.skipped,
        unchanged: diff.unchanged,
        defaultInfo,
      };
    },
    {
      auth: { menu: "fleet-allocation", mode: "view" },
      response: {
        200: PlanResetPreviewSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        409: ErrorSchema,
      },
      detail: {
        summary:
          "What Reset would do: live PLAN versus the saved default (409 no_default when none)",
      },
    }
  )

  .post(
    "/plan/reset",
    async ({ status, principal }) => {
      const actor = planActorOf(principal);
      try {
        return await db.transaction(async (tx) => {
          await tx.execute(
            sql`select pg_advisory_xact_lock(${PLAN_DEFAULT_LOCK})`
          );
          if (!(await savedDefaultInfo(tx)))
            throw new PlanImportConflict(
              409,
              noDefault.code,
              noDefault.message
            );

          // Lock first, diff second: every unit either plan names, in one
          // sorted set (same discipline as the old import commit), so the
          // dialog cannot slip a write between the read and the writes.
          const { unitIds } = await resetDiff(tx);
          if (unitIds.length)
            await tx
              .select({ id: schema.units.id })
              .from(schema.units)
              .where(inArray(schema.units.id, [...unitIds].sort()))
              .orderBy(asc(schema.units.id))
              .for("update");
          const diff = await resetDiff(tx);

          if (diff.release.length)
            await tx.delete(schema.fleetPlanSlots).where(
              inArray(
                schema.fleetPlanSlots.id,
                diff.release.map((r) => r.slotId)
              )
            );
          if (diff.assign.length)
            await tx.insert(schema.fleetPlanSlots).values(
              diff.assign.map((a) => ({
                unitId: a.unitId,
                employeeId: a.employeeId,
              }))
            );

          // Releases first, as their own statement, so a move reads in the
          // order it happened: off the old unit, then onto the new one.
          await recordPlanChanges(
            tx,
            diff.release.map((r) => ({
              unitId: r.unitId,
              employeeId: r.employeeId,
              nik: r.nik,
              name: r.name,
              action: "released" as const,
            })),
            "reset",
            actor
          );
          await recordPlanChanges(
            tx,
            diff.assign.map((a) => ({
              unitId: a.unitId,
              employeeId: a.employeeId,
              nik: a.nik,
              name: a.name,
              action: "assigned" as const,
            })),
            "reset",
            actor
          );

          return {
            released: diff.release.length,
            assigned: diff.assign.length,
            skipped: diff.skipped,
          };
        });
      } catch (error) {
        if (error instanceof PlanImportConflict)
          return status(409, {
            code: error.code,
            message: error.message,
          });
        // A dialog write on a unit this reset did not need to lock.
        if (isUniqueViolation(error, "fleet_plan_slots_employee_id_unique"))
          return status(409, {
            code: "operator_busy",
            message:
              "Seorang operator baru saja dipasangkan di papan — coba reset lagi",
          });
        throw error;
      }
    },
    {
      auth: { menu: "fleet-allocation", mode: "manage" },
      response: {
        200: PlanResetResultSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        409: ErrorSchema,
      },
      detail: {
        summary:
          "Bring the live PLAN back to the saved default (skips and lists pairings that cannot be made now)",
      },
    }
  )

  .post(
    "/plan/slots",
    async ({ body, status, principal }) => {
      const unit = await unitByCode(body.unitCode, true);
      if (!unit) return status(404, unitNotFound);

      const person = await personByNik(body.nik);
      if (!person)
        return status(404, {
          code: "employee_not_found",
          message: "Karyawan tidak ditemukan",
        });

      const refuse = (message: string) =>
        status(422, { code: "validation_failed", message });

      const refusal = await refusePairing(unit, person);
      if (refusal) return refuse(refusal);

      try {
        const outcome = await db.transaction(async (tx) => {
          // The unit row is the lock: two assignments to one unit serialise
          // here, so the count below cannot be raced past the maximum.
          await tx
            .select({ id: schema.units.id })
            .from(schema.units)
            .where(eq(schema.units.id, unit.id))
            .for("update");

          const partners = await tx
            .select({ employeeId: schema.fleetPlanSlots.employeeId })
            .from(schema.fleetPlanSlots)
            .where(eq(schema.fleetPlanSlots.unitId, unit.id));
          if (partners.length >= FA_PLAN_MAX_OPS)
            return { refusal: "full" as const };

          await tx
            .insert(schema.fleetPlanSlots)
            .values({ unitId: unit.id, employeeId: person.id });
          await recordPlanChanges(
            tx,
            [
              {
                unitId: unit.id,
                employeeId: person.id,
                nik: person.nik,
                name: person.name,
                action: "assigned",
              },
            ],
            "board",
            planActorOf(principal)
          );
          return { refusal: null };
        });

        if (outcome.refusal === "full")
          return status(409, {
            code: "unit_full",
            message: `Unit ${unit.code} sudah memegang ${FA_PLAN_MAX_OPS} operator`,
          });
      } catch (error) {
        // The one race the checks cannot see: the operator was paired with
        // another unit between the read and this insert.
        if (isUniqueViolation(error, "fleet_plan_slots_employee_id_unique"))
          return status(409, {
            code: "operator_busy",
            message: `${person.name} baru saja dipasangkan dengan unit lain`,
          });
        throw error;
      }

      return status(201, {
        unitCode: unit.code,
        nik: person.nik,
        name: person.name,
      });
    },
    {
      auth: { menu: "fleet-allocation", mode: "manage" },
      body: t.Object({
        unitCode: t.String({ minLength: 1 }),
        nik: t.String({ minLength: 1 }),
      }),
      response: {
        201: t.Object({
          unitCode: t.String(),
          nik: t.String(),
          name: t.String(),
        }),
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
        409: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "Pair an operator with a unit in the PLAN" },
    }
  )

  .delete(
    "/plan/slots/:unitCode/:nik",
    async ({ params, status, principal }) => {
      const [row] = await db
        .select({
          slotId: schema.fleetPlanSlots.id,
          unitId: schema.fleetPlanSlots.unitId,
          employeeId: schema.fleetPlanSlots.employeeId,
          nik: schema.employees.nik,
          name: schema.employees.name,
        })
        .from(schema.fleetPlanSlots)
        .innerJoin(
          schema.units,
          eq(schema.units.id, schema.fleetPlanSlots.unitId)
        )
        .innerJoin(
          schema.employees,
          eq(schema.employees.id, schema.fleetPlanSlots.employeeId)
        )
        .where(
          and(
            eq(schema.units.code, params.unitCode),
            eq(schema.employees.nik, params.nik)
          )
        )
        .limit(1);
      if (!row)
        return status(404, {
          code: "slot_not_found",
          message: "Pasangan unit-operator tidak ditemukan",
        });

      await db.transaction(async (tx) => {
        // The unit row first, as the assign route and Generate take it: the
        // history insert below needs a key-share lock on the unit, and taking
        // the slot first let Generate (holding every unit) deadlock with it.
        await tx
          .select({ id: schema.units.id })
          .from(schema.units)
          .where(eq(schema.units.id, row.unitId))
          .for("update");
        // `returning` so a slot another request released a moment earlier
        // does not get a second "released" line in the history.
        const gone = await tx
          .delete(schema.fleetPlanSlots)
          .where(eq(schema.fleetPlanSlots.id, row.slotId))
          .returning({ id: schema.fleetPlanSlots.id });
        if (!gone.length) return;
        await recordPlanChanges(
          tx,
          [
            {
              unitId: row.unitId,
              employeeId: row.employeeId,
              nik: row.nik,
              name: row.name,
              action: "released",
            },
          ],
          "board",
          planActorOf(principal)
        );
      });
      return { ok: true };
    },
    {
      auth: { menu: "fleet-allocation", mode: "manage" },
      params: t.Object({
        unitCode: t.String({ minLength: 1 }),
        nik: t.String({ minLength: 1 }),
      }),
      response: {
        200: t.Object({ ok: t.Boolean() }),
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
      },
      detail: { summary: "Release an operator from their planned unit" },
    }
  )

  .get(
    "/plan/units/:code/history",
    async ({ params, status }) => {
      /* Not `unitByCode`, which reads active units only: deactivating is how a
         unit with a past leaves service (its history blocks deletion), and the
         trail is most wanted exactly then. */
      const [unit] = await db
        .select({ id: schema.units.id })
        .from(schema.units)
        .where(eq(schema.units.code, params.code))
        .limit(1);
      if (!unit) return status(404, unitNotFound);

      const rows = await db
        .select({
          id: schema.fleetPlanHistory.id,
          action: schema.fleetPlanHistory.action,
          source: schema.fleetPlanHistory.source,
          nik: schema.fleetPlanHistory.nik,
          name: schema.fleetPlanHistory.name,
          actorName: schema.fleetPlanHistory.actorName,
          createdAt: schema.fleetPlanHistory.createdAt,
        })
        .from(schema.fleetPlanHistory)
        .where(eq(schema.fleetPlanHistory.unitId, unit.id))
        .orderBy(desc(schema.fleetPlanHistory.createdAt));

      return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
    },
    {
      auth: { menu: "fleet-allocation", mode: "view" },
      params: t.Object({ code: t.String({ minLength: 1 }) }),
      response: {
        200: t.Array(PlanHistoryRowSchema),
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
      },
      detail: { summary: "Every change to a unit's standing PLAN pairings" },
    }
  );
