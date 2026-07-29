/**
 * The employee register.
 *
 * Shaped after `units.ts`, because the problem is the same one: a person's
 * company, position, department, mess, and permit type are foreign keys
 * (design D1/D5), so the interesting work is not CRUD but turning "this
 * position does not exist" into an answer that names the field rather than a
 * 500 from a constraint the caller cannot see. References are resolved before
 * the write for that reason, and for that reason only — the database would
 * refuse a bad key anyway, but it would not say which of five dropdowns was
 * wrong.
 *
 * Two things here are not in `units.ts`:
 *
 * - **Scope.** This is the first collection a `dept` or `self` caller is
 *   actually narrowed on (design D9). `scopeWhere` is applied to every read,
 *   including the single-record one, so a caller cannot reach past its own
 *   department by guessing a NIK — and to every *write* as well, which it was
 *   not at first: a scoped caller could edit, delete, or re-photograph anyone
 *   whose NIK they knew, and `PATCH` returning the updated record made that a
 *   way to read past the scope too. See `writeScope`.
 * - **Skills.** A person's qualification codes are a set, written by replacing
 *   the whole set in one transaction (D4). Half-applied skills would be a spare
 *   who silently matches the wrong units.
 */

import { and, asc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";
import type {
  EffectivePermissions,
  PendingMaster,
  SessionPrincipal,
} from "@universe/contracts";

import { requireAuth } from "../auth/macro";
import { invalidateUser } from "../auth/principal";
import { departmentIdOfNik, scopeWhere } from "../auth/scope";
import {
  db,
  isForeignKeyViolation,
  isUniqueViolation,
  schema,
  type NamedCatalogue,
  type Transaction,
} from "../db";
import {
  deletePhoto,
  MAX_PHOTO_BYTES,
  photoMimeType,
  photoPath,
  storedPhotoName,
  writePhoto,
} from "../storage";
import { holds } from "./master";
import {
  employeeTarget,
  employeeTemplate,
  employeeWorkbook,
  MAX_IMPORT_BYTES,
  readWorkbook,
  validateWorkbook,
  type EmployeeExisting,
} from "./master-import";
import {
  EmployeeSchema,
  ErrorSchema,
  MasterImportPreviewSchema,
  MasterImportResultSchema,
  OptionalBloodTypeSchema,
  OptionalEmployeeStatusSchema,
  OptionalMcuResultSchema,
  ValidationIssuesSchema,
} from "./schemas";

/* Aliased so five joins onto five different catalogues stay readable. */
const emp = schema.employees;
const cmp = schema.companies;
const pos = schema.positions;
const dpt = schema.departments;
const mss = schema.mess;
const spt = schema.simperTypes;
const spc = schema.simperCodes;

const employeeColumns = {
  id: emp.id,
  nik: emp.nik,
  name: emp.name,
  companyId: emp.companyId,
  companyName: cmp.name,
  positionId: emp.positionId,
  positionName: pos.name,
  departmentId: emp.departmentId,
  departmentName: dpt.name,
  messId: emp.messId,
  messName: mss.name,
  simperTypeId: emp.simperTypeId,
  simperTypeName: spt.name,
  joinDate: emp.joinDate,
  license: emp.license,
  simperNo: emp.simperNo,
  simperExp: emp.simperExp,
  mcu: emp.mcu,
  mcuExp: emp.mcuExp,
  blood: emp.blood,
  medical: emp.medical,
  block: emp.block,
  room: emp.room,
  phone: emp.phone,
  emergency: emp.emergency,
  photoFileName: emp.photoFileName,
  status: emp.status,
  createdAt: emp.createdAt,
};

/**
 * `leftJoin` for the two nullable references — mess and permit type.
 *
 * An inner join on either would not merely lose a name: it would drop the whole
 * person from every list, so an employee who lives off site or operates nothing
 * would silently cease to exist. The other three are `notNull` foreign keys, so
 * an inner join can never drop a row — and if it did, that would be a broken
 * database rather than a query to make lenient.
 */
function employeeQuery() {
  return db
    .select(employeeColumns)
    .from(emp)
    .innerJoin(cmp, eq(cmp.id, emp.companyId))
    .innerJoin(pos, eq(pos.id, emp.positionId))
    .innerJoin(dpt, eq(dpt.id, emp.departmentId))
    .leftJoin(mss, eq(mss.id, emp.messId))
    .leftJoin(spt, eq(spt.id, emp.simperTypeId));
}

type EmployeeJoinRow = Awaited<ReturnType<typeof employeeQuery>>[number];

export type Skill = { id: string; name: string };

/**
 * The qualification codes held by a set of employees, in one query.
 *
 * One query for the whole page rather than one per row: a list of two hundred
 * people would otherwise be two hundred and one round trips, and the join table
 * is small enough that fetching it by id set costs nothing.
 */
async function skillsOf(ids: string[]): Promise<Map<string, Skill[]>> {
  const byEmployee = new Map<string, Skill[]>();
  if (!ids.length) return byEmployee;
  const rows = await db
    .select({
      employeeId: schema.employeeSkills.employeeId,
      id: spc.id,
      name: spc.name,
    })
    .from(schema.employeeSkills)
    .innerJoin(spc, eq(spc.id, schema.employeeSkills.simperCodeId))
    .where(inArray(schema.employeeSkills.employeeId, ids))
    .orderBy(asc(spc.name));
  for (const row of rows) {
    const list = byEmployee.get(row.employeeId);
    if (list) list.push({ id: row.id, name: row.name });
    else byEmployee.set(row.employeeId, [{ id: row.id, name: row.name }]);
  }
  return byEmployee;
}

function toEmployee(row: EmployeeJoinRow, skills: Skill[]) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    skills,
  };
}

/** A page of rows plus their skills, which is what every read returns. */
async function withSkills(rows: EmployeeJoinRow[]) {
  const skills = await skillsOf(rows.map((r) => r.id));
  return rows.map((r) => toEmployee(r, skills.get(r.id) ?? []));
}

