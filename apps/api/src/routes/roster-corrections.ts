/**
 * Koreksi Roster — one person's day, set by hand above unggul_att.
 *
 * The case it exists for (owner, 2026-10-05): an operator rostered `N` is
 * called in for the morning. unggul_att is revised in the office around noon,
 * so the 03:00 pull still says `N` while he is already at the booth — and the
 * board, which only seats people rostered `D`, never considers him. An admin
 * corrects the day after the pull and before the muster.
 *
 * **It takes effect at once.** There is no approval queue: at 03:30 nobody is
 * awake to approve anything, and the admin making the correction is the one
 * who knows the person was called in. The correction is written into the day
 * in force in the same transaction, and the mirror lays it over every later
 * pull (`roster-sync.ts`), so nothing that reads `roster_days` — the board, the
 * slip, the walls — needs to know corrections exist.
 *
 * Scoped like the rest of the register: an admin corrects his own department,
 * Manpower and Superadmin anybody. Out of scope answers 404, as `employees`
 * does, so the screen cannot be used to enumerate another department.
 *
 * A board already generated is not rebuilt (owner: the board is never
 * regenerated out of turn). A correction after `spare-validate` changes the
 * roster from then on; seating the person today is a manual placement.
 */

import {
  and,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  or,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Elysia, t } from "elysia";
import type { RosterCode, SessionPrincipal } from "@universe/contracts";

import { requireAuth } from "../auth/macro";
import { scopeWhere } from "../auth/scope";
import { db, isUniqueViolation, schema } from "../db";
import { reconcileInductionHolds } from "../induction-hold";
import { rosterDayInForce } from "../roster-in-force";
import { localDate } from "../scheduler";
import {
  ErrorSchema,
  RosterCodeSchema,
  RosterCorrectionSchema,
  ValidationIssuesSchema,
} from "./schemas";

const fix = schema.rosterCorrections;
const day = schema.rosterDays;
const doc = schema.rosterDocuments;
const emp = schema.employees;
const dpt = schema.departments;
const creator = alias(schema.users, "correction_creator");
const revoker = alias(schema.users, "correction_revoker");

const LIVE_INDEX = "roster_corrections_live_idx";
/** The list is a working screen, not an archive; the newest are what matter. */
const LIST_LIMIT = 500;
/** A picker, not a register: enough to find somebody by name or NIK. */
const PEOPLE_LIMIT = 20;

const notFound = {
  code: "not_found",
  message: "Koreksi tidak ditemukan",
};
const alreadyCorrected = {
  code: "already_corrected",
  message:
    "Hari itu sudah dikoreksi untuk karyawan ini — batalkan koreksi lama dulu",
};
const alreadyRevoked = {
  code: "already_revoked",
  message: "Koreksi ini sudah dibatalkan",
};
const forbidden = { code: "forbidden", message: "Akses ditolak" };

const monthOf = (date: string) => `${date.slice(0, 7)}-01`;

/** The fields a list row and a single answer share. */
function correctionQuery() {
  return db
    .select({
      id: fix.id,
      employeeId: fix.employeeId,
      nik: emp.nik,
      name: emp.name,
      departmentName: dpt.name,
      date: fix.date,
      fromCode: fix.fromCode,
      toCode: fix.toCode,
      reason: fix.reason,
      createdByName: creator.name,
      createdAt: fix.createdAt,
      revokedByName: revoker.name,
      revokedAt: fix.revokedAt,
    })
    .from(fix)
    .innerJoin(emp, eq(emp.id, fix.employeeId))
    .innerJoin(dpt, eq(dpt.id, emp.departmentId))
    .innerJoin(creator, eq(creator.id, fix.createdBy))
    .leftJoin(revoker, eq(revoker.id, fix.revokedBy));
}

type CorrectionRow = Awaited<ReturnType<typeof correctionQuery>>[number];

const toWire = (row: CorrectionRow) => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  revokedAt: row.revokedAt?.toISOString() ?? null,
});

