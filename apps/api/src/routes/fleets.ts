/**
 * Fleet composition — a digger, its haulers, a work area, and optionally a
 * crew bus.
 *
 * The digger *is* the fleet's identity (there is no name column; every screen
 * says "Fleet EX8001"), so leading twice is a unique violation rather than a
 * rule this file remembers to check. Member exclusivity is likewise the
 * `fleet_units.unit_id` unique index — the prechecks below exist to name the
 * offending unit in the refusal, and the index catches what a race slips past
 * them.
 *
 * What the route enforces beyond the schema: the work area is of type Mining
 * (a fleet operates in the pit), the bus is a unit of type BUS, the digger is
 * not offered as its own hauler, and the member list stays within the shared
 * bounds. What it deliberately does NOT enforce: "digger-ness" of the leader.
 * The catalogues carry no fleet-leader flag — the screen derives it from type
 * and class as a heuristic, and a heuristic is not a thing to refuse on.
 */

import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Elysia, t } from "elysia";
import {
  FLEET_MAX_UNITS,
  FLEET_MIN_UNITS,
  FLEET_TRANSPORT_TYPES_TEXT,
  isFleetTransportType,
  type FleetImportPreview,
} from "@universe/contracts";

import { requireAuth } from "../auth/macro";
import { db, isUniqueViolation, schema } from "../db";
import {
  isFleetConfigured,
  isNotFleetConfigured,
  takesPartInAllocation,
} from "../fleet-scope";
import {
  buildTemplate,
  validateFleetWorkbook,
  type FleetCatalogues,
  type ParsedFleetRow,
  type ParsedSupportUnit,
} from "./fleets-import";
import { MAX_IMPORT_BYTES } from "./import-columns";
import {
  ErrorSchema,
  FleetBulkDeleteResultSchema,
  FleetImportPreviewSchema,
  FleetImportResultSchema,
  FleetSchema,
  FleetSupportResultSchema,
  NoFleetSchema,
} from "./schemas";

const leader = alias(schema.units, "leader_unit");
const leaderTransport = alias(schema.units, "leader_transport");

/**
 * A fleet joined to what names it.
 *
 * The area comes from the **leader unit**, not from the fleet: a location is a
 * fact about a unit — a dozer in no formation has one too — and a formation's
 * members are held to their leader's value on write. Transport left this table
 * for the same reason and is now per member, so it is read with the members.
 */
const fleetColumns = {
  id: schema.fleets.id,
  leaderUnitId: schema.fleets.leaderUnitId,
  leaderCode: leader.code,
  workArea: leader.workArea,
  /* The leader rides something too, and it is not a member row — so nothing
     else on this screen would carry it. */
  leaderTransportUnitId: leader.transportUnitId,
  leaderTransportCode: leaderTransport.code,
  active: schema.fleets.active,
  createdAt: schema.fleets.createdAt,
};

function fleetQuery() {
  return db
    .select(fleetColumns)
    .from(schema.fleets)
    .innerJoin(leader, eq(leader.id, schema.fleets.leaderUnitId))
    .leftJoin(leaderTransport, eq(leaderTransport.id, leader.transportUnitId));
}

type FleetRow = Awaited<ReturnType<typeof fleetQuery>>[number];

/** Member codes for a set of fleets, one query however many fleets. */
type FleetMember = {
  id: string;
  code: string;
  transportUnitId: string | null;
  transportCode: string | null;
};

async function membersOf(
  fleetIds: string[]
): Promise<Map<string, FleetMember[]>> {
  const map = new Map<string, FleetMember[]>(fleetIds.map((id) => [id, []]));
  if (!fleetIds.length) return map;
  const transport = alias(schema.units, "member_transport");
  const rows = await db
    .select({
      fleetId: schema.fleetUnits.fleetId,
      id: schema.units.id,
      code: schema.units.code,
      transportUnitId: schema.units.transportUnitId,
      transportCode: transport.code,
    })
    .from(schema.fleetUnits)
    .innerJoin(schema.units, eq(schema.units.id, schema.fleetUnits.unitId))
    .leftJoin(transport, eq(transport.id, schema.units.transportUnitId))
    .where(inArray(schema.fleetUnits.fleetId, fleetIds))
    .orderBy(asc(schema.units.code));
  for (const row of rows)
    map.get(row.fleetId)?.push({
      id: row.id,
      code: row.code,
      transportUnitId: row.transportUnitId,
      transportCode: row.transportCode,
    });
  return map;
}

function toFleet(row: FleetRow, units: FleetMember[]) {
  return {
    id: row.id,
    leaderUnitId: row.leaderUnitId,
    leaderCode: row.leaderCode,
    workArea: row.workArea ?? "",
    leaderTransportUnitId: row.leaderTransportUnitId,
    leaderTransportCode: row.leaderTransportCode,
    units,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
  };
}

const notFound = { code: "fleet_not_found", message: "Fleet tidak ditemukan" };

