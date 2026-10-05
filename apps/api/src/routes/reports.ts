/**
 * The Report menu: five sheets about one shift, on screen and as a workbook.
 *
 * Read-only by nature — every report is built from what the muster already
 * decided (`board-audit`, the board's empty seats, the readings) and nothing
 * here writes. The grant is `report: view`.
 *
 * **Scope is decided here, not by the query string.** A `dept` role (admin,
 * manajer) reads its own department whatever it asks for, and asking for
 * another is a 403 rather than a silent swap, so a screen that drifted out of
 * step with the server fails loudly instead of printing the wrong sheet under
 * the right heading. A `self` role has no department to read a shift's worth of
 * other people through, so it reads nothing.
 */

import { asc, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import {
  REPORT_KINDS,
  SHIFT_KIND_LABELS,
  type SessionPrincipal,
} from "@universe/contracts";

import { requireAuth } from "../auth/macro";
import { departmentIdOfNik } from "../auth/scope";
import { db, schema } from "../db";
import { loadReport } from "../report-data";
import { reportWorkbook } from "./report-export";
import { ErrorSchema, ShiftKindSchema } from "./schemas";

const DATE_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";
const XLSX_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const forbidden = { code: "forbidden", message: "Akses ditolak" };
const unknownDepartment = {
  code: "department_not_found",
  message: "Departemen tidak ditemukan",
};
const noDeadline = (shift: "day" | "night") => ({
  code: "no_deadline",
  message: `Tahap batas untuk shift ${SHIFT_KIND_LABELS[shift].toLowerCase()} tidak aktif — atur dulu di menu Timeline`,
});

type Department = { id: string; name: string };

type DepartmentScope =
  | { kind: "ok"; department: Department | null }
  | { kind: "forbidden" }
  | { kind: "unknown" };

async function departmentById(id: string): Promise<Department | null> {
  const [row] = await db
    .select({ id: schema.departments.id, name: schema.departments.name })
    .from(schema.departments)
    .where(eq(schema.departments.id, id))
    .limit(1);
  return row ?? null;
}

/** The department a caller's report is narrowed to — never wider than theirs. */
async function reportDepartment(
  principal: SessionPrincipal,
  requested: string | undefined
): Promise<DepartmentScope> {
  if (principal.kind !== "user") return { kind: "forbidden" };

  if (principal.scope === "all") {
    if (!requested) return { kind: "ok", department: null };
    const department = await departmentById(requested);
    return department ? { kind: "ok", department } : { kind: "unknown" };
  }

  /* `self`, or a `dept` account whose NIK names nobody: closed, the way
     `scopeWhere` fails for the same accounts. */
  if (principal.scope !== "dept" || !principal.nik)
    return { kind: "forbidden" };
  const own = await departmentIdOfNik(principal.nik);
  if (!own || (requested && requested !== own)) return { kind: "forbidden" };
  const department = await departmentById(own);
  return department ? { kind: "ok", department } : { kind: "forbidden" };
}

const ReportQuery = t.Object({
  date: t.String({ pattern: DATE_PATTERN }),
  shift: ShiftKindSchema,
  department: t.Optional(t.String({ format: "uuid" })),
});

const ReportParams = t.Object({ kind: t.UnionEnum(REPORT_KINDS) });

const cell = t.Optional(t.String());
const ReportRowSchema = t.Object({
  unit: cell,
  simperCode: cell,
  fleet: cell,
  bus: cell,
  location: cell,
  nik: cell,
  name: cell,
  roster: cell,
  position: cell,
  department: cell,
  simperMatrix: cell,
  saveraStatus: cell,
  jamIn: cell,
});

const DepartmentSchema = t.Object({ id: t.String(), name: t.String() });

const ReportSchema = t.Object({
  kind: t.UnionEnum(REPORT_KINDS),
  date: t.String(),
  shift: ShiftKindSchema,
  /** The department the rows were narrowed to; null for the whole site. */
  department: t.Nullable(DepartmentSchema),
  /** Whether the board for this date and shift has been built yet. */
  boardGenerated: t.Boolean(),
  rows: t.Array(ReportRowSchema),
});

export const reportRoutes = new Elysia({ prefix: "/reports", tags: ["report"] })
  .use(requireAuth)

  /**
   * The departments this caller may narrow a report to. Served here rather
   * than read from the master catalogue, whose grant admin and manajer do not
   * hold — and a list offering departments the report would then refuse is a
   * filter that only ever produces a 403.
   */
  .get(
    "/departments",
    async ({ principal }) => {
      if (principal.kind !== "user") return [];
      const base = db
        .select({
          id: schema.departments.id,
          name: schema.departments.name,
          company: schema.companies.code,
        })
        .from(schema.departments)
        .innerJoin(
          schema.companies,
          eq(schema.companies.id, schema.departments.companyId)
        )
        .$dynamic();
      if (principal.scope === "all")
        return base.orderBy(
          asc(schema.departments.name),
          asc(schema.companies.code)
        );
      const scope = await reportDepartment(principal, undefined);
      if (scope.kind !== "ok" || !scope.department) return [];
      return base.where(eq(schema.departments.id, scope.department.id));
    },
    {
      auth: { menu: "report", mode: "view" },
      response: {
        200: t.Array(
          t.Object({ id: t.String(), name: t.String(), company: t.String() })
        ),
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: { summary: "Departments this caller may narrow a report to" },
    }
  )

  .get(
    "/:kind",
    async ({ params, query, principal, status }) => {
      const scope = await reportDepartment(principal, query.department);
      if (scope.kind === "forbidden") return status(403, forbidden);
      if (scope.kind === "unknown") return status(422, unknownDepartment);

      const data = await loadReport(
        params.kind,
        query.date,
        query.shift,
        scope.department?.id ?? null
      );
      if (data.kind === "no-deadline")
        return status(422, noDeadline(query.shift));

      return {
        kind: params.kind,
        date: query.date,
        shift: query.shift,
        department: scope.department,
        boardGenerated: data.boardGenerated,
        rows: data.rows,
      };
    },
    {
      auth: { menu: "report", mode: "view" },
      params: ReportParams,
      query: ReportQuery,
      response: {
        200: ReportSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "One report for a date and shift" },
    }
  )

  /** The same report as the site's template workbook. */
  .get(
    "/:kind/export",
    async ({ params, query, principal, status }) => {
      const scope = await reportDepartment(principal, query.department);
      if (scope.kind === "forbidden") return status(403, forbidden);
      if (scope.kind === "unknown") return status(422, unknownDepartment);

      const data = await loadReport(
        params.kind,
        query.date,
        query.shift,
        scope.department?.id ?? null
      );
      if (data.kind === "no-deadline")
        return status(422, noDeadline(query.shift));

      const buffer = await reportWorkbook({
        kind: params.kind,
        date: query.date,
        shift: query.shift,
        department: scope.department?.name ?? null,
        rows: data.rows,
      });
      const name = `${params.kind}-${query.date}-${SHIFT_KIND_LABELS[query.shift].toLowerCase()}.xlsx`;
      return new Response(new Uint8Array(buffer), {
        headers: {
          "content-type": XLSX_TYPE,
          "content-disposition": `attachment; filename="${name}"`,
        },
      });
    },
    {
      auth: { menu: "report", mode: "view" },
      params: ReportParams,
      query: ReportQuery,
      detail: {
        summary: "One report as an .xlsx in the site's template layout",
        responses: {
          200: {
            description: "The report's workbook",
            content: {
              [XLSX_TYPE]: { schema: { type: "string", format: "binary" } },
            },
          },
          401: { description: "No session" },
          403: { description: "No grant on report, or outside the scope" },
          422: { description: "Bad query, or no deadline for the shift" },
        },
      },
    }
  );
