/**
 * Roster documents and the days they carry.
 *
 * The roster is the first input of the allocation engine, and this file is the
 * read side of it: which uploads exist, what one of them says, and — the
 * question the whole product turns on — who is scheduled for a shift on a given
 * date. Writing a roster is the importer's job (`roster-import.ts`); changing
 * one day of it is the revision's (`roster-revision.ts`).
 *
 * Two shapes here are unlike the rest of the API and both follow from size
 * (design D8). A month for one department is roughly 2,000 rows and a year is
 * 750,000, so:
 *
 * - the grid is **paginated by the API**, by employee, never by cell; and
 * - the aggregates on the document list are counted for the documents on the
 *   page rather than by grouping the whole day table.
 */

import {
  and,
  asc,
  countDistinct,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { Elysia, t } from "elysia";
import {
  ROSTER_CODE_KIND,
  type RosterCode,
  type SessionPrincipal,
} from "@universe/contracts";

import { requireAuth } from "../auth/macro";
import { scopeWhere } from "../auth/scope";
import { db, schema } from "../db";
import { monthDays, monthToFirstDay } from "./roster-month";
import { rosterWorkbook } from "./roster-import";
import {
  ErrorSchema,
  OptionalRosterCodeSchema,
  OptionalRosterDocumentStatusSchema,
  RosterDocumentSchema,
  RosterGridSchema,
  RosterInForceSchema,
} from "./schemas";

const doc = schema.rosterDocuments;
const day = schema.rosterDays;
const emp = schema.employees;
const dpt = schema.departments;
const pos = schema.positions;
const usr = schema.users;

/* ------------------------------------------------------------------- scope */

/**
 * Which documents a caller may see.
 *
 * `dept` resolves through `department_id` like every other scoped collection.
 * `self` has no column on this table — a document belongs to a department, not
 * to a person — so rather than letting `scopeWhere` fail closed and leave an
 * operator staring at an empty Roster Data screen, a document is in scope for a
 * `self` caller when it carries a day **for them**. That is the same lifting
 * the revision spec asks for on submissions: the parent is reachable when a
 * child of it is.
 *
 * The row-level restriction is not weakened by this — `/:id/days` scopes the
 * rows themselves, so a `self` caller reaching a document still sees only its
 * own line of it.
 */
async function documentScope(principal: SessionPrincipal): Promise<SQL> {
  if (principal.kind === "user" && principal.scope === "self") {
    if (!principal.nik) return sql`false`;
    return exists(
      db
        .select({ one: sql`1` })
        .from(day)
        .innerJoin(emp, eq(emp.id, day.employeeId))
        .where(and(eq(day.documentId, doc.id), eq(emp.nik, principal.nik)))
    );
  }
  return scopeWhere(principal, { dept: doc.departmentId });
}

/* ------------------------------------------------------------- document read */

const documentColumns = {
  id: doc.id,
  departmentId: doc.departmentId,
  departmentName: dpt.name,
  month: doc.month,
  fileName: doc.fileName,
  uploadedById: doc.uploadedBy,
  uploadedByName: usr.name,
  status: doc.status,
  createdAt: doc.createdAt,
};

function documentQuery() {
  return db
    .select(documentColumns)
    .from(doc)
    .innerJoin(dpt, eq(dpt.id, doc.departmentId))
    .innerJoin(usr, eq(usr.id, doc.uploadedBy));
}

type DocumentJoinRow = Awaited<ReturnType<typeof documentQuery>>[number];

/**
 * How many people and how many rows each of these documents holds.
 *
 * Restricted to the ids on the page rather than grouping `roster_days` whole:
 * the unique index on `(document_id, employee_id, date)` serves this directly,
 * and a group-by over the year would read 750,000 rows to decorate twelve.
 */
async function countsFor(
  ids: string[]
): Promise<Map<string, { employeeCount: number; dayCount: number }>> {
  const counts = new Map<string, { employeeCount: number; dayCount: number }>();
  if (!ids.length) return counts;
  const rows = await db
    .select({
      documentId: day.documentId,
      employeeCount: countDistinct(day.employeeId),
      dayCount: sql<number>`count(*)::int`,
    })
    .from(day)
    .where(inArray(day.documentId, ids))
    .groupBy(day.documentId);
  for (const row of rows)
    counts.set(row.documentId, {
      employeeCount: Number(row.employeeCount),
      dayCount: Number(row.dayCount),
    });
  return counts;
}

async function toDocuments(rows: DocumentJoinRow[]) {
  const counts = await countsFor(rows.map((r) => r.id));
  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    employeeCount: counts.get(row.id)?.employeeCount ?? 0,
    dayCount: counts.get(row.id)?.dayCount ?? 0,
  }));
}

const documentNotFound = {
  code: "roster_document_not_found",
  message: "Dokumen roster tidak ditemukan",
};

/* ------------------------------------------------------------------- grid */

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 25;