/* ------------------------------------------------------- reference resolving */

type Reference = {
  field: string;
  label: string;
  id: string | null | undefined;
  table: NamedCatalogue;
};

/**
 * Confirm every supplied catalogue key exists, and say which one did not.
 *
 * `undefined` means the caller did not mention the field (a PATCH leaving it
 * alone); `null` means it explicitly cleared one of the two optional references
 * — the mess or the permit type — which is allowed.
 */
async function unresolvedReference(
  references: Reference[]
): Promise<{ field: string; message: string } | null> {
  const named = references.filter((r) => typeof r.id === "string");
  const found = await Promise.all(
    named.map(async (r) => {
      const [row] = await db
        .select({ id: r.table.id })
        .from(r.table)
        .where(eq(r.table.id, r.id as string))
        .limit(1);
      return { reference: r, exists: Boolean(row) };
    })
  );
  const missing = found.find((f) => !f.exists);
  if (!missing) return null;
  return {
    field: missing.reference.field,
    message: `${missing.reference.label} yang dipilih tidak ada di master`,
  };
}

/**
 * The one department a caller may write into, or `null` where they may write
 * into any.
 *
 * The mirror of `scopeWhere` for the write side. Reads were scoped from the
 * start; writes were not, which left a `dept` caller able to create a person
 * into another department and to edit, delete, or re-photograph anyone whose
 * NIK they knew — and `PATCH` returning the updated record made it a way to
 * *read* past the scope as well, since a write where a read was refused
 * answered with the row.
 *
 * A refusal here is a 404 rather than a 403, matching `GET /:nik`: an existence
 * answer that differs for records outside the caller's department is a register
 * they can enumerate one NIK at a time.
 */
type WriteScope =
  | { kind: "all" }
  | { kind: "department"; id: string; name: string }
  | { kind: "none"; message: string };

async function writeScope(principal: SessionPrincipal): Promise<WriteScope> {
  if (principal.kind !== "user")
    return { kind: "none", message: "Akses ditolak" };
  if (principal.scope === "all") return { kind: "all" };

  if (!principal.nik)
    return {
      kind: "none",
      message: "Akun ini tidak punya NIK, departemennya tidak bisa ditentukan",
    };
  const departmentId = await departmentIdOfNik(principal.nik);
  if (!departmentId)
    return {
      kind: "none",
      message: "NIK akun ini tidak ada di data karyawan",
    };
  const [row] = await db
    .select({ name: dpt.name })
    .from(dpt)
    .where(eq(dpt.id, departmentId))
    .limit(1);
  return { kind: "department", id: departmentId, name: row?.name ?? "" };
}

/**
 * That the three keys describe one place in the organisation, not three.
 *
 * A department belongs to a company and a position to a department, so
 * `company: RBS, department: HRM (UDU), position: PAYROLL OFFICER (UDU/HRM)` is
 * three rows that each exist and one person who works nowhere. The foreign keys
 * cannot catch it — each one resolves — so the pairing is checked here.
 *
 * Stated as a validation issue on the field that is wrong rather than as a 409,
 * because it is a form the operator can correct: the position is the one that
 * disagrees with the department, and the department the one that disagrees with
 * the company.
 *
 * On a PATCH the values not mentioned come from the record as it stands, so
 * moving someone's department alone is checked against the position they still
 * hold — which is the case that would otherwise leave a mismatched pair behind.
 */
async function mismatchedOrganisation(pair: {
  companyId: string;
  departmentId: string;
  positionId: string;
}): Promise<{ field: string; message: string } | null> {
  const [department] = await db
    .select({ companyId: dpt.companyId, name: dpt.name })
    .from(dpt)
    .where(eq(dpt.id, pair.departmentId))
    .limit(1);
  if (department && department.companyId !== pair.companyId)
    return {
      field: "departmentId",
      message: `Departemen "${department.name}" bukan milik perusahaan yang dipilih`,
    };

  const [position] = await db
    .select({ departmentId: pos.departmentId, name: pos.name })
    .from(pos)
    .where(eq(pos.id, pair.positionId))
    .limit(1);
  if (position && position.departmentId !== pair.departmentId)
    return {
      field: "positionId",
      message: `Jabatan "${position.name}" bukan milik departemen yang dipilih`,
    };

  return null;
}

function referencesOf(body: {
  companyId?: string;
  positionId?: string;
  departmentId?: string;
  messId?: string | null;
  simperTypeId?: string | null;
}): Reference[] {
  return [
    { field: "companyId", label: "Perusahaan", id: body.companyId, table: cmp },
    { field: "positionId", label: "Jabatan", id: body.positionId, table: pos },
    {
      field: "departmentId",
      label: "Departemen",
      id: body.departmentId,
      table: dpt,
    },
    { field: "messId", label: "Mess", id: body.messId, table: mss },
    {
      field: "simperTypeId",
      // A *qualification code* id lands here as "not in the master": this column
      // references `simper_types`, so the two catalogues cannot be confused
      // (design D4) — the wrong one simply does not resolve.
      label: "Tipe SIMPER",
      id: body.simperTypeId,
      table: spt,
    },
  ];
}

/* ------------------------------------------------------------------- skills */

/**
 * Which of these qualification-code ids do not exist.
 *
 * Answered as a set rather than one at a time so a caller correcting a form
 * sees every bad code at once instead of discovering them one save apart.
 */
async function unknownSkillIds(ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const rows = await db
    .select({ id: spc.id })
    .from(spc)
    .where(inArray(spc.id, ids));
  const known = new Set(rows.map((r) => r.id));
  return ids.filter((id) => !known.has(id));
}

/**
 * Replace an employee's whole set of codes.
 *
 * Delete-then-insert rather than a diff: the submitted set *is* the answer
 * (spec: "the stored set SHALL match the submitted set exactly"), and computing
 * the difference would be more code for the same result. Inside the caller's
 * transaction, so a failure halfway cannot leave a person holding half their
 * qualifications — which would be a spare who matches the wrong units without
 * anything looking wrong.
 */