const invalid = (message: string) => ({ code: "validation_failed", message });

/**
 * Everything a create or edit has to agree with, checked in one place.
 *
 * Returns the refusal message, or null when the composition is sound. The
 * caller passes its own fleet id on edit so the checks do not refuse a fleet
 * for holding the units it already holds — and the spreadsheet import passes
 * *every* fleet its file replaces, so two rows may trade a hauler without
 * either being refused for membership the same upload dissolves.
 */
export async function refuseComposition(input: {
  leaderUnitId: string;
  unitIds: string[];
  /**
   * Every distinct vehicle the write assigns as transport, for the type check.
   *
   * A list rather than one value: transport is per unit since 2026-09-04, so a
   * formation can legitimately name several — and the refusal has to be able
   * to say which one is not a vehicle.
   */
  transportUnitIds?: string[];
  selfIds?: string[];
}): Promise<string | null> {
  const { leaderUnitId, unitIds } = input;
  const transportUnitIds = [...new Set(input.transportUnitIds ?? [])];
  const selfIds = input.selfIds ?? [];

  if (unitIds.includes(leaderUnitId))
    return "Unit pemimpin tidak bisa sekaligus menjadi anggota fleet-nya sendiri";

  // Every unit named — leader, transport, members — must exist. One query, and
  // the refusal names what is missing rather than which constraint would fire.
  const askedIds = [leaderUnitId, ...transportUnitIds, ...unitIds];
  const found = await db
    .select({
      id: schema.units.id,
      code: schema.units.code,
      typeName: schema.unitTypes.name,
    })
    .from(schema.units)
    .innerJoin(schema.unitTypes, eq(schema.unitTypes.id, schema.units.typeId))
    .where(inArray(schema.units.id, askedIds));
  const byId = new Map(found.map((u) => [u.id, u]));
  if (!byId.has(leaderUnitId))
    return "Unit pemimpin yang dipilih tidak ada di master";
  const missingTransport = transportUnitIds.filter((id) => !byId.has(id));
  if (missingTransport.length)
    return "Unit transport yang dipilih tidak ada di master";
  const missing = unitIds.filter((id) => !byId.has(id));
  if (missing.length)
    return `${missing.length} unit anggota tidak ada di master`;

  const notVehicle = transportUnitIds.find(
    (id) => !isFleetTransportType(byId.get(id)!.typeName)
  );
  if (notVehicle)
    return `Unit ${byId.get(notVehicle)!.code} bukan ${FLEET_TRANSPORT_TYPES_TEXT}`;

  // Exclusivity, named. The leader may not haul for anyone, and a member may
  // not already haul elsewhere or lead a fleet of its own. The unique indexes
  // hold all of this too — these queries exist for the message.
  /* Members and the leader only. A transport vehicle hauling for some fleet is
     not a conflict — it is being named as a ride, not as a member. */
  const memberIds = [leaderUnitId, ...unitIds];
  const othersOnly = selfIds.length
    ? notInArray(schema.fleetUnits.fleetId, selfIds)
    : undefined;
  const taken = await db
    .select({ unitId: schema.fleetUnits.unitId, code: schema.units.code })
    .from(schema.fleetUnits)
    .innerJoin(schema.units, eq(schema.units.id, schema.fleetUnits.unitId))
    .where(
      othersOnly
        ? sql`${inArray(schema.fleetUnits.unitId, memberIds)} and ${othersOnly}`
        : inArray(schema.fleetUnits.unitId, memberIds)
    );
  if (taken.some((r) => r.unitId === leaderUnitId))
    return `Unit ${byId.get(leaderUnitId)!.code} sudah menjadi anggota fleet lain`;
  const takenMembers = taken.filter((r) => unitIds.includes(r.unitId));
  if (takenMembers.length)
    return `Unit ${takenMembers.map((r) => r.code).join(", ")} sudah menjadi anggota fleet lain`;

  const leaders = await db
    .select({ id: schema.fleets.id, leaderUnitId: schema.fleets.leaderUnitId })
    .from(schema.fleets)
    .where(inArray(schema.fleets.leaderUnitId, unitIds));
  const leading = leaders.filter((l) => !selfIds.includes(l.id));
  if (leading.length)
    return `Unit ${leading
      .map((l) => byId.get(l.leaderUnitId)?.code ?? "?")
      .join(", ")} memimpin fleet lain dan tidak bisa menjadi anggota`;

  return null;
}

/**
 * Write the unit-level facts a formation implies.
 *
 * The area goes on the leader **and every member**, which is how "one
 * formation cannot span two areas" is enforced now that the area lives on the
 * unit. Transports are per unit and only the ones named are touched, so a
 * caller that says nothing about a unit's ride leaves it alone.
 *
 * Takes the transaction rather than `db` so a composition and the facts it
 * implies land together or not at all.
 */