export const rosterRoutes = new Elysia({
  prefix: "/roster",
  tags: ["roster"],
})
  .use(requireAuth)

  .get(
    "/",
    async ({ query, principal }) => {
      const needle = query.q?.trim();
      const month = query.month ? monthToFirstDay(query.month) : null;
      const filters = [
        await documentScope(principal),
        query.departmentId
          ? eq(doc.departmentId, query.departmentId)
          : undefined,
        // A month that does not parse filters to nothing rather than being
        // ignored: silently widening a filter is how an archived document from
        // another month ends up looking current.
        query.month ? eq(doc.month, month ?? "") : undefined,
        query.status ? eq(doc.status, query.status) : undefined,
        needle
          ? or(
              ilike(doc.fileName, `%${needle}%`),
              ilike(dpt.name, `%${needle}%`),
              ilike(usr.name, `%${needle}%`)
            )
          : undefined,
      ].filter((f) => f !== undefined);

      const rows = await documentQuery()
        .where(and(...filters))
        // Newest month first, and within a month the newest upload — which is
        // the active one, since re-uploading archives what came before.
        .orderBy(desc(doc.month), desc(doc.createdAt));
      return toDocuments(rows);
    },
    {
      auth: { menu: "roster-data", mode: "view" },
      query: t.Object({
        q: t.Optional(t.String()),
        departmentId: t.Optional(t.String()),
        /** `YYYY-MM`. */
        month: t.Optional(t.String()),
        status: OptionalRosterDocumentStatusSchema,
      }),
      response: {
        200: t.Array(RosterDocumentSchema),
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: { summary: "List roster documents, newest month first" },
    }
  )

  /* Declared before /:id so "in-force" is never parsed as a document id. */
  .get(
    "/in-force",
    async ({ query, principal }) => {
      const filters = [
        eq(day.date, query.date),
        // The roster in force is the active document's, and only its. Archived
        // documents keep their rows precisely so that this predicate can be the
        // only thing separating history from truth (design D5).
        eq(doc.status, "aktif"),
        await scopeWhere(principal, { dept: emp.departmentId, self: emp.nik }),
        query.code ? eq(day.code, query.code) : undefined,
        query.departmentId
          ? eq(doc.departmentId, query.departmentId)
          : undefined,
      ].filter((f) => f !== undefined);

      const rows = await db
        .select({
          employeeId: emp.id,
          nik: emp.nik,
          name: emp.name,
          departmentId: emp.departmentId,
          code: day.code,
        })
        .from(day)
        .innerJoin(doc, eq(doc.id, day.documentId))
        .innerJoin(emp, eq(emp.id, day.employeeId))
        .where(and(...filters))
        .orderBy(asc(emp.name));

      // Resolved here rather than stored (design D2): the map in contracts is
      // the only definition of a kind, so a stored row cannot disagree with it.
      return rows.map((row) => ({
        ...row,
        kind: ROSTER_CODE_KIND[row.code as RosterCode],
      }));
    },
    {
      auth: { menu: "roster-data", mode: "view" },
      query: t.Object({
        /** ISO `YYYY-MM-DD`. */
        date: t.String({ format: "date" }),
        code: OptionalRosterCodeSchema,
        departmentId: t.Optional(t.String()),
      }),
      response: {
        200: t.Array(RosterInForceSchema),
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: {
        summary: "The roster in force for a date — active documents only",
      },
    }
  )

  /**
   * The document as a spreadsheet.
   *
   * Declared before `/:id` for the same reason `employees.ts` declares its
   * export before `/:nik`: a path segment that could be read as an identifier
   * has to be claimed first.
   */
  .get(
    "/:id/export",
    async ({ params, principal, set, status }) => {
      const [document] = await db
        .select({ id: doc.id, month: doc.month, fileName: doc.fileName })
        .from(doc)
        .where(and(eq(doc.id, params.id), await documentScope(principal)))
        .limit(1);
      if (!document) return status(404, documentNotFound);

      const days = monthDays(document.month);
      // Departemen and posisi come along because the export is the same
      // document as the template (import D7) — a file downloaded to be
      // corrected has to be a file the import will take back.
      const cells = await db
        .select({
          employeeId: day.employeeId,
          nik: emp.nik,
          name: emp.name,
          department: dpt.name,
          position: pos.name,
          date: day.date,
          code: day.code,
        })
        .from(day)
        .innerJoin(emp, eq(emp.id, day.employeeId))
        .innerJoin(dpt, eq(dpt.id, emp.departmentId))
        .innerJoin(pos, eq(pos.id, emp.positionId))
        .where(
          and(
            eq(day.documentId, document.id),
            await scopeWhere(principal, {
              dept: emp.departmentId,
              self: emp.nik,
            })
          )
        )
        .orderBy(asc(pos.name), asc(emp.name));

      const byEmployee = new Map<
        string,
        {
          nik: string;
          name: string;
          department: string;
          position: string;
          codes: Map<string, RosterCode>;
        }
      >();
      for (const cell of cells) {
        let row = byEmployee.get(cell.employeeId);
        if (!row)
          byEmployee.set(
            cell.employeeId,
            (row = {
              nik: cell.nik,
              name: cell.name,
              department: cell.department,
              position: cell.position,
              codes: new Map(),
            })
          );
        row.codes.set(cell.date, cell.code as RosterCode);
      }

      set.headers["content-type"] =
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      set.headers["content-disposition"] =
        `attachment; filename="roster_${document.month.slice(0, 7)}.xlsx"`;
      return new Response(
        new Uint8Array(
          await rosterWorkbook(
            document.month,
            [...byEmployee.values()].map((row) => ({
              nik: row.nik,
              name: row.name,
              department: row.department,
              position: row.position,
              codes: days.map((d) => row.codes.get(d) ?? null),
            }))
          )
        )
      );
    },
    {
      auth: { menu: "roster-data", mode: "view" },
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      // Described by hand: the body is a binary workbook, and a TypeBox
      // `response` schema would try to validate it as an object.
      detail: {
        summary: "Download a roster document as a spreadsheet",
        responses: {
          200: {
            description:
              "An .xlsx whose columns are exactly what the roster import accepts",
            content: {
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
                { schema: { type: "string", format: "binary" } },
            },
          },
          401: { description: "No session" },
          403: { description: "Lacks view on roster-data" },
          404: { description: "No such document, or out of scope" },
        },
      },
    }
  )

  .get(
    "/:id",
    async ({ params, principal, status }) => {
      const [row] = await documentQuery()
        .where(and(eq(doc.id, params.id), await documentScope(principal)))
        .limit(1);
      if (!row) return status(404, documentNotFound);
      const [document] = await toDocuments([row]);
      return document!;
    },
    {
      auth: { menu: "roster-data", mode: "view" },
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      response: {
        200: RosterDocumentSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
      },
      detail: { summary: "One roster document" },
    }
  )

  /**
   * A page of a document's grid (design D8).
   *
   * Two queries and a fold rather than one: the page is decided by *employee*,
   * so the people come first and their cells second. Fetching cells first and
   * slicing them would cut a person's month in half at the page boundary.
   */
  .get(
    "/:id/days",
    async ({ params, query, principal, status }) => {
      const [document] = await db
        .select({ id: doc.id, month: doc.month })
        .from(doc)
        .where(and(eq(doc.id, params.id), await documentScope(principal)))
        .limit(1);
      if (!document) return status(404, documentNotFound);

      const days = monthDays(document.month);
      const page = Math.max(1, query.page ?? 1);
      const pageSize = Math.min(
        MAX_PAGE_SIZE,
        Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE)
      );
      const needle = query.q?.trim();

      const rowFilters = [
        eq(day.documentId, document.id),
        // Scoped on the rows themselves, so a `self` caller who reached the
        // document sees its own line of it and nothing else.
        await scopeWhere(principal, { dept: emp.departmentId, self: emp.nik }),
        needle
          ? or(ilike(emp.nik, `%${needle}%`), ilike(emp.name, `%${needle}%`))
          : undefined,
      ].filter((f) => f !== undefined);

      // The people on this page, and how many there are in total. `groupBy`
      // rather than `distinct` so the ordering column is unambiguous.
      const people = await db
        .select({ id: emp.id, nik: emp.nik, name: emp.name })
        .from(day)
        .innerJoin(emp, eq(emp.id, day.employeeId))
        .where(and(...rowFilters))
        .groupBy(emp.id, emp.nik, emp.name)
        .orderBy(asc(emp.name));

      const total = people.length;
      const pageRows = people.slice((page - 1) * pageSize, page * pageSize);
      if (!pageRows.length) return { days, rows: [], total, page, pageSize };

      const cells = await db
        .select({
          employeeId: day.employeeId,
          date: day.date,
          code: day.code,
        })
        .from(day)
        .where(
          and(
            eq(day.documentId, document.id),
            inArray(
              day.employeeId,
              pageRows.map((p) => p.id)
            )
          )
        );

      const byEmployee = new Map<string, Map<string, RosterCode>>();
      for (const cell of cells) {
        let row = byEmployee.get(cell.employeeId);
        if (!row) byEmployee.set(cell.employeeId, (row = new Map()));
        row.set(cell.date, cell.code as RosterCode);
      }

      return {
        days,
        rows: pageRows.map((person) => {
          const codes = byEmployee.get(person.id);
          return {
            employeeId: person.id,
            nik: person.nik,
            name: person.name,
            // Positional, aligned to `days` — see `RosterGridRowSchema`.
            codes: days.map((d) => codes?.get(d) ?? null),
          };
        }),
        total,
        page,
        pageSize,
      };
    },
    {
      auth: { menu: "roster-data", mode: "view" },
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      query: t.Object({
        q: t.Optional(t.String()),
        page: t.Optional(t.Integer({ minimum: 1 })),
        pageSize: t.Optional(t.Integer({ minimum: 1, maximum: MAX_PAGE_SIZE })),
      }),
      response: {
        200: RosterGridSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
      },
      detail: { summary: "A page of a roster document's grid" },
    }
  );

/* Shared with the importer and the revision routes so all three resolve a
   document, its month, and its scope the same way. */
export { documentQuery, documentScope, toDocuments, documentNotFound };
export type { DocumentJoinRow };