async function replaceSkills(
  tx: Transaction,
  employeeId: string,
  skillIds: string[]
): Promise<void> {
  await tx
    .delete(schema.employeeSkills)
    .where(eq(schema.employeeSkills.employeeId, employeeId));
  // Deduped: the same code twice in one submission is one assignment, and the
  // composite primary key would refuse the second row anyway.
  const distinct = [...new Set(skillIds)];
  if (!distinct.length) return;
  await tx
    .insert(schema.employeeSkills)
    .values(distinct.map((simperCodeId) => ({ employeeId, simperCodeId })));
}

/* --------------------------------------------------------- import / export */

/** The join row plus its skills, in the shape the import compares and exports. */
async function toExistingRows(
  rows: EmployeeJoinRow[]
): Promise<EmployeeExisting[]> {
  const skills = await skillsOf(rows.map((r) => r.id));
  return rows.map((r) => ({
    id: r.id,
    nik: r.nik,
    name: r.name,
    companyName: r.companyName,
    positionName: r.positionName,
    departmentName: r.departmentName,
    messName: r.messName,
    simperTypeName: r.simperTypeName,
    joinDate: r.joinDate,
    status: r.status,
    simperNo: r.simperNo,
    simperExp: r.simperExp,
    skills: (skills.get(r.id) ?? []).map((s) => s.name),
    license: r.license,
    mcu: r.mcu,
    mcuExp: r.mcuExp,
    blood: r.blood,
    medical: r.medical,
    block: r.block,
    room: r.room,
    phone: r.phone,
    emergency: r.emergency,
  }));
}

/** name (lowercased) → row, matching how the `lower(name)` index compares. */
async function catalogueLookup(
  table: NamedCatalogue
): Promise<Map<string, { id: string; name: string }>> {
  const rows = (await db
    .select({ id: table.id, name: table.name })
    .from(table)) as { id: string; name: string }[];
  return new Map(rows.map((r) => [r.name.toLowerCase(), r]));
}

/**
 * `company|department` → row, the key a department is actually identified by.
 *
 * A bare name would collapse the two `MINING OPERATION`s into one entry and
 * hand back whichever the query returned last.
 */
async function departmentLookup(): Promise<
  Map<string, { id: string; name: string }>
> {
  const rows = await db
    .select({ id: dpt.id, name: dpt.name, company: cmp.name })
    .from(dpt)
    .innerJoin(cmp, eq(cmp.id, dpt.companyId));
  return new Map(
    rows.map((r) => [
      `${r.company}|${r.name}`.toLowerCase(),
      { id: r.id, name: r.name },
    ])
  );
}

/** `company|department|position` — same reasoning, one level deeper. */
async function positionLookup(): Promise<
  Map<string, { id: string; name: string }>
> {
  const rows = await db
    .select({
      id: pos.id,
      name: pos.name,
      department: dpt.name,
      company: cmp.name,
    })
    .from(pos)
    .innerJoin(dpt, eq(dpt.id, pos.departmentId))
    .innerJoin(cmp, eq(cmp.id, dpt.companyId));
  return new Map(
    rows.map((r) => [
      `${r.company}|${r.department}|${r.name}`.toLowerCase(),
      { id: r.id, name: r.name },
    ])
  );
}

/**
 * Which catalogue an employee import may add to.
 *
 * Three, not six. `kode-simper` was always absent, and its absence is enforced
 * here as well as in the parser (design D11). `departemen` and `jabatan` joined
 * it once each acquired an owner: creating one would mean filing it under a
 * parent this import inferred, and a department invented under the wrong
 * company is a row that looks right everywhere except where it matters.
 */
type EmployeeRefKind = "perusahaan" | "mess" | "simper";

const CREATABLE: Record<EmployeeRefKind, NamedCatalogue> = {
  perusahaan: cmp,
  mess: mss,
  simper: spt,
};

/** Catalogue plus name, lowercased — the same pairing the preview deduped on. */
const refKey = (kind: string, name: string) => `${kind} ${name.toLowerCase()}`;

async function previewEmployees(
  file: File,
  permissions: EffectivePermissions,
  scope: WriteScope
) {
  const workbook = await readWorkbook(await file.arrayBuffer());
  if ("code" in workbook) return workbook;

  const [companies, positions, departments, messes, simperTypes, simperCodes] =
    await Promise.all([
      catalogueLookup(cmp),
      positionLookup(),
      departmentLookup(),
      catalogueLookup(mss),
      catalogueLookup(spt),
      catalogueLookup(spc),
    ]);

  // Deliberately unscoped, and it stays that way: an import is keyed on NIK,
  // and a `dept` caller who could not *see* an existing row would create a
  // duplicate NIK instead of being told the row is not theirs — which the
  // unique index would then refuse halfway through the commit. What the scope
  // narrows is what may be written, one row at a time, in `employeeTarget`.
  const existing = new Map(
    (await toExistingRows(await employeeQuery())).map((r) => [
      r.nik.toLowerCase(),
      r,
    ])
  );

  return validateWorkbook(
    file.name,
    employeeTarget(
      existing,
      { companies, positions, departments, messes, simperTypes, simperCodes },
      // `manage` on employees is what gets you here; it is not what lets you
      // write into a master. Each catalogue is asked for separately, and a kind
      // the caller cannot manage falls back to a refused row.
      (kind) => holds(permissions, kind, "manage"),
      scope.kind === "department"
        ? { id: scope.id, name: scope.name }
        : undefined
    ),
    workbook
  );
}

/**
 * Create the catalogue records the file referenced, and map each back to its id.
 *
 * `onConflictDoNothing` then re-read, rather than a bare insert: the catalogues
 * were read before the operator confirmed, and a name added in that gap should
 * resolve to the record that now exists instead of failing the whole import on
 * a unique violation.
 */