async function applyUnitFacts(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: {
    unitIds: string[];
    workArea: string;
    transports?: Record<string, string | null>;
  }
): Promise<void> {
  if (input.unitIds.length)
    await tx
      .update(schema.units)
      .set({
        workArea: input.workArea,
        /* Joining a formation ends support. The flag says "crewed without a
           formation", and leaving it set on a unit that now has one would keep
           the support entry claiming a machine listed under its fleet. */
        fleetSupport: false,
      })
      .where(inArray(schema.units.id, input.unitIds));

  for (const [unitId, transportUnitId] of Object.entries(
    input.transports ?? {}
  ))
    await tx
      .update(schema.units)
      .set({ transportUnitId })
      .where(eq(schema.units.id, unitId));
}

/**
 * Take a disbanded formation's units out of today's operation.
 *
 * Membership rows die with the fleet on their own (cascade), but since
 * 2026-09-04 the units also carry where they are working and what brings their
 * crew — and a formation that no longer exists is not working anywhere. Left
 * behind, those values keep the Unit Status screen naming a pit the machine
 * was pulled out of.
 *
 * The leader is included: it is the fleet's identity, not a member row, so
 * nothing else would clear it.
 */
async function releaseFleetUnits(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  fleetIds: string[]
): Promise<void> {
  if (!fleetIds.length) return;
  const members = await tx
    .select({ unitId: schema.fleetUnits.unitId })
    .from(schema.fleetUnits)
    .where(inArray(schema.fleetUnits.fleetId, fleetIds));
  const leaders = await tx
    .select({ unitId: schema.fleets.leaderUnitId })
    .from(schema.fleets)
    .where(inArray(schema.fleets.id, fleetIds));
  const ids = [...new Set([...members, ...leaders].map((r) => r.unitId))];
  if (!ids.length) return;
  await tx
    .update(schema.units)
    .set({ workArea: null, transportUnitId: null })
    .where(inArray(schema.units.id, ids));
}

/** The vehicles a transport map actually names, for the type check. */
const transportsNamed = (map?: Record<string, string | null>) =>
  Object.values(map ?? {}).filter((id): id is string => id !== null);

/** Distinct ids in submitted order — a doubled selection is not two haulers. */
const distinct = (ids: string[]) => [...new Set(ids)];

/* ------------------------------------------------------------- no-fleet */

/**
 * The no-fleet entry's units: every active unit that belongs to no formation.
 *
 * Derived, never stored (owner, 2026-08-31). Formations are reshuffled often,
 * and a stored list of "everything else" goes stale the moment one is edited —
 * silently, because nothing about a stale row looks wrong. Deriving it means
 * the entry is correct by construction: a unit pulled out of a fleet is in
 * here on the next read, and one added to a fleet leaves without anyone
 * remembering to remove it.
 *
 * This entry is **not allocated.** It exists so a machine cannot drop out of
 * allocation unnoticed, which is a question about visibility rather than a
 * second scope for the engine — see `fleet-scope.ts`.
 */
async function noFleetUnits() {
  const transport = alias(schema.units, "nofleet_transport");
  return db
    .select({
      id: schema.units.id,
      code: schema.units.code,
      /* Two different states share this list now: a unit nobody crews, and a
         support unit that is crewed without a formation. The flag is what tells
         a reader which of the two they are looking at. */
      fleetSupport: schema.units.fleetSupport,
      workArea: schema.units.workArea,
      transportCode: transport.code,
    })
    .from(schema.units)
    .leftJoin(transport, eq(transport.id, schema.units.transportUnitId))
    .where(
      and(eq(schema.units.active, true), isNotFleetConfigured(schema.units.id))
    )
    .orderBy(asc(schema.units.code));
}

/* --------------------------------------------------------------- import */

/** Everything the parser needs to resolve codes and diff against. */
async function importCatalogues(): Promise<FleetCatalogues> {
  const units = await db
    .select({
      id: schema.units.id,
      code: schema.units.code,
      typeName: schema.unitTypes.name,
    })
    .from(schema.units)
    .innerJoin(schema.unitTypes, eq(schema.unitTypes.id, schema.units.typeId));
  const fleets = await fleetQuery();
  const members = await membersOf(fleets.map((f) => f.id));

  /* Everything the file could release: a formation member, a leader, a support
     unit — or a unit that merely still carries a work area, which is what a
     formation disbanded by hand leaves behind. Read once here so the preview
     can name what drops out of today's operation before the commit does it.

     Wider than allocation scope on purpose. A unit holding a location it is no
     longer worked at is a wrong reading on the Unit Status screen, and the
     daily file is the one thing that knows it. */
  const operating = await db
    .select({ id: schema.units.id, code: schema.units.code })
    .from(schema.units)
    .where(
      and(
        eq(schema.units.active, true),
        or(
          takesPartInAllocation(schema.units.id, schema.units.fleetSupport),
          isNotNull(schema.units.workArea)
        )
      )
    );

  return {
    unitsByCode: new Map(units.map((u) => [u.code.toLowerCase(), u])),
    fleetsByLeader: new Map(
      fleets.map((f) => [
        f.leaderCode.toLowerCase(),
        {
          id: f.id,
          leaderUnitId: f.leaderUnitId,
          area: f.workArea ?? "",
          memberCodes: (members.get(f.id) ?? []).map((m) => m.code),
          transportCodes: [
            ...new Set(
              (members.get(f.id) ?? [])
                .map((m) => m.transportCode)
                .filter((c): c is string => c !== null)
            ),
          ],
        },
      ])
    ),
    inOperation: new Map(operating.map((u) => [u.code.toLowerCase(), u.code])),
  };
}

