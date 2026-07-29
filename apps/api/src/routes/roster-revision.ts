/**
 * Roster revisions: asking for one day to change, and deciding it.
 *
 * A submission holds N entries and **the status lives on the entry** (design
 * D10). That is not a modelling preference — it is what the screens already
 * imply: the revision list renders a *set* of badges per submission, and the
 * approval screen has buttons per row. One submission of three entries can end
 * two approved and one rejected, and forcing a single verdict would make an
 * approver refuse the whole thing over one wrong line.
 *
 * Four rules are load-bearing and each has a decision behind it:
 *
 * - **`from_code` is stored, not recomputed** (D10). An entry that waited two
 *   days would otherwise approve a change away from a code that was never the
 *   one submitted, and the history would read as a lie. When it no longer
 *   matches what is in force, the decision is refused with both values named.
 * - **Approving writes the roster in place** (D11). The overlay alternative
 *   would put a join per day on the largest table in the system, on the one
 *   query that has a five-minute window to finish in.
 * - **The employee an entry names is decided by the server** (D13). A NIK in a
 *   request body is a claim: a `self` caller's entries are recorded against
 *   itself whatever the body says, and a `dept` admin naming another
 *   department's NIK is answered 404 rather than obeyed.
 * - **The submitter may also be the decider** (D18). Separation of duties is
 *   enforced by which roles exist, not by a branch here — a site with one
 *   manager would otherwise have no way to change that manager's own roster.
 */

import { and, asc, desc, eq, ilike, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Elysia, t } from "elysia";
import type { RosterCode, SessionPrincipal } from "@universe/contracts";

import { requireAuth } from "../auth/macro";
import { scopeWhere } from "../auth/scope";
import { db, schema, type Transaction } from "../db";
import { monthEnd } from "./roster-month";
import {
  ErrorSchema,
  OptionalRosterRevisionStatusSchema,
  RosterCodeSchema,
  RosterConflictSchema,
  RosterRevisionItemSchema,
  RosterRevisionSchema,
  ValidationIssuesSchema,
} from "./schemas";

const rev = schema.rosterRevisions;
const item = schema.rosterRevisionItems;
const doc = schema.rosterDocuments;
const day = schema.rosterDays;
const emp = schema.employees;
const dpt = schema.departments;

/**
 * Submitter and decider are two joins onto `users`, so the second is aliased.
 * Without it the second join replaces the first and every decided entry reports
 * its approver as the person who submitted it.
 */
const submitter = alias(schema.users, "submitter");
const decider = alias(schema.users, "decider");

/* ---------------------------------------------------------------- the read */

const itemColumns = {
  id: item.id,
  revisionId: item.revisionId,
  revisionCode: rev.code,
  documentId: rev.documentId,
  documentMonth: doc.month,
  documentStatus: doc.status,
  employeeId: item.employeeId,
  nik: emp.nik,
  employeeName: emp.name,
  departmentId: emp.departmentId,
  departmentName: dpt.name,
  date: item.date,
  fromCode: item.fromCode,
  toCode: item.toCode,
  startTime: item.startTime,
  endTime: item.endTime,
  reason: item.reason,
  status: item.status,
  submittedById: rev.submittedBy,
  submittedByName: submitter.name,
  submittedAt: rev.submittedAt,
  decidedById: item.decidedBy,
  decidedByName: decider.name,
  decidedAt: item.decidedAt,
  decisionNote: item.decisionNote,
};

function itemQuery() {
  return (
    db
      .select(itemColumns)
      .from(item)
      .innerJoin(rev, eq(rev.id, item.revisionId))
      .innerJoin(doc, eq(doc.id, rev.documentId))
      .innerJoin(emp, eq(emp.id, item.employeeId))
      .innerJoin(dpt, eq(dpt.id, emp.departmentId))
      .innerJoin(submitter, eq(submitter.id, rev.submittedBy))
      // Left, because an entry that nobody has decided yet has no decider — an
      // inner join here would hide the whole pending queue.
      .leftJoin(decider, eq(decider.id, item.decidedBy))
  );
}

type ItemJoinRow = Awaited<ReturnType<typeof itemQuery>>[number];