async function createPendingMasters(
  tx: Transaction,
  pending: PendingMaster[]
): Promise<Map<string, string>> {
  const byKey = new Map<string, string>();
  for (const item of pending) {
    const table = CREATABLE[item.kind as EmployeeRefKind];
    // Belt and braces against D11: the parser never emits a `kode-simper`
    // pending entry, and if one ever reached here it would be skipped rather
    // than created.
    if (!table) continue;
    const [created] = (await tx
      .insert(table)
      .values({ name: item.name })
      .onConflictDoNothing()
      .returning({ id: table.id })) as { id: string }[];
    let id = created?.id;
    if (!id) {
      const [found] = (await tx
        .select({ id: table.id })
        .from(table)
        .where(sql`lower(${table.name}) = ${item.name.toLowerCase()}`)) as {
        id: string;
      }[];
      id = found?.id;
    }
    if (id) byKey.set(refKey(item.kind, item.name), id);
  }
  return byKey;
}

/* -------------------------------------------------------------------- misc */

const employeeNotFound = {
  code: "employee_not_found",
  message: "Karyawan tidak ditemukan",
};

const validationError = (issue: { field: string; message: string }) => ({
  code: "validation_failed",
  message: issue.message,
  issues: [issue],
});

const unknownSkillsError = (ids: string[]) => ({
  code: "validation_failed",
  message: `${ids.length} kode SIMPER tidak ada di master`,
  issues: ids.map((id) => ({
    field: "skillIds",
    message: `Kode SIMPER ${id} tidak ada di master`,
  })),
});

/** The writable columns, in the shape a create supplies them. */
const employeeBody = {
  companyId: t.String({ format: "uuid" }),
  positionId: t.String({ format: "uuid" }),
  departmentId: t.String({ format: "uuid" }),
  /** Null is a state, not an omission: an employee may live off site. */
  messId: t.Optional(t.Nullable(t.String({ format: "uuid" }))),
  /** Likewise: someone who operates no unit holds no permit. */
  simperTypeId: t.Optional(t.Nullable(t.String({ format: "uuid" }))),
  joinDate: t.Optional(t.Nullable(t.String())),
  license: t.Optional(t.String()),
  simperNo: t.Optional(t.String()),
  simperExp: t.Optional(t.Nullable(t.String())),
  mcu: OptionalMcuResultSchema,
  mcuExp: t.Optional(t.Nullable(t.String())),
  blood: OptionalBloodTypeSchema,
  medical: t.Optional(t.String()),
  block: t.Optional(t.String()),
  room: t.Optional(t.String()),
  phone: t.Optional(t.String()),
  emergency: t.Optional(t.String()),
  status: OptionalEmployeeStatusSchema,
  /**
   * Qualification code *ids*, never names (design D4). A name on the wire would
   * put the text comparison this table exists to abolish back into the client.
   */
  skillIds: t.Optional(t.Array(t.String({ format: "uuid" }))),
};

/** A blank date cell is `null`, not the empty string Postgres would refuse. */
const dateOrNull = (value: string | null | undefined) =>
  value === undefined || value === null || value.trim() === ""
    ? null
    : value.trim();