type FleetImportOutcome = {
  preview: FleetImportPreview;
  rows: ParsedFleetRow[];
  support: ParsedSupportUnit[];
  disband: { id: string; leaderCode: string }[];
  releasedIds: string[];
};

/**
 * Parse, then hold every surviving row against `refuseComposition` — the same
 * function the form goes through. `selfIds` carries every fleet the file
 * replaces, so exclusivity is judged against the world *after* this upload.
 */
async function parseFleetImport(
  file: File
): Promise<FleetImportOutcome | { code: string; message: string }> {
  const parsed = await validateFleetWorkbook(
    await file.arrayBuffer(),
    await importCatalogues()
  );
  if ("code" in parsed) return parsed;

  const selfIds = parsed.rows
    .map((r) => r.selfId)
    .filter((id): id is string => id !== null);

  /* Every formation the file replaces, including the ones it disbands: a
     hauler moving out of a fleet this upload dissolves must not be refused for
     membership that will not survive the commit. */
  const replacedIds = [...selfIds, ...parsed.disband.map((d) => d.id)];

  const rows: ParsedFleetRow[] = [];
  const errors = [...parsed.errors];
  for (const row of parsed.rows) {
    const refusal = await refuseComposition({
      leaderUnitId: row.leaderUnitId,
      unitIds: row.unitIds,
      transportUnitIds: Object.values(row.transports).filter(
        (id): id is string => id !== null
      ),
      selfIds: replacedIds,
    });
    if (refusal) {
      errors.push({
        row: String(row.preview.row),
        nik: row.preview.leader,
        emp: row.preview.units.join(", "),
        issue: refusal,
        badgeVariant: "danger",
        badge: "Error",
      });
      continue;
    }
    rows.push(row);
  }

  const releasedCodes = new Set(parsed.released.map((c) => c.toLowerCase()));
  const releasedRows = releasedCodes.size
    ? await db
        .select({ id: schema.units.id, code: schema.units.code })
        .from(schema.units)
        .where(inArray(schema.units.code, parsed.released))
    : [];

  errors.sort((a, b) => Number(a.row) - Number(b.row));
  return {
    preview: {
      fileName: file.name,
      newCount: rows.filter((r) => r.preview.kind === "new").length,
      updatedCount: rows.filter((r) => r.preview.kind === "updated").length,
      unchangedCount: rows.filter((r) => r.preview.kind === "unchanged").length,
      supportCount: parsed.support.filter((u) => !u.breakdown).length,
      breakdownCount: parsed.support.filter((u) => u.breakdown).length,
      errorCount: errors.length,
      rows: rows.map((r) => r.preview),
      support: parsed.support.map((u) => u.preview),
      disband: parsed.disband.map((d) => d.leaderCode),
      released: parsed.released,
      errors,
    },
    rows,
    support: parsed.support,
    disband: parsed.disband,
    releasedIds: releasedRows.map((u) => u.id),
  };
}

const fleetBody = {
  leaderUnitId: t.String({ format: "uuid" }),
  /**
   * Typed, not chosen: pits open and close within days, so there is no
   * catalogue behind this. Trimmed and length-capped at the boundary because
   * nothing downstream will.
   */
  workArea: t.String({ minLength: 1, maxLength: 120 }),
  unitIds: t.Array(t.String({ format: "uuid" }), {
    minItems: FLEET_MIN_UNITS,
    maxItems: FLEET_MAX_UNITS,
  }),
  /**
   * Which vehicle carries each unit's crew, keyed by unit id — the leader's
   * included. Absent means "leave it as it is"; an entry with `null` clears it.
   *
   * Per unit rather than one for the formation, because transport is reassigned
   * daily and two units of one fleet can legitimately ride different vehicles.
   */
  transports: t.Optional(
    t.Record(t.String(), t.Nullable(t.String({ format: "uuid" })))
  ),
  active: t.Optional(t.Boolean()),
};