/** Postgres hands a `time` back as `HH:MM:SS`; the form speaks `HH:MM`. */
const shortTime = (value: string | null) => (value ? value.slice(0, 5) : null);

function toItem(row: ItemJoinRow) {
  return {
    ...row,
    startTime: shortTime(row.startTime),
    endTime: shortTime(row.endTime),
    submittedAt: row.submittedAt.toISOString(),
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    // A decision is possible only while the entry is pending *and* the document
    // it belongs to is still the one in force (design D12).
    decidable: row.status === "pending" && row.documentStatus === "aktif",
  };
}

/** Entries folded back into the submissions they belong to, newest first. */
function toRevisions(rows: ItemJoinRow[]) {
  const byRevision = new Map<string, ReturnType<typeof toItem>[]>();
  const order: string[] = [];
  for (const row of rows) {
    const list = byRevision.get(row.revisionId);
    if (list) list.push(toItem(row));
    else {
      byRevision.set(row.revisionId, [toItem(row)]);
      order.push(row.revisionId);
    }
  }
  return order.map((id) => {
    const items = byRevision.get(id)!;
    const first = items[0]!;
    return {
      id,
      code: first.revisionCode,
      documentId: first.documentId,
      documentMonth: first.documentMonth,
      documentStatus: first.documentStatus,
      departmentId: first.departmentId,
      departmentName: first.departmentName,
      submittedById: first.submittedById,
      submittedByName: first.submittedByName,
      submittedAt: first.submittedAt,
      items,
    };
  });
}

/* ------------------------------------------------------------------ helpers */

const itemNotFound = {
  code: "roster_revision_item_not_found",
  message: "Entri revisi tidak ditemukan",
};

const validationError = (field: string, message: string) => ({
  code: "validation_failed",
  message,
  issues: [{ field, message }],
});

/**
 * The next `REV-nnnn`, derived from the highest one stored.
 *
 * Read-then-write rather than a Postgres sequence: the code is a label people
 * read aloud and quote in a message, and a sequence leaves gaps wherever a
 * transaction rolls back. The race that costs is caught by the unique index on
 * `code`, which turns a collision into a refused insert rather than two
 * submissions sharing a name.
 */
async function nextRevisionCode(tx: Transaction): Promise<string> {
  const [latest] = await tx
    .select({ code: rev.code })
    .from(rev)
    .orderBy(desc(rev.code))
    .limit(1);
  const n = latest ? Number(latest.code.replace(/\D/g, "")) : 0;
  return `REV-${String((Number.isFinite(n) ? n : 0) + 1).padStart(4, "0")}`;
}

/** `2026-07-21` → `2026-07-01`, the month key a document is stored under. */
const monthOf = (date: string) => `${date.slice(0, 7)}-01`;

/**
 * The employee an entry is about (design D13, rbac spec).
 *
 * Where the caller's scope identifies exactly one person, that person is the
 * subject and the body's `nik` has no effect — not "is corrected", *has no
 * effect*, because a hidden control is not the boundary. Where the scope is
 * wider, the named value is checked against the same predicate every read uses
 * before anything is written.
 */
type Subject = { id: string; nik: string; name: string; departmentId: string };

async function resolveSubject(
  principal: SessionPrincipal,
  nik: string | undefined
): Promise<Subject | { refused: "missing" | "unreachable"; message: string }> {
  if (principal.kind !== "user")
    return { refused: "unreachable", message: "Akses ditolak" };

  const wanted = principal.scope === "self" ? principal.nik : nik?.trim();
  if (!wanted)
    return {
      refused: principal.scope === "self" ? "unreachable" : "missing",
      message:
        principal.scope === "self"
          ? "Akun ini tidak punya NIK, revisinya tidak bisa diajukan"
          : "NIK karyawan wajib diisi",
    };

  const [row] = await db
    .select({
      id: emp.id,
      nik: emp.nik,
      name: emp.name,
      departmentId: emp.departmentId,
    })
    .from(emp)
    .where(
      and(
        eq(emp.nik, wanted),
        // The same predicate as every scoped read. A `dept` admin sending a
        // NIK from another department lands here and finds nothing.
        await scopeWhere(principal, { dept: emp.departmentId, self: emp.nik })
      )
    )
    .limit(1);
  // 404, not 422: "out of scope" and "does not exist" are answered identically
  // on purpose, because a validation error that only fires for real NIKs is a
  // way to enumerate the register one guess at a time.
  if (!row)
    return {
      refused: "unreachable",
      message: `Karyawan ${wanted} tidak ditemukan`,
    };
  return row;
}