export const employeesRoutes = new Elysia({
  prefix: "/employees",
  tags: ["employees"],
})
  .use(requireAuth)

  .get(
    "/",
    async ({ query, principal }) => {
      const needle = query.q?.trim();
      const filters = [
        // Scope is a where clause, not a filter over rows already fetched
        // (design D9). A `dept` caller resolves through its own employee
        // record; one whose NIK matches nobody still sees nothing.
        await scopeWhere(principal, { dept: emp.departmentId, self: emp.nik }),
        query.departmentId === undefined || query.departmentId === ""
          ? undefined
          : eq(emp.departmentId, query.departmentId),
        query.status === undefined ? undefined : eq(emp.status, query.status),
        // Reaches the joined catalogue names as well as the person's own
        // columns, because that is what the operator sees in the table they are
        // searching — and none of it is indexed client-side (design D12).
        needle
          ? or(
              ilike(emp.nik, `%${needle}%`),
              ilike(emp.name, `%${needle}%`),
              ilike(cmp.name, `%${needle}%`),
              ilike(pos.name, `%${needle}%`),
              ilike(dpt.name, `%${needle}%`)
            )
          : undefined,
      ].filter((f) => f !== undefined);

      const rows = await employeeQuery()
        .where(and(...filters))
        .orderBy(asc(emp.name));
      return withSkills(rows);
    },
    {
      auth: { menu: "employees", mode: "view" },
      query: t.Object({
        q: t.Optional(t.String()),
        departmentId: t.Optional(t.String()),
        status: OptionalEmployeeStatusSchema,
      }),
      response: {
        200: t.Array(EmployeeSchema),
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: { summary: "List employees with their resolved catalogue names" },
    }
  )

  /* ----------------------------------------------------------- export
     Declared before /:nik so "export" is never parsed as a NIK. */

  .get(
    "/export",
    async ({ principal, set }) => {
      const rows = await employeeQuery()
        .where(
          await scopeWhere(principal, { dept: emp.departmentId, self: emp.nik })
        )
        .orderBy(asc(emp.nik));
      set.headers["content-type"] =
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      set.headers["content-disposition"] =
        'attachment; filename="karyawan.xlsx"';
      return new Response(
        new Uint8Array(await employeeWorkbook(await toExistingRows(rows)))
      );
    },
    {
      auth: { menu: "employees", mode: "view" },
      // Described by hand: the body is a binary workbook, and a TypeBox
      // `response` schema would try to validate it as an object.
      detail: {
        summary: "Export employees as a spreadsheet",
        responses: {
          200: {
            description:
              "An .xlsx whose columns are exactly what the employee import accepts",
            content: {
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
                { schema: { type: "string", format: "binary" } },
            },
          },
          401: { description: "No session" },
          403: { description: "Lacks view on employees" },
        },
      },
    }
  )

  /** The blank template, distinct from the export above. */
  .get(
    "/import/template",
    async ({ set }) => {
      set.headers["content-type"] =
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      set.headers["content-disposition"] =
        'attachment; filename="template_karyawan.xlsx"';
      return new Response(new Uint8Array(await employeeTemplate()));
    },
    {
      auth: { menu: "employees", mode: "manage" },
      detail: {
        summary: "Download the employee import template (.xlsx)",
        responses: {
          200: {
            description:
              "An .xlsx with the employee import columns and one example row",
            content: {
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
                { schema: { type: "string", format: "binary" } },
            },
          },
          401: { description: "No session" },
          403: { description: "Lacks manage on employees" },
        },
      },
    }
  )

  .post(
    "/import/preview",
    async ({ body, permissions, principal, status }) => {
      const scope = await writeScope(principal);
      if (scope.kind === "none")
        return status(403, { code: "forbidden", message: scope.message });
      const result = await previewEmployees(body.file, permissions, scope);
      if ("code" in result) return status(422, result);
      return result.preview;
    },
    {
      auth: { menu: "employees", mode: "manage" },
      body: t.Object({ file: t.File({ maxSize: MAX_IMPORT_BYTES }) }),
      response: {
        200: MasterImportPreviewSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "Preview an employee import — writes nothing" },
    }
  )

  .post(
    "/import",
    async ({ body, permissions, principal, status }) => {
      const scope = await writeScope(principal);
      if (scope.kind === "none")
        return status(403, { code: "forbidden", message: scope.message });
      // Re-parsed rather than trusting the preview the client saw. That is also
      // what re-checks the permissions *and the scope* behind every row: the
      // confirmation dialog is advisory, this parse decides.
      const result = await previewEmployees(body.file, permissions, scope);
      if ("code" in result) return status(422, result);
      if (result.preview.errorCount > 0)
        return status(422, {
          code: "validation_failed",
          message: `${result.preview.errorCount} baris masih bermasalah`,
        });

      let created = 0;
      let updated = 0;
      let mastersCreated = 0;

      // One transaction for the whole file, catalogue additions included: a run
      // that fails halfway must not leave a master seeded with positions no
      // employee ended up holding.
      await db.transaction(async (tx) => {
        const resolved = await createPendingMasters(
          tx,
          result.preview.newMasters
        );
        mastersCreated = resolved.size;

        /** The id, or the one just created for this name. */
        const idFor = (
          kind: EmployeeRefKind,
          id: string | null,
          name: string
        ): string => id ?? resolved.get(refKey(kind, name))!;

        for (const row of result.accepted) {
          const p = row.parsed;
          const values = {
            nik: p.nik,
            name: p.name,
            companyId: idFor("perusahaan", p.companyId, p.companyName),
            // Never pending: neither is creatable from an import, so the parser
            // has already refused every row whose pair did not resolve, and the
            // id is present by the time a row reaches this loop.
            positionId: p.positionId!,
            departmentId: p.departmentId!,
            // A null *name* on either optional reference means the column was
            // blank — lives off site, holds no permit — as opposed to a pending
            // one, whose name is what resolves it.
            messId: p.messName ? idFor("mess", p.messId, p.messName) : null,
            simperTypeId: p.simperTypeName
              ? idFor("simper", p.simperTypeId, p.simperTypeName)
              : null,
            joinDate: p.joinDate,
            status: p.status,
            simperNo: p.simperNo,
            simperExp: p.simperExp,
            license: p.license,
            mcu: p.mcu,
            mcuExp: p.mcuExp,
            blood: p.blood,
            medical: p.medical,
            block: p.block,
            room: p.room,
            phone: p.phone,
            emergency: p.emergency,
          };
          if (row.current) {
            // An unchanged row is skipped rather than rewritten, which is what
            // makes re-importing an untouched export report zero changed.
            if (!row.changed) continue;
            await tx.update(emp).set(values).where(eq(emp.id, row.current.id));
            await replaceSkills(tx, row.current.id, p.skillIds);
            updated++;
          } else {
            const [inserted] = await tx
              .insert(emp)
              .values(values)
              .returning({ id: emp.id });
            await replaceSkills(tx, inserted!.id, p.skillIds);
            created++;
          }
        }
      });

      return { created, updated, mastersCreated };
    },
    {
      auth: { menu: "employees", mode: "manage" },
      body: t.Object({ file: t.File({ maxSize: MAX_IMPORT_BYTES }) }),
      response: {
        200: MasterImportResultSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "Apply a previewed employee import" },
    }
  )

  .get(
    "/:nik",
    async ({ params, principal, status }) => {
      const [row] = await employeeQuery()
        .where(
          and(
            eq(emp.nik, params.nik),
            // The same predicate as the list. Without it a `dept` caller could
            // read any record by guessing a NIK, which is the one thing a
            // scoped list is supposed to prevent.
            await scopeWhere(principal, {
              dept: emp.departmentId,
              self: emp.nik,
            })
          )
        )
        .limit(1);
      if (!row) return status(404, employeeNotFound);
      const [employee] = await withSkills([row]);
      return employee!;
    },
    {
      auth: { menu: "employees", mode: "view" },
      params: t.Object({ nik: t.String({ minLength: 1 }) }),
      response: {
        200: EmployeeSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
      },
      detail: { summary: "One employee by NIK" },
    }
  )

  .post(
    "/",
    async ({ body, principal, status }) => {
      const scope = await writeScope(principal);
      if (scope.kind === "none")
        return status(403, { code: "forbidden", message: scope.message });

      /**
       * A scoped caller does not state where the new person goes.
       *
       * The department is taken from their own record and the company from
       * that department, exactly as a roster upload resolves its department
       * (roster D6): the value in the body is not corrected, it is never read.
       * Deriving the company as well removes the only way the pair could still
       * disagree, and there is nothing to choose — a department belongs to one
       * company.
       */
      let placement = {
        companyId: body.companyId,
        departmentId: body.departmentId,
      };
      if (scope.kind === "department") {
        const [owner] = await db
          .select({ companyId: dpt.companyId })
          .from(dpt)
          .where(eq(dpt.id, scope.id))
          .limit(1);
        placement = {
          companyId: owner!.companyId,
          departmentId: scope.id,
        };
      }

      const issue = await unresolvedReference(
        referencesOf({ ...body, ...placement })
      );
      if (issue) return status(422, validationError(issue));

      const mismatch = await mismatchedOrganisation({
        companyId: placement.companyId,
        departmentId: placement.departmentId,
        positionId: body.positionId,
      });
      if (mismatch) return status(422, validationError(mismatch));

      const skillIds = [...new Set(body.skillIds ?? [])];
      const unknown = await unknownSkillIds(skillIds);
      if (unknown.length) return status(422, unknownSkillsError(unknown));

      const nik = body.nik.trim();
      if (!nik)
        return status(
          422,
          validationError({ field: "nik", message: "NIK tidak boleh kosong" })
        );

      try {
        const id = await db.transaction(async (tx) => {
          const [created] = await tx
            .insert(emp)
            .values({
              nik,
              name: body.name.trim(),
              companyId: placement.companyId,
              positionId: body.positionId,
              departmentId: placement.departmentId,
              messId: body.messId ?? null,
              simperTypeId: body.simperTypeId ?? null,
              joinDate: dateOrNull(body.joinDate),
              license: body.license?.trim() ?? "",
              simperNo: body.simperNo?.trim() ?? "",
              simperExp: dateOrNull(body.simperExp),
              mcu: body.mcu ?? null,
              mcuExp: dateOrNull(body.mcuExp),
              blood: body.blood ?? null,
              medical: body.medical?.trim() ?? "",
              block: body.block?.trim() ?? "",
              room: body.room?.trim() ?? "",
              phone: body.phone?.trim() ?? "",
              emergency: body.emergency?.trim() ?? "",
              status: body.status ?? "aktif",
            })
            .returning({ id: emp.id });
          await replaceSkills(tx, created!.id, skillIds);
          return created!.id;
        });

        const [row] = await employeeQuery().where(eq(emp.id, id)).limit(1);
        const [employee] = await withSkills([row!]);
        return status(201, employee!);
      } catch (error) {
        if (isUniqueViolation(error))
          return status(409, {
            code: "employee_exists",
            message: `NIK ${nik} sudah terdaftar`,
          });
        throw error;
      }
    },
    {
      auth: { menu: "employees", mode: "manage" },
      body: t.Object({
        nik: t.String({ minLength: 1 }),
        name: t.String({ minLength: 1 }),
        ...employeeBody,
      }),
      response: {
        201: EmployeeSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        409: ErrorSchema,
        422: ValidationIssuesSchema,
      },
      detail: { summary: "Create an employee" },
    }
  )

  .patch(
    "/:nik",
    async ({ params, body, principal, status }) => {
      const scope = await writeScope(principal);
      if (scope.kind === "none")
        return status(403, { code: "forbidden", message: scope.message });

      // Resolved through the scope, so an edit cannot reach a record a read
      // could not. This is also what closes the disclosure: a 404 here answers
      // the same as `GET /:nik` would, rather than handing back the row.
      const [current] = await db
        .select({
          companyId: emp.companyId,
          departmentId: emp.departmentId,
          positionId: emp.positionId,
        })
        .from(emp)
        .where(
          and(
            eq(emp.nik, params.nik),
            await scopeWhere(principal, {
              dept: emp.departmentId,
              self: emp.nik,
            })
          )
        )
        .limit(1);
      if (!current) return status(404, employeeNotFound);

      // A scoped caller does not move anyone in or out — the department and its
      // company are read from the record as it stands, whatever the body says.
      // Handing away one of your own people, or claiming one of somebody
      // else's, is a transfer, and a transfer is not a field edit.
      const placement =
        scope.kind === "department"
          ? { companyId: current.companyId, departmentId: current.departmentId }
          : {
              companyId: body.companyId ?? current.companyId,
              departmentId: body.departmentId ?? current.departmentId,
            };

      const issue = await unresolvedReference(
        referencesOf({ ...body, ...placement })
      );
      if (issue) return status(422, validationError(issue));

      // The three keys are checked as a set even when only one of them was
      // sent, against the record as it stands — an edit that moves someone's
      // department while leaving their position behind is exactly the pairing
      // this exists to refuse.
      const mismatch = await mismatchedOrganisation({
        ...placement,
        positionId: body.positionId ?? current.positionId,
      });
      if (mismatch) return status(422, validationError(mismatch));

      const skillIds =
        body.skillIds === undefined ? null : [...new Set(body.skillIds)];
      if (skillIds) {
        const unknown = await unknownSkillIds(skillIds);
        if (unknown.length) return status(422, unknownSkillsError(unknown));
      }

      /**
       * A renamed NIK has to be carried to the account holding it.
       *
       * `users.nik` is deliberately not a foreign key (auth D5), so nothing
       * else will do it and nothing will complain: the account keeps working
       * in every way that would make the breakage visible — it still logs in,
       * its menus still render — while `departmentIdOfNik` resolves to null
       * and every scoped screen silently empties. Deleting an employee whose
       * NIK an account holds is already refused; renaming was the same hole
       * left open.
       */
      const renamedTo =
        body.nik !== undefined && body.nik.trim() !== params.nik
          ? body.nik.trim()
          : null;
      if (renamedTo) {
        const [taken] = await db
          .select({ id: schema.users.id, name: schema.users.name })
          .from(schema.users)
          .where(eq(schema.users.nik, renamedTo))
          .limit(1);
        if (taken)
          return status(409, {
            code: "nik_taken",
            message: `NIK ${renamedTo} sudah dipakai akun "${taken.name}"`,
          });
      }

      try {
        const { id, movedAccounts } = await db.transaction(async (tx) => {
          const [updated] = await tx
            .update(emp)
            .set({
              ...(body.nik !== undefined ? { nik: body.nik.trim() } : {}),
              ...(body.name !== undefined ? { name: body.name.trim() } : {}),
              companyId: placement.companyId,
              departmentId: placement.departmentId,
              ...(body.positionId !== undefined
                ? { positionId: body.positionId }
                : {}),
              // `null` clears it — lives off site, holds no permit; absent
              // leaves it alone.
              ...(body.messId !== undefined ? { messId: body.messId } : {}),
              ...(body.simperTypeId !== undefined
                ? { simperTypeId: body.simperTypeId }
                : {}),
              ...(body.joinDate !== undefined
                ? { joinDate: dateOrNull(body.joinDate) }
                : {}),
              ...(body.license !== undefined
                ? { license: body.license.trim() }
                : {}),
              ...(body.simperNo !== undefined
                ? { simperNo: body.simperNo.trim() }
                : {}),
              ...(body.simperExp !== undefined
                ? { simperExp: dateOrNull(body.simperExp) }
                : {}),
              ...(body.mcu !== undefined ? { mcu: body.mcu } : {}),
              ...(body.mcuExp !== undefined
                ? { mcuExp: dateOrNull(body.mcuExp) }
                : {}),
              ...(body.blood !== undefined ? { blood: body.blood } : {}),
              ...(body.medical !== undefined
                ? { medical: body.medical.trim() }
                : {}),
              ...(body.block !== undefined ? { block: body.block.trim() } : {}),
              ...(body.room !== undefined ? { room: body.room.trim() } : {}),
              ...(body.phone !== undefined ? { phone: body.phone.trim() } : {}),
              ...(body.emergency !== undefined
                ? { emergency: body.emergency.trim() }
                : {}),
              ...(body.status !== undefined ? { status: body.status } : {}),
            })
            .where(eq(emp.nik, params.nik))
            .returning({ id: emp.id });
          if (!updated) return { id: null, movedAccounts: [] as string[] };
          // Absent leaves the set alone; an empty array clears it. A person who
          // lost every qualification is a real edit, and it has to be
          // expressible.
          if (skillIds) await replaceSkills(tx, updated.id, skillIds);

          // In the same transaction as the rename, so the two records cannot
          // disagree even for an instant. The check above is what turns a
          // collision into a 409; `users_nik_unique` catches the race it
          // cannot see, and lands in the same handler below.
          const moved = renamedTo
            ? await tx
                .update(schema.users)
                .set({ nik: renamedTo })
                .where(eq(schema.users.nik, params.nik))
                .returning({ id: schema.users.id })
            : [];

          return { id: updated.id, movedAccounts: moved.map((m) => m.id) };
        });
        if (!id) return status(404, employeeNotFound);

        // The cached principal carries the NIK every scope resolves through,
        // so an account whose NIK just moved has to be re-read on its next
        // request rather than at cache expiry.
        await Promise.all(
          movedAccounts.map((userId) => invalidateUser(userId))
        );

        const [row] = await employeeQuery().where(eq(emp.id, id)).limit(1);
        const [employee] = await withSkills([row!]);
        return employee!;
      } catch (error) {
        if (isUniqueViolation(error, "users_nik_unique"))
          return status(409, {
            code: "nik_taken",
            message: `NIK ${body.nik ?? params.nik} sudah dipakai akun lain`,
          });
        if (isUniqueViolation(error))
          return status(409, {
            code: "employee_exists",
            message: `NIK ${body.nik ?? params.nik} sudah terdaftar`,
          });
        throw error;
      }
    },
    {
      auth: { menu: "employees", mode: "manage" },
      params: t.Object({ nik: t.String({ minLength: 1 }) }),
      body: t.Object({
        nik: t.Optional(t.String({ minLength: 1 })),
        name: t.Optional(t.String({ minLength: 1 })),
        ...employeeBody,
        companyId: t.Optional(t.String({ format: "uuid" })),
        positionId: t.Optional(t.String({ format: "uuid" })),
        departmentId: t.Optional(t.String({ format: "uuid" })),
      }),
      response: {
        200: EmployeeSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
        409: ErrorSchema,
        422: ValidationIssuesSchema,
      },
      detail: { summary: "Edit an employee" },
    }
  )

  /**
   * Delete, refused where the person has left a trace (design D10).
   *
   * The checks are explicit rather than a caught foreign-key violation, for the
   * reason `units.ts` gives — a constraint says only that *something* did not
   * resolve — and for one more that is specific here: `users.nik` is
   * deliberately **not** a foreign key (auth D5), so without this check an
   * account would be orphaned with no constraint complaining at all.
   *
   * The normal route for someone who leaves is `status: "nonaktif"`. Deleting is
   * for a row typed in wrong — usually from an import — that nothing has used.
   */
  .delete(
    "/:nik",
    async ({ params, principal, status }) => {
      const [row] = await db
        .select({ id: emp.id, photoFileName: emp.photoFileName })
        .from(emp)
        .where(
          and(
            eq(emp.nik, params.nik),
            // Scoped like the read: a NIK outside the caller's department is
            // "not found", not "refused", so the register cannot be probed one
            // NIK at a time.
            await scopeWhere(principal, {
              dept: emp.departmentId,
              self: emp.nik,
            })
          )
        )
        .limit(1);
      if (!row) return status(404, employeeNotFound);

      const [account] = await db
        .select({ id: schema.users.id, name: schema.users.name })
        .from(schema.users)
        .where(eq(schema.users.nik, params.nik))
        .limit(1);
      if (account)
        return status(409, {
          code: "employee_in_use",
          message: `Masih dipakai akun "${account.name}" dengan NIK yang sama — hapus akunnya dulu, atau nonaktifkan karyawannya`,
        });

      // Roster days and revision entries are traces too (roster D14), and
      // unlike the account they *are* backed by `restrict` foreign keys. The
      // count is read anyway, for the same reason `units.ts` reads one: a
      // constraint says only that something did not resolve, and "masih
      // direferensi data lain" is not a sentence anyone can act on. Named
      // separately because the two are fixed in different places, and archived
      // documents count — history has to stay readable.
      const [trace] = await db
        .select({
          rosterDays: sql<number>`(
            select count(*)::int from ${schema.rosterDays}
            where ${schema.rosterDays.employeeId} = ${row.id}
          )`,
          revisionItems: sql<number>`(
            select count(*)::int from ${schema.rosterRevisionItems}
            where ${schema.rosterRevisionItems.employeeId} = ${row.id}
          )`,
        })
        .from(emp)
        .where(eq(emp.id, row.id))
        .limit(1);

      if (trace && (trace.rosterDays > 0 || trace.revisionItems > 0)) {
        const reasons = [
          trace.rosterDays > 0
            ? `${trace.rosterDays} hari roster (termasuk dokumen arsip)`
            : null,
          trace.revisionItems > 0
            ? `${trace.revisionItems} entri revisi roster`
            : null,
        ].filter((r) => r !== null);
        return status(409, {
          code: "employee_in_use",
          message: `Masih punya ${reasons.join(" dan ")} — nonaktifkan saja bila sudah tidak aktif`,
        });
      }

      try {
        // `employee_skills` cascades with the employee (design D4) — the
        // assignment is part of the person's record, not a thing that outlives
        // them.
        await db.delete(emp).where(eq(emp.id, row.id));
      } catch (error) {
        if (!isForeignKeyViolation(error)) throw error;
        return status(409, {
          code: "employee_in_use",
          message:
            "Karyawan masih direferensi data lain — nonaktifkan saja bila sudah tidak aktif",
        });
      }

      // After the row is gone, never before: a failed delete must not have
      // removed the photo of an employee that is still there.
      if (row.photoFileName) await deletePhoto(row.photoFileName);
      return { ok: true };
    },
    {
      auth: { menu: "employees", mode: "manage" },
      params: t.Object({ nik: t.String({ minLength: 1 }) }),
      response: {
        200: t.Object({ ok: t.Boolean() }),
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
        409: ErrorSchema,
      },
      detail: { summary: "Delete an employee" },
    }
  )

  /**
   * Streamed rather than read: `Bun.file` is a lazy handle, so the bytes go
   * from the page cache to the socket without passing through this process's
   * heap (design D8).
   */
  .get(
    "/:nik/photo",
    async ({ params, principal, status }) => {
      const [row] = await db
        .select({ photoFileName: emp.photoFileName })
        .from(emp)
        .where(
          and(
            eq(emp.nik, params.nik),
            await scopeWhere(principal, {
              dept: emp.departmentId,
              self: emp.nik,
            })
          )
        )
        .limit(1);
      if (!row?.photoFileName) return status(404, employeeNotFound);

      const file = Bun.file(photoPath(row.photoFileName));
      // The row can outlive the file — a volume that was not mounted on the
      // last redeploy is exactly this case (design D8), and it is a 404 rather
      // than a 500.
      if (!(await file.exists())) return status(404, employeeNotFound);
      // Explicit, as the sound route does it: passing a BunFile alone leaves
      // the response typeless once Elysia has re-streamed it, and a browser
      // then has to sniff bytes to decide it is an image.
      return new Response(file, {
        headers: { "content-type": photoMimeType(row.photoFileName) },
      });
    },
    {
      auth: { menu: "employees", mode: "view" },
      params: t.Object({ nik: t.String({ minLength: 1 }) }),
      // No 200 schema: the body is an image, and declaring a JSON shape for it
      // would have Elysia try to validate bytes as an object.
      response: { 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      detail: { summary: "Serve an employee's photo" },
    }
  )

  .post(
    "/:nik/photo",
    async ({ params, body, principal, status }) => {
      const [row] = await db
        .select({ id: emp.id, photoFileName: emp.photoFileName })
        .from(emp)
        .where(
          and(
            eq(emp.nik, params.nik),
            // Scoped like every other write: the photo endpoint reached past
            // the department as freely as the edit did.
            await scopeWhere(principal, {
              dept: emp.departmentId,
              self: emp.nik,
            })
          )
        )
        .limit(1);
      if (!row) return status(404, employeeNotFound);

      const file = body.file;
      // Worth knowing: Bun derives `File.type` from the *filename extension*,
      // not from the part's Content-Type header, so a client cannot talk its
      // way past this by asserting a type.
      if (!file.type.startsWith("image/"))
        return status(422, {
          code: "unsupported_media_type",
          message: `Tipe berkas "${file.type || "tidak diketahui"}" bukan gambar`,
        });
      if (file.size > MAX_PHOTO_BYTES)
        return status(422, {
          code: "file_too_large",
          message: `Berkas melebihi ${MAX_PHOTO_BYTES / (1024 * 1024)} MB`,
        });

      // Generated, never the client's — see `storedPhotoName`. The client's
      // name contributes at most a vetted extension, so `../../etc/passwd.jpg`
      // writes a UUID inside PHOTO_DIR and nothing else. `null` means the name
      // and the type between them named no image this API stores.
      const fileName = storedPhotoName(file.name, file.type);
      if (!fileName)
        return status(422, {
          code: "unsupported_media_type",
          message: "Foto harus .jpg, .jpeg, .png, atau .webp",
        });

      await writePhoto(fileName, await file.arrayBuffer());
      await db
        .update(emp)
        .set({ photoFileName: fileName })
        .where(eq(emp.id, row.id));
      // The old file goes only once the row points at the new one, so a crash
      // in between leaves a photo that still resolves rather than a broken one.
      if (row.photoFileName) await deletePhoto(row.photoFileName);

      const [updated] = await employeeQuery()
        .where(eq(emp.id, row.id))
        .limit(1);
      const [employee] = await withSkills([updated!]);
      return employee!;
    },
    {
      auth: { menu: "employees", mode: "manage" },
      params: t.Object({ nik: t.String({ minLength: 1 }) }),
      body: t.Object({ file: t.File({ maxSize: MAX_PHOTO_BYTES }) }),
      response: {
        200: EmployeeSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "Upload an employee's photo" },
    }
  );

/* Re-exported so the import/export code resolves an employee the same way this
   file does rather than keeping a second copy of the join. */
export { employeeQuery, skillsOf, toEmployee, withSkills };
export type { EmployeeJoinRow };