const scopeOf = (principal: SessionPrincipal) =>
  scopeWhere(principal, { dept: emp.departmentId, self: emp.nik });

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The document in force for a department and month — the one the board reads.
 *
 * Mirror or upload alike: a correction belongs in whatever is in force, and
 * the mirror takes an upload over with its cells, corrections included.
 */
async function documentInForce(
  tx: Tx,
  departmentId: string,
  date: string
): Promise<string | null> {
  const [row] = await tx
    .select({ id: doc.id })
    .from(doc)
    .where(
      and(
        eq(doc.departmentId, departmentId),
        eq(doc.month, monthOf(date)),
        eq(doc.status, "aktif")
      )
    )
    .limit(1);
  return row?.id ?? null;
}

/** Write one day's code into a document, whether or not it held the day. */
async function writeDay(
  tx: Tx,
  cell: { documentId: string; employeeId: string; date: string },
  code: RosterCode
) {
  await tx
    .insert(day)
    .values({ ...cell, code })
    .onConflictDoUpdate({
      target: [day.documentId, day.employeeId, day.date],
      set: { code },
    });
}

/**
 * Today's first-day-back holds read the roster, so a corrected today must be
 * read again — the same thing the pull does after it writes. Not fatal: the
 * correction stands, and the next roster stage re-checks the holds.
 */
async function recheckHolds(date: string) {
  if (date !== localDate(new Date())) return;
  await reconcileInductionHolds(date).catch((error) =>
    console.error("[roster] induction holds after a correction failed", error)
  );
}

type Issue = { field: string; message: string };

/**
 * Entries the transaction found it cannot write, thrown to roll back the
 * whole submission. Named by entry index, so the form can put each message on
 * the row it belongs to rather than in a toast that names none of them.
 */
class Refusal extends Error {
  constructor(readonly issues: Issue[]) {
    super("refused");
  }
}

const refused = (issues: Issue[]) => ({
  code: "invalid_entries",
  message: `${issues.length} entri tidak bisa disimpan — tidak ada yang tersimpan`,
  issues,
});