/* ------------------------------------------------------------------- routes */

export const rosterRevisionRoutes = new Elysia({
  prefix: "/roster-revisions",
  tags: ["roster-revision"],
})
  .use(requireAuth)

  .get(
    "/",
    async ({ query, principal }) => {
      const needle = query.q?.trim();
      const filters = [
        // Scoped on the *entry's* employee, which is what makes a `self` caller
        // see the revisions concerning itself and nothing else.
        await scopeWhere(principal, { dept: emp.departmentId, self: emp.nik }),
        query.status ? eq(item.status, query.status) : undefined,
        query.documentId ? eq(rev.documentId, query.documentId) : undefined,
        needle
          ? or(
              ilike(rev.code, `%${needle}%`),
              ilike(emp.nik, `%${needle}%`),
              ilike(emp.name, `%${needle}%`)
            )
          : undefined,
      ].filter((f) => f !== undefined);

      const rows = await itemQuery()
        .where(and(...filters))
        .orderBy(desc(rev.submittedAt), asc(item.date));
      return toRevisions(rows);
    },
    {
      auth: { menu: "roster-revision", mode: "view" },
      query: t.Object({
        q: t.Optional(t.String()),
        status: OptionalRosterRevisionStatusSchema,
        documentId: t.Optional(t.String()),
      }),
      response: {
        200: t.Array(RosterRevisionSchema),
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: { summary: "List revision submissions with their entries" },
    }
  )

  /**
   * The approval queue.
   *
   * A separate route rather than a filter on the list above because it answers
   * to a different menu: `roster-approval`, which is the only grant that lets
   * anyone decide anything. Entries come back flat and oldest first — a queue
   * is worked through, not browsed.
   */
  .get(
    "/queue",
    async ({ query, principal }) => {
      const needle = query.q?.trim();
      const filters = [
        await scopeWhere(principal, { dept: emp.departmentId, self: emp.nik }),
        eq(item.status, query.status ?? "pending"),
        needle
          ? or(
              ilike(rev.code, `%${needle}%`),
              ilike(emp.nik, `%${needle}%`),
              ilike(emp.name, `%${needle}%`)
            )
          : undefined,
      ].filter((f) => f !== undefined);

      const rows = await itemQuery()
        .where(and(...filters))
        .orderBy(asc(rev.submittedAt), asc(item.date));
      return rows.map(toItem);
    },
    {
      auth: { menu: "roster-approval", mode: "view" },
      query: t.Object({
        q: t.Optional(t.String()),
        status: OptionalRosterRevisionStatusSchema,
      }),
      response: {
        200: t.Array(RosterRevisionItemSchema),
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: { summary: "The approval queue, oldest submission first" },
    }
  )

  /**
   * Submit one revision carrying N entries.
   *
   * Every entry is validated before anything is written, and all of them belong
   * to one document — a submission that spanned two months would have no single
   * document to be frozen with when one of them is re-uploaded (design D12).
   *
   * A past date and a future date are equally valid (D17). The only boundary is
   * the month of the document being revised, because outside it there is no
   * roster day to change.
   */
  .post(
    "/",
    async ({ body, principal, status }) => {
      if (principal.kind !== "user")
        return status(403, { code: "forbidden", message: "Akses ditolak" });

      type Prepared = {
        employeeId: string;
        date: string;
        fromCode: RosterCode;
        toCode: RosterCode;
        startTime: string | null;
        endTime: string | null;
        reason: string;
      };
      const prepared: Prepared[] = [];
      let documentId: string | null = null;

      for (const [index, entry] of body.entries.entries()) {
        const field = `entries.${index}`;

        const reason = entry.reason.trim();
        if (!reason)
          return status(
            422,
            validationError(`${field}.reason`, "Alasan wajib diisi")
          );

        const subject = await resolveSubject(principal, entry.nik);
        if ("refused" in subject)
          return subject.refused === "unreachable"
            ? status(404, {
                code: "employee_not_found",
                message: subject.message,
              })
            : status(422, validationError(`${field}.nik`, subject.message));

        // The document in force for that person's department and that month.
        const [document] = await db
          .select({ id: doc.id, month: doc.month })
          .from(doc)
          .where(
            and(
              eq(doc.departmentId, subject.departmentId),
              eq(doc.month, monthOf(entry.date)),
              eq(doc.status, "aktif")
            )
          )
          .limit(1);
        if (!document)
          return status(
            422,
            validationError(
              `${field}.date`,
              `Belum ada roster aktif untuk ${entry.date.slice(0, 7)} di departemen karyawan ${subject.nik}`
            )
          );

        // Redundant against the lookup above — the month key is derived from
        // the date — but stated so the rule survives a change to how a document
        // is found, and so the message names the boundary rather than the miss.
        if (
          entry.date < document.month ||
          entry.date > monthEnd(document.month)
        )
          return status(
            422,
            validationError(
              `${field}.date`,
              `Tanggal ${entry.date} di luar bulan dokumen roster ${document.month.slice(0, 7)}`
            )
          );

        if (documentId && documentId !== document.id)
          return status(
            422,
            validationError(
              `${field}.date`,
              "Satu pengajuan hanya boleh menyangkut satu dokumen roster — pisahkan per bulan atau per departemen"
            )
          );
        documentId = document.id;

        const [current] = await db
          .select({ code: day.code })
          .from(day)
          .where(
            and(
              eq(day.documentId, document.id),
              eq(day.employeeId, subject.id),
              eq(day.date, entry.date)
            )
          )
          .limit(1);
        if (!current)
          return status(
            422,
            validationError(
              `${field}.date`,
              `Roster ${document.month.slice(0, 7)} tidak punya baris untuk ${subject.nik} pada ${entry.date}`
            )
          );

        prepared.push({
          employeeId: subject.id,
          date: entry.date,
          // Captured now rather than at decision time (design D10).
          fromCode: current.code as RosterCode,
          toCode: entry.toCode,
          startTime: entry.startTime?.trim() || null,
          endTime: entry.endTime?.trim() || null,
          reason,
        });
      }

      const revisionId = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(rev)
          .values({
            code: await nextRevisionCode(tx),
            documentId: documentId!,
            submittedBy: principal.id,
          })
          .returning({ id: rev.id });
        await tx
          .insert(item)
          .values(prepared.map((p) => ({ ...p, revisionId: created!.id })));
        return created!.id;
      });

      const rows = await itemQuery()
        .where(eq(item.revisionId, revisionId))
        .orderBy(asc(item.date));
      return status(201, toRevisions(rows)[0]!);
    },
    {
      auth: { menu: "roster-revision", mode: "manage" },
      body: t.Object({
        entries: t.Array(
          t.Object({
            /**
             * Validated against the caller's scope, and ignored entirely for a
             * caller whose scope names exactly one person (design D13).
             */
            nik: t.Optional(t.String()),
            date: t.String({ format: "date" }),
            toCode: RosterCodeSchema,
            /** Optional pair, and stored only here — never on a roster day. */
            startTime: t.Optional(t.Nullable(t.String())),
            endTime: t.Optional(t.Nullable(t.String())),
            reason: t.String({ minLength: 1 }),
          }),
          { minItems: 1 }
        ),
      }),
      response: {
        201: RosterRevisionSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
        422: ValidationIssuesSchema,
      },
      detail: { summary: "Submit a revision carrying one or more entries" },
    }
  )

  /**
   * Approve one entry, writing its code onto the roster (design D11).
   *
   * The status change and the roster write share one transaction, so a failed
   * write leaves the entry pending rather than approved-but-not-applied — which
   * would be a decision nobody could find and nobody could repeat.
   */
  .post(
    "/items/:id/approve",
    async ({ params, body, principal, status }) => {
      if (principal.kind !== "user")
        return status(403, { code: "forbidden", message: "Akses ditolak" });

      const [row] = await itemQuery()
        .where(
          and(
            eq(item.id, params.id),
            await scopeWhere(principal, {
              dept: emp.departmentId,
              self: emp.nik,
            })
          )
        )
        .limit(1);
      if (!row) return status(404, itemNotFound);

      if (row.status !== "pending")
        return status(409, {
          code: "already_decided",
          message: `Entri ini sudah ${row.status === "approved" ? "disetujui" : "ditolak"}`,
        });
      if (row.documentStatus !== "aktif")
        return status(409, {
          code: "document_archived",
          message:
            "Dokumen roster yang direvisi sudah diarsipkan — entri ini tidak bisa diputuskan lagi",
        });

      const [current] = await db
        .select({ id: day.id, code: day.code })
        .from(day)
        .where(
          and(
            eq(day.documentId, row.documentId),
            eq(day.employeeId, row.employeeId),
            eq(day.date, row.date)
          )
        )
        .limit(1);
      if (!current)
        return status(409, {
          code: "roster_day_missing",
          message: `Roster tidak lagi punya baris untuk ${row.nik} pada ${row.date}`,
        });

      // The stale check (design D10). Both values are named because the
      // approver has to decide whether the change still makes sense against
      // what the day now says, and cannot do that from the fact that it moved.
      if (current.code !== row.fromCode)
        return status(409, {
          code: "stale_revision",
          message: `Kode hari ini sudah berubah dari ${row.fromCode} menjadi ${current.code} sejak revisi diajukan`,
          recordedCode: row.fromCode as RosterCode,
          currentCode: current.code as RosterCode,
        });

      await db.transaction(async (tx) => {
        await tx
          .update(day)
          .set({ code: row.toCode })
          .where(eq(day.id, current.id));
        await tx
          .update(item)
          .set({
            status: "approved",
            decidedBy: principal.id,
            decidedAt: new Date(),
            // A note is optional on an approval and required on a rejection.
            decisionNote: body?.note?.trim() ?? "",
          })
          .where(eq(item.id, row.id));
      });

      const [updated] = await itemQuery().where(eq(item.id, row.id)).limit(1);
      return toItem(updated!);
    },
    {
      auth: { menu: "roster-approval", mode: "manage" },
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: t.Optional(t.Object({ note: t.Optional(t.String()) })),
      response: {
        200: RosterRevisionItemSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
        409: t.Union([RosterConflictSchema, ErrorSchema]),
      },
      detail: {
        summary: "Approve an entry and write its code onto the roster",
      },
    }
  )

  /** Rejecting requires a reason; the roster is not touched (design D11). */
  .post(
    "/items/:id/reject",
    async ({ params, body, principal, status }) => {
      if (principal.kind !== "user")
        return status(403, { code: "forbidden", message: "Akses ditolak" });

      const reason = body.reason.trim();
      if (!reason)
        return status(
          422,
          validationError("reason", "Alasan penolakan wajib diisi")
        );

      const [row] = await itemQuery()
        .where(
          and(
            eq(item.id, params.id),
            await scopeWhere(principal, {
              dept: emp.departmentId,
              self: emp.nik,
            })
          )
        )
        .limit(1);
      if (!row) return status(404, itemNotFound);

      if (row.status !== "pending")
        return status(409, {
          code: "already_decided",
          message: `Entri ini sudah ${row.status === "approved" ? "disetujui" : "ditolak"}`,
        });
      if (row.documentStatus !== "aktif")
        return status(409, {
          code: "document_archived",
          message:
            "Dokumen roster yang direvisi sudah diarsipkan — entri ini tidak bisa diputuskan lagi",
        });

      await db
        .update(item)
        .set({
          status: "rejected",
          decidedBy: principal.id,
          decidedAt: new Date(),
          decisionNote: reason,
        })
        .where(eq(item.id, row.id));

      const [updated] = await itemQuery().where(eq(item.id, row.id)).limit(1);
      return toItem(updated!);
    },
    {
      auth: { menu: "roster-approval", mode: "manage" },
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: t.Object({ reason: t.String({ minLength: 1 }) }),
      response: {
        200: RosterRevisionItemSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
        409: ErrorSchema,
        422: ValidationIssuesSchema,
      },
      detail: { summary: "Reject an entry — the roster is left alone" },
    }
  );

/* Shared with the tests and the employee-deletion trace. */
export { itemQuery, nextRevisionCode, toItem, toRevisions };
export type { ItemJoinRow };