export const fleetsRoutes = new Elysia({ prefix: "/fleets", tags: ["fleets"] })
  .use(requireAuth)

  .get(
    "/",
    async () => {
      const rows = await fleetQuery().orderBy(asc(leader.code));
      const members = await membersOf(rows.map((r) => r.id));
      return rows.map((r) => toFleet(r, members.get(r.id) ?? []));
    },
    {
      /**
       * Readable from the Display menu too, because that is where a fleet wall
       * is pointed at its formations and the picker has to offer the real
       * ones. Only this list: creating, editing and disbanding a fleet stay
       * `fleet-setting` alone. What it discloses — leader codes, work areas,
       * member units — is what the TV shows in the yard anyway.
       */
      auth: { menu: ["fleet-setting", "display-fleet"], mode: "view" },
      response: {
        200: t.Array(FleetSchema),
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: { summary: "List fleets with their member units" },
    }
  )

  /* -------------------------------------------------------------- no-fleet
     Declared before /:id so "no-fleet" is never parsed as a fleet id.

     There is no row behind this entry and so no way to delete it: it is a
     fixed part of Fleet Setting, and "cannot be deleted" is a property of
     having nothing to delete rather than a rule someone enforces. It is
     read-only for the same reason — its membership is derived from the
     formations, so there is nothing here to edit. */

  .get("/no-fleet", async () => ({ units: await noFleetUnits() }), {
    auth: { menu: ["fleet-setting", "display-fleet"], mode: "view" },
    response: {
      200: NoFleetSchema,
      401: ErrorSchema,
      403: ErrorSchema,
    },
    detail: {
      summary: "Active units belonging to no formation — outside allocation",
    },
  })

  /* ---------------------------------------------------------------- import
     Declared before /:id so "import" is never parsed as a fleet id. */

  .get(
    "/import/template",
    async ({ set }) => {
      set.headers["content-type"] =
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      set.headers["content-disposition"] =
        'attachment; filename="template_fleet.xlsx"';
      return new Response(new Uint8Array(await buildTemplate()));
    },
    {
      auth: { menu: "fleet-setting", mode: "manage" },
      // Described by hand rather than with a `response` schema: the body is a
      // binary workbook, and a TypeBox schema would try to validate it.
      detail: {
        summary: "Download the fleet import template (.xlsx)",
        responses: {
          200: {
            description: "An .xlsx with the columns digger, area, bus, units",
            content: {
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
                { schema: { type: "string", format: "binary" } },
            },
          },
          401: { description: "No session" },
          403: { description: "Lacks manage on the fleet-setting menu" },
        },
      },
    }
  )

  .post(
    "/import/validate",
    async ({ body, status }) => {
      const outcome = await parseFleetImport(body.file);
      if ("code" in outcome) return status(422, outcome);
      return outcome.preview;
    },
    {
      auth: { menu: "fleet-setting", mode: "manage" },
      body: t.Object({ file: t.File({ maxSize: MAX_IMPORT_BYTES }) }),
      response: {
        200: FleetImportPreviewSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        422: ErrorSchema,
      },
      detail: {
        summary: "Validate a fleet spreadsheet and preview the changes",
      },
    }
  )

  .post(
    "/import/commit",
    async ({ body, status }) => {
      // Re-validated rather than trusted from the client: the preview the
      // caller saw is advisory, this parse is what gets written.
      const outcome = await parseFleetImport(body.file);
      if ("code" in outcome) return status(422, outcome);
      if (outcome.preview.errorCount > 0)
        return status(422, {
          code: "validation_failed",
          message: `${outcome.preview.errorCount} baris masih bermasalah`,
        });

      const updated = outcome.rows.filter((r) => r.selfId !== null);
      const created = outcome.rows.filter((r) => r.selfId === null);

      try {
        // One transaction, ordered so that every membership the file
        // dissolves is gone before any it grants exists — two fleets trading
        // a hauler must not trip the unique index mid-write.
        await db.transaction(async (tx) => {
          /* Formations the file never named. The file is the whole yard for
             one day, so absent means gone — and the preview showed this list
             before anybody pressed commit. Members cascade with the fleet. */
          if (outcome.disband.length)
            await tx.delete(schema.fleets).where(
              inArray(
                schema.fleets.id,
                outcome.disband.map((d) => d.id)
              )
            );

          if (updated.length)
            await tx.delete(schema.fleetUnits).where(
              inArray(
                schema.fleetUnits.fleetId,
                updated.map((r) => r.selfId!)
              )
            );
          for (const row of created) {
            const [fleet] = await tx
              .insert(schema.fleets)
              .values({ leaderUnitId: row.leaderUnitId })
              .returning({ id: schema.fleets.id });
            row.selfId = fleet!.id;
          }
          await tx
            .insert(schema.fleetUnits)
            .values(
              outcome.rows.flatMap((row) =>
                row.unitIds.map((unitId) => ({ fleetId: row.selfId!, unitId }))
              )
            );

          /* Units first stop taking part, then the file's own rows put back
             the ones it still names — ordered this way so a unit moving from
             support into a formation is never briefly both. */
          if (outcome.releasedIds.length)
            await tx
              .update(schema.units)
              .set({
                fleetSupport: false,
                workArea: null,
                transportUnitId: null,
              })
              .where(inArray(schema.units.id, outcome.releasedIds));

          for (const row of outcome.rows) {
            await applyUnitFacts(tx, {
              unitIds: [row.leaderUnitId, ...row.unitIds],
              workArea: row.workArea,
              transports: row.transports,
            });
            await tx
              .update(schema.units)
              .set({ fleetSupport: false })
              .where(
                inArray(schema.units.id, [row.leaderUnitId, ...row.unitIds])
              );
          }

          for (const unit of outcome.support)
            await tx
              .update(schema.units)
              .set({
                /* Broken machines are not crewed, so they take no part —
                   and "BREAKDOWN" was a status in the area cell, never a
                   place, so it is not kept as one. */
                fleetSupport: !unit.breakdown,
                breakdown: unit.breakdown,
                workArea: unit.workArea,
                transportUnitId: unit.transportUnitId,
              })
              .where(eq(schema.units.id, unit.unitId));
        });
      } catch (error) {
        // Validation reads the database a moment before the write: another
        // request can take a digger or a hauler in between.
        if (isUniqueViolation(error, "fleets_leader_unit_id_unique"))
          return status(409, {
            code: "fleet_exists",
            message:
              "Sebuah unit dalam file ini baru saja memimpin fleet lain — validasi ulang filenya",
          });
        if (isUniqueViolation(error, "fleet_units_unit_id_unique"))
          return status(409, {
            code: "unit_in_fleet",
            message:
              "Sebuah unit dalam file ini baru saja dipakai fleet lain — validasi ulang filenya",
          });
        throw error;
      }

      return {
        created: created.length,
        updated: updated.length,
        disbanded: outcome.disband.length,
        support: outcome.support.filter((u) => !u.breakdown).length,
        released: outcome.releasedIds.length,
      };
    },
    {
      auth: { menu: "fleet-setting", mode: "manage" },
      body: t.Object({ file: t.File({ maxSize: MAX_IMPORT_BYTES }) }),
      response: {
        200: FleetImportResultSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        409: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "Commit a validated fleet spreadsheet" },
    }
  )

  .post(
    "/",
    async ({ body, status }) => {
      const unitIds = distinct(body.unitIds);
      if (unitIds.length < FLEET_MIN_UNITS)
        return status(422, invalid("Fleet butuh minimal satu unit anggota"));

      const refusal = await refuseComposition({
        leaderUnitId: body.leaderUnitId,
        unitIds,
        transportUnitIds: transportsNamed(body.transports),
      });
      if (refusal) return status(422, invalid(refusal));

      try {
        const id = await db.transaction(async (tx) => {
          const [fleet] = await tx
            .insert(schema.fleets)
            .values({
              leaderUnitId: body.leaderUnitId,
              active: body.active ?? true,
            })
            .returning({ id: schema.fleets.id });
          await tx
            .insert(schema.fleetUnits)
            .values(unitIds.map((unitId) => ({ fleetId: fleet!.id, unitId })));
          await applyUnitFacts(tx, {
            unitIds: [body.leaderUnitId, ...unitIds],
            workArea: body.workArea.trim(),
            transports: body.transports,
          });
          return fleet!.id;
        });

        const [row] = await fleetQuery().where(eq(schema.fleets.id, id));
        const members = await membersOf([id]);
        return status(201, toFleet(row!, members.get(id) ?? []));
      } catch (error) {
        // The two exclusivity races the prechecks cannot see: another request
        // claimed the digger, or one of the members, between check and insert.
        if (isUniqueViolation(error, "fleets_leader_unit_id_unique"))
          return status(409, {
            code: "fleet_exists",
            message: "Unit ini sudah memimpin fleet lain",
          });
        if (isUniqueViolation(error, "fleet_units_unit_id_unique"))
          return status(409, {
            code: "unit_in_fleet",
            message: "Salah satu unit baru saja dipakai fleet lain",
          });
        throw error;
      }
    },
    {
      auth: { menu: "fleet-setting", mode: "manage" },
      body: t.Object(fleetBody),
      response: {
        201: FleetSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        409: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "Create a fleet" },
    }
  )

  .patch(
    "/:id",
    async ({ params, body, status }) => {
      const [existing] = await db
        .select()
        .from(schema.fleets)
        .where(eq(schema.fleets.id, params.id))
        .limit(1);
      if (!existing) return status(404, notFound);

      const unitIds = distinct(body.unitIds);
      if (unitIds.length < FLEET_MIN_UNITS)
        return status(422, invalid("Fleet butuh minimal satu unit anggota"));

      const refusal = await refuseComposition({
        leaderUnitId: body.leaderUnitId,
        unitIds,
        transportUnitIds: transportsNamed(body.transports),
        selfIds: [existing.id],
      });
      if (refusal) return status(422, invalid(refusal));

      try {
        // The member list is replaced, not patched: the dialog submits the
        // whole selection, and a diff would reimplement what delete + insert
        // in one transaction already guarantees.
        await db.transaction(async (tx) => {
          await tx
            .update(schema.fleets)
            .set({
              leaderUnitId: body.leaderUnitId,
              ...(body.active !== undefined ? { active: body.active } : {}),
            })
            .where(eq(schema.fleets.id, existing.id));
          await tx
            .delete(schema.fleetUnits)
            .where(eq(schema.fleetUnits.fleetId, existing.id));
          await tx
            .insert(schema.fleetUnits)
            .values(
              unitIds.map((unitId) => ({ fleetId: existing.id, unitId }))
            );
          await applyUnitFacts(tx, {
            unitIds: [body.leaderUnitId, ...unitIds],
            workArea: body.workArea.trim(),
            transports: body.transports,
          });
        });
      } catch (error) {
        if (isUniqueViolation(error, "fleets_leader_unit_id_unique"))
          return status(409, {
            code: "fleet_exists",
            message: "Unit ini sudah memimpin fleet lain",
          });
        if (isUniqueViolation(error, "fleet_units_unit_id_unique"))
          return status(409, {
            code: "unit_in_fleet",
            message: "Salah satu unit baru saja dipakai fleet lain",
          });
        throw error;
      }

      const [row] = await fleetQuery().where(eq(schema.fleets.id, existing.id));
      const members = await membersOf([existing.id]);
      return toFleet(row!, members.get(existing.id) ?? []);
    },
    {
      auth: { menu: "fleet-setting", mode: "manage" },
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: t.Object(fleetBody),
      response: {
        200: FleetSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
        409: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "Edit a fleet, replacing its member list" },
    }
  )

  /**
   * Delete a hand-picked selection of formations.
   *
   * One statement, unlike the master catalogues' and the unit registry's bulk
   * deletes: nothing can refuse a fleet. Its two referrers — membership rows
   * and the display bindings — both cascade, and the units themselves are
   * untouched, so there is no per-id outcome to report and no reason to pay
   * for partial success.
   *
   * `POST …/bulk-delete` rather than `DELETE /fleets`: the latter reads as
   * "delete every formation", and bodies on DELETE are poorly supported by
   * proxies.
   */
  /**
   * Put units into the support entry, or move them within it.
   *
   * A write route on a screen whose other pinned entry deliberately has none,
   * and the difference is what each one *is*. No-fleet membership is derived —
   * "everything no formation holds" — so an endpoint could only ever disagree
   * with the formations. Support is a stored flag with a work area and a ride
   * beside it, and until now the only thing that could set them was the daily
   * import. A dozer moved to a new panel at ten in the morning had nowhere to
   * be recorded (owner, 2026-09-04).
   *
   * Idempotent by shape: it states what these units are, rather than adding to
   * a list, so re-sending the same call changes nothing.
   */
  .post(
    "/support",
    async ({ body, status }) => {
      /* One entry per unit, last write wins on a repeat — the client sends a
         list it built from a selection, and a doubled id is a slip rather than
         two different answers. */
      const rows = [...new Map(body.units.map((u) => [u.unitId, u])).values()];
      const unitIds = rows.map((u) => u.unitId);
      const vehicleIds = [
        ...new Set(
          rows
            .map((u) => u.transportUnitId ?? null)
            .filter((id): id is string => id !== null)
        ),
      ];

      const found = await db
        .select({
          id: schema.units.id,
          code: schema.units.code,
          typeName: schema.unitTypes.name,
        })
        .from(schema.units)
        .innerJoin(
          schema.unitTypes,
          eq(schema.unitTypes.id, schema.units.typeId)
        )
        .where(inArray(schema.units.id, [...unitIds, ...vehicleIds]));
      const byId = new Map(found.map((u) => [u.id, u]));

      const missing = unitIds.filter((id) => !byId.has(id));
      if (missing.length)
        return status(
          422,
          invalid(`${missing.length} unit tidak ada di master`)
        );
      if (vehicleIds.some((id) => !byId.has(id)))
        return status(422, invalid("Unit transport tidak ada di master"));
      const notVehicle = vehicleIds.find(
        (id) => !isFleetTransportType(byId.get(id)!.typeName)
      );
      if (notVehicle)
        return status(
          422,
          invalid(
            `Unit ${byId.get(notVehicle)!.code} bukan ${FLEET_TRANSPORT_TYPES_TEXT}`
          )
        );

      /* A unit in a formation is already crewed through it, and the support
         entry lists what belongs to none — so admitting one here would put the
         same machine in two places on the same screen. */
      const inFleet = await db
        .select({ code: schema.units.code })
        .from(schema.units)
        .where(
          and(
            inArray(schema.units.id, unitIds),
            isFleetConfigured(schema.units.id)
          )
        );
      if (inFleet.length)
        return status(
          422,
          invalid(
            `Unit ${inFleet.map((u) => u.code).join(", ")} sudah masuk sebuah fleet`
          )
        );

      /* Grouped by the pair rather than one statement per unit: a support
         group is usually on one panel and one vehicle, so this is almost
         always a single update and never more than a handful. */
      const groups = new Map<
        string,
        { workArea: string; transportUnitId: string | null; ids: string[] }
      >();
      for (const row of rows) {
        const workArea = row.workArea.trim();
        const transportUnitId = row.transportUnitId ?? null;
        const key = `${workArea}\u0000${transportUnitId ?? ""}`;
        const group = groups.get(key) ?? { workArea, transportUnitId, ids: [] };
        group.ids.push(row.unitId);
        groups.set(key, group);
      }
      await db.transaction(async (tx) => {
        for (const group of groups.values())
          await tx
            .update(schema.units)
            .set({
              fleetSupport: true,
              workArea: group.workArea,
              transportUnitId: group.transportUnitId,
            })
            .where(inArray(schema.units.id, group.ids));
      });
      return { changed: unitIds.length };
    },
    {
      auth: { menu: "fleet-setting", mode: "manage" },
      body: t.Object({
        /**
         * One entry per unit, carrying everything about it.
         *
         * A list rather than an id array beside a shared area and a map of
         * rides, because **none of it is shared**: support units are not one
         * formation, so two of them may work on different panels and be
         * brought by different buses. A formation is the case where the area
         * has to be one value, and that rule lives on the formation routes.
         *
         * A missing `transportUnitId` means **none**: this route states what
         * these units are rather than patching them, so silence about a ride
         * is an answer.
         */
        units: t.Array(
          t.Object({
            unitId: t.String({ format: "uuid" }),
            workArea: t.String({ minLength: 1, maxLength: 120 }),
            transportUnitId: t.Optional(
              t.Nullable(t.String({ format: "uuid" }))
            ),
          }),
          { minItems: 1, maxItems: 500 }
        ),
      }),
      response: {
        200: FleetSupportResultSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "Mark units as fleet support" },
    }
  )

  /**
   * Take units back out of support.
   *
   * The same clearing the import's release sweep does, and deliberately the
   * same three columns: a machine nobody is crewing is not working anywhere
   * either, and a leftover area is what had Unit Status naming a pit the unit
   * had been pulled out of.
   */
  .post(
    "/support/release",
    async ({ body }) => {
      const unitIds = [...new Set(body.unitIds)];
      await db
        .update(schema.units)
        .set({ fleetSupport: false, workArea: null, transportUnitId: null })
        .where(inArray(schema.units.id, unitIds));
      // Ids already released count as changed: the end state the caller asked
      // for holds, and a list left open for a while should not read as failure.
      return { changed: unitIds.length };
    },
    {
      auth: { menu: "fleet-setting", mode: "manage" },
      body: t.Object({
        unitIds: t.Array(t.String({ format: "uuid" }), {
          minItems: 1,
          maxItems: 500,
        }),
      }),
      response: {
        200: FleetSupportResultSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "Take units out of fleet support" },
    }
  )

  .post(
    "/bulk-delete",
    async ({ body }) => {
      // Distinct, so a caller that sends the same fleet twice cannot inflate
      // the count it gets back.
      const ids = [...new Set(body.ids)];
      await db.transaction(async (tx) => {
        // Before the delete, while the membership rows are still there to read.
        await releaseFleetUnits(tx, ids);
        await tx.delete(schema.fleets).where(inArray(schema.fleets.id, ids));
      });
      // Ids already gone count as deleted: the end state the caller asked for
      // holds, and a list left open for a while should not read as a failure.
      return { deleted: ids.length };
    },
    {
      auth: { menu: "fleet-setting", mode: "manage" },
      body: t.Object({
        ids: t.Array(t.String({ format: "uuid" }), {
          minItems: 1,
          maxItems: 200,
        }),
      }),
      response: {
        200: FleetBulkDeleteResultSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "Delete several fleets at once" },
    }
  )

  .delete(
    "/:id",
    async ({ params, status }) => {
      // Membership rows die with the fleet (cascade) — they are its edge
      // list. The units themselves survive and are immediately offerable to
      // another fleet; what they lose is the location and the ride this
      // formation gave them.
      const row = await db.transaction(async (tx) => {
        await releaseFleetUnits(tx, [params.id]);
        const [deleted] = await tx
          .delete(schema.fleets)
          .where(eq(schema.fleets.id, params.id))
          .returning({ id: schema.fleets.id });
        return deleted;
      });
      if (!row) return status(404, notFound);
      return { ok: true };
    },
    {
      auth: { menu: "fleet-setting", mode: "manage" },
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      response: {
        200: t.Object({ ok: t.Boolean() }),
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
      },
      detail: { summary: "Delete a fleet, releasing its members" },
    }
  );