export const rosterCorrectionRoutes = new Elysia({
  prefix: "/roster-corrections",
  tags: ["roster"],
})
  .use(requireAuth)

  .get(
    "/",
    async ({ query, principal }) => {
      const needle = query.q?.trim();
      const rows = await correctionQuery()
        .where(
          and(
            await scopeOf(principal),
            query.from ? gte(fix.date, query.from) : undefined,
            query.to ? lte(fix.date, query.to) : undefined,
            needle
              ? or(
                  ilike(emp.nik, `%${needle}%`),
                  ilike(emp.name, `%${needle}%`)
                )
              : undefined
          )
        )
        .orderBy(desc(fix.date), desc(fix.createdAt))
        .limit(LIST_LIMIT);
      return rows.map(toWire);
    },
    {
      auth: { menu: "roster-correction", mode: "view" },
      query: t.Object({
        q: t.Optional(t.String()),
        from: t.Optional(t.String({ format: "date" })),
        to: t.Optional(t.String({ format: "date" })),
      }),
      response: {
        200: t.Array(RosterCorrectionSchema),
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: { summary: "Roster corrections, newest day first" },
    }
  )

  /*
   * The people a correction may name, with the code in force on the date.
   *
   * Its own lookup rather than the employee register's: Manpower corrects the
   * roster without holding the register menu, and the form wants one thing
   * the register does not say — what the day reads now, which is the "from"
   * of the correction about to be made.
   */
  .get(
    "/people",
    async ({ query, principal }) => {
      const needle = query.q.trim();
      const cell = and(
        eq(day.employeeId, emp.id),
        eq(day.date, query.date),
        rosterDayInForce
      );
      const rows = await db
        .select({
          nik: emp.nik,
          name: emp.name,
          departmentName: dpt.name,
          code: day.code,
        })
        .from(emp)
        .innerJoin(dpt, eq(dpt.id, emp.departmentId))
        .leftJoin(day, cell)
        .where(
          and(
            await scopeOf(principal),
            or(ilike(emp.nik, `%${needle}%`), ilike(emp.name, `%${needle}%`))
          )
        )
        .orderBy(emp.name)
        .limit(PEOPLE_LIMIT);
      return rows.map((row) => ({
        ...row,
        code: (row.code ?? null) as RosterCode | null,
      }));
    },
    {
      auth: { menu: "roster-correction", mode: "view" },
      query: t.Object({
        q: t.String({ minLength: 1 }),
        date: t.String({ format: "date" }),
      }),
      response: {
        200: t.Array(
          t.Object({
            nik: t.String(),
            name: t.String(),
            departmentName: t.String(),
            code: t.Nullable(RosterCodeSchema),
          })
        ),
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: { summary: "People a correction may name, with the day's code" },
    }
  )

  /*
   * Correct one date for several people at once — the morning's call-ins are
   * entered together, as the old revision form allowed.
   *
   * All or nothing. A submission is one decision about one morning, and half
   * of it landing would leave the admin to work out which half; every entry is
   * judged inside the transaction, and one refusal rolls back the lot.
   */
  .post(
    "/",
    async ({ body, principal, status }) => {
      if (principal.kind !== "user") return status(403, forbidden);

      const niks = body.entries.map((entry) => entry.nik.trim());
      const dupes: Issue[] = [];
      niks.forEach((nik, i) => {
        const first = niks.indexOf(nik);
        if (first !== i)
          dupes.push({
            field: `entries.${i}.nik`,
            message: `NIK ${nik} sudah ada di entri ke-${first + 1}`,
          });
      });
      if (dupes.length) return status(422, refused(dupes));

      const people = await db
        .select({ id: emp.id, nik: emp.nik, departmentId: emp.departmentId })
        .from(emp)
        .where(and(inArray(emp.nik, niks), await scopeOf(principal)));
      const byNik = new Map(people.map((p) => [p.nik, p]));

      try {
        const ids = await db.transaction(async (tx) => {
          const issues: Issue[] = [];
          const ready: {
            cell: { documentId: string; employeeId: string; date: string };
            fromCode: RosterCode | null;
            code: RosterCode;
            reason: string;
          }[] = [];

          for (const [i, entry] of body.entries.entries()) {
            const person = byNik.get(niks[i]!);
            if (!person) {
              issues.push({
                field: `entries.${i}.nik`,
                message: "Karyawan tidak ditemukan",
              });
              continue;
            }
            const documentId = await documentInForce(
              tx,
              person.departmentId,
              body.date
            );
            if (!documentId) {
              issues.push({
                field: `entries.${i}.nik`,
                message:
                  "Roster bulan itu untuk departemen karyawan ini belum ada",
              });
              continue;
            }
            const [live] = await tx
              .select({ id: fix.id })
              .from(fix)
              .where(
                and(
                  eq(fix.employeeId, person.id),
                  eq(fix.date, body.date),
                  isNull(fix.revokedAt)
                )
              )
              .limit(1);
            if (live) {
              issues.push({
                field: `entries.${i}.nik`,
                message: alreadyCorrected.message,
              });
              continue;
            }
            const [current] = await tx
              .select({ code: day.code })
              .from(day)
              .where(
                and(
                  eq(day.documentId, documentId),
                  eq(day.employeeId, person.id),
                  eq(day.date, body.date)
                )
              )
              .limit(1);
            const fromCode = (current?.code ?? null) as RosterCode | null;
            if (fromCode === entry.code) {
              issues.push({
                field: `entries.${i}.code`,
                message: `Roster hari itu sudah ${entry.code}`,
              });
              continue;
            }
            ready.push({
              cell: { documentId, employeeId: person.id, date: body.date },
              fromCode,
              code: entry.code,
              reason: entry.reason.trim(),
            });
          }
          if (issues.length) throw new Refusal(issues);

          const created: string[] = [];
          for (const item of ready) {
            const [row] = await tx
              .insert(fix)
              .values({
                employeeId: item.cell.employeeId,
                date: body.date,
                fromCode: item.fromCode,
                toCode: item.code,
                reason: item.reason,
                createdBy: principal.id,
              })
              .returning({ id: fix.id });
            await writeDay(tx, item.cell, item.code);
            created.push(row!.id);
          }
          return created;
        });

        await recheckHolds(body.date);
        const rows = await correctionQuery().where(inArray(fix.id, ids));
        const byId = new Map(rows.map((row) => [row.id, row]));
        return ids.map((id) => toWire(byId.get(id)!));
      } catch (error) {
        if (error instanceof Refusal) return status(422, refused(error.issues));
        /* One live correction per person-day, held by the index: two admins
           correcting the same day at once both pass the read above. */
        if (isUniqueViolation(error, LIVE_INDEX))
          return status(409, alreadyCorrected);
        throw error;
      }
    },
    {
      auth: { menu: "roster-correction", mode: "manage" },
      body: t.Object({
        date: t.String({ format: "date" }),
        entries: t.Array(
          t.Object({
            nik: t.String({ minLength: 1 }),
            code: RosterCodeSchema,
            reason: t.String({ minLength: 3, maxLength: 500 }),
          }),
          { minItems: 1, maxItems: 200 }
        ),
      }),
      response: {
        200: t.Array(RosterCorrectionSchema),
        401: ErrorSchema,
        403: ErrorSchema,
        409: ErrorSchema,
        422: ValidationIssuesSchema,
      },
      detail: {
        summary: "Correct one date for several people; all or nothing, at once",
      },
    }
  )

  /*
   * Withdraw a correction: the day goes back to what it was when it was made,
   * and the next pull makes it whatever unggul_att says by then. The row stays
   * as the record of who changed what.
   */
  .post(
    "/:id/revoke",
    async ({ params, principal, status }) => {
      if (principal.kind !== "user") return status(403, forbidden);

      const [target] = await db
        .select({
          id: fix.id,
          employeeId: fix.employeeId,
          departmentId: emp.departmentId,
          date: fix.date,
          fromCode: fix.fromCode,
          revokedAt: fix.revokedAt,
        })
        .from(fix)
        .innerJoin(emp, eq(emp.id, fix.employeeId))
        .where(and(eq(fix.id, params.id), await scopeOf(principal)))
        .limit(1);
      if (!target) return status(404, notFound);
      if (target.revokedAt) return status(409, alreadyRevoked);

      const revoked = await db.transaction(async (tx) => {
        /* Guarded on still being live, so two withdrawals at once restore the
           day once and the second answers as already withdrawn. */
        const [done] = await tx
          .update(fix)
          .set({ revokedAt: new Date(), revokedBy: principal.id })
          .where(and(eq(fix.id, target.id), isNull(fix.revokedAt)))
          .returning({ id: fix.id });
        if (!done) return false;

        const documentId = await documentInForce(
          tx,
          target.departmentId,
          target.date
        );
        if (!documentId) return true;
        if (target.fromCode === null)
          await tx
            .delete(day)
            .where(
              and(
                eq(day.documentId, documentId),
                eq(day.employeeId, target.employeeId),
                eq(day.date, target.date)
              )
            );
        else
          await writeDay(
            tx,
            {
              documentId,
              employeeId: target.employeeId,
              date: target.date,
            },
            target.fromCode
          );
        return true;
      });
      if (!revoked) return status(409, alreadyRevoked);

      await recheckHolds(target.date);
      const [row] = await correctionQuery()
        .where(eq(fix.id, target.id))
        .limit(1);
      return toWire(row!);
    },
    {
      auth: { menu: "roster-correction", mode: "manage" },
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      response: {
        200: RosterCorrectionSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
        409: ErrorSchema,
      },
      detail: { summary: "Withdraw a roster correction" },
    }
  );
