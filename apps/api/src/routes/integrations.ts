/**
 * The integration API — what another service on the site network reads.
 *
 * Today one read: the employee register with its SIMPER codes and photo, for
 * a service whose own use of it is its own business (owner, 2026-10-09). What
 * goes out is chosen field by field rather than passed through: a service
 * asked for name, NIK, organisation, skills, photo and join date, so the
 * mess, phone, emergency contact, medical notes, blood type and the SIMPER
 * card's number do not leave. Adding a field is a decision, made here.
 *
 * The shape is this route's own contract, not the table's. The register's
 * columns can move without a service noticing, and the service's sync can be
 * written once.
 *
 * Every route carries `integration: <scope>`, never `auth`: see
 * `integrations/auth.ts` for why the two boundaries stay apart.
 */

import { createHash } from "node:crypto";
import { and, asc, count, eq, ilike, inArray, or, type SQL } from "drizzle-orm";
import { Elysia, t } from "elysia";

import { db, schema } from "../db";
import { requireIntegration } from "../integrations/auth";
import { photoMimeType, photoPath } from "../storage";
import { ErrorSchema, OptionalEmployeeStatusSchema } from "./schemas";

const emp = schema.employees;
const cmp = schema.companies;
const dpt = schema.departments;
const pos = schema.positions;
const skill = schema.employeeSkills;
const code = schema.simperCodes;

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
/** Far past any register this site will hold, and short of an offset that
 *  overflows Postgres' bigint into a 500. */
const MAX_PAGE = 100_000;

const notFound = { code: "not_found", message: "Karyawan tidak ditemukan" };

/* Descriptions and examples are the published contract's words: they are
   what the OpenAPI document handed to other teams says about each field
   (`integrations/openapi.ts`). */
const PhotoSchema = t.Nullable(
  t.Object({
    url: t.String({
      description:
        "Alamat foto di server ini. Pakai token yang sama untuk mengambilnya.",
      examples: ["/v1/integrations/employees/12345678/photo"],
    }),
    version: t.String({
      description:
        "Berubah setiap kali foto diganti. Unduh ulang foto hanya kalau nilai ini berbeda dari yang Anda simpan.",
      examples: ["3f9a1c0b2d4e5f61"],
    }),
  }),
  { description: "Berisi null kalau karyawan belum punya foto." }
);

const EmployeeSchema = t.Object({
  nik: t.String({
    description:
      "Nomor induk karyawan. Tidak ada dua karyawan dengan NIK yang sama.",
    examples: ["12345678"],
  }),
  name: t.String({ examples: ["BUDI SANTOSO"] }),
  company: t.String({ examples: ["PT UDU"] }),
  department: t.String({ examples: ["MINING OPERATION"] }),
  position: t.String({ examples: ["OPERATOR HD"] }),
  status: t.String({
    description: "Status karyawan: aktif, standby, atau nonaktif.",
    examples: ["aktif"],
  }),
  joinDate: t.Nullable(t.String({ format: "date", examples: ["2019-04-01"] }), {
    description: "Tanggal mulai bekerja. Berisi null kalau belum tercatat.",
  }),
  skills: t.Array(t.String(), {
    description:
      "Kode SIMPER yang dimiliki, yaitu jenis unit yang boleh dioperasikan. Diurutkan sesuai abjad.",
    examples: [["EXC 2600", "OHT 777"]],
  }),
  photo: PhotoSchema,
});

const PageSchema = t.Object({
  data: t.Array(EmployeeSchema),
  page: t.Number({ description: "Nomor halaman ini.", examples: [1] }),
  limit: t.Number({
    description: "Jumlah karyawan per halaman.",
    examples: [100],
  }),
  total: t.Number({
    description:
      "Jumlah seluruh karyawan yang sesuai dengan filter, dari semua halaman.",
    examples: [1342],
  }),
});

/**
 * A stored photo's name is a fresh UUID per upload (`storedPhotoName`), so it
 * already changes exactly when the photo does. Hashed rather than handed out,
 * so the storage layout stays ours.
 */
const photoVersion = (fileName: string) =>
  createHash("sha256").update(fileName).digest("hex").slice(0, 16);

/** `%`, `_` and `\` are pattern syntax to `ilike`; a search means them literally. */
const literalPattern = (needle: string) =>
  `%${needle.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * Whether `If-None-Match` already names this ETag — as itself, weak
 * (`W/"…"`, which some proxies rewrite a strong tag into), one of a list, or
 * `*`. RFC 9110 compares weakly for this header, so all four are a match.
 */
function stillFresh(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header
    .split(",")
    .map((tag) => tag.trim().replace(/^W\//, ""))
    .some((tag) => tag === "*" || tag === etag);
}

const photoUrl = (nik: string) =>
  `/v1/integrations/employees/${encodeURIComponent(nik)}/photo`;

const baseColumns = {
  id: emp.id,
  nik: emp.nik,
  name: emp.name,
  company: cmp.name,
  department: dpt.name,
  position: pos.name,
  status: emp.status,
  joinDate: emp.joinDate,
  photoFileName: emp.photoFileName,
};

function fromRegister() {
  return db
    .select(baseColumns)
    .from(emp)
    .innerJoin(cmp, eq(cmp.id, emp.companyId))
    .innerJoin(dpt, eq(dpt.id, emp.departmentId))
    .innerJoin(pos, eq(pos.id, emp.positionId));
}

type RegisterRow = Awaited<ReturnType<typeof fromRegister>>[number];

/** Each person's SIMPER codes, by name — one query for the whole page. */
async function skillsOf(ids: string[]): Promise<Map<string, string[]>> {
  const held = new Map<string, string[]>();
  if (!ids.length) return held;
  const rows = await db
    .select({ employeeId: skill.employeeId, name: code.name })
    .from(skill)
    .innerJoin(code, eq(code.id, skill.simperCodeId))
    .where(inArray(skill.employeeId, ids))
    .orderBy(asc(code.name));
  for (const row of rows)
    held.set(row.employeeId, [...(held.get(row.employeeId) ?? []), row.name]);
  return held;
}

function toEmployee(row: RegisterRow, skills: string[]) {
  return {
    nik: row.nik,
    name: row.name,
    company: row.company,
    department: row.department,
    position: row.position,
    status: row.status,
    joinDate: row.joinDate,
    skills,
    photo: row.photoFileName
      ? { url: photoUrl(row.nik), version: photoVersion(row.photoFileName) }
      : null,
  };
}

export const integrationRoutes = new Elysia({
  prefix: "/integrations",
  detail: { tags: ["integrations"] },
})
  .use(requireIntegration)

  .get(
    "/employees",
    async ({ query }) => {
      const page = query.page ?? 1;
      const limit = query.limit ?? DEFAULT_LIMIT;
      const needle = query.q?.trim();
      const filters: SQL[] = [];
      if (query.status) filters.push(eq(emp.status, query.status));
      if (needle) {
        const pattern = literalPattern(needle);
        const match = or(ilike(emp.nik, pattern), ilike(emp.name, pattern));
        if (match) filters.push(match);
      }
      const where = filters.length ? and(...filters) : undefined;

      const [rows, [totals]] = await Promise.all([
        fromRegister()
          .where(where)
          .orderBy(asc(emp.nik))
          .limit(limit)
          .offset((page - 1) * limit),
        db.select({ total: count() }).from(emp).where(where),
      ]);
      const skills = await skillsOf(rows.map((r) => r.id));

      return {
        data: rows.map((r) => toEmployee(r, skills.get(r.id) ?? [])),
        page,
        limit,
        total: totals?.total ?? 0,
      };
    },
    {
      integration: "employees:read",
      query: t.Object({
        page: t.Optional(t.Integer({ minimum: 1, maximum: MAX_PAGE })),
        limit: t.Optional(t.Integer({ minimum: 1, maximum: MAX_LIMIT })),
        status: OptionalEmployeeStatusSchema,
        /** NIK or name, partial. */
        q: t.Optional(t.String({ maxLength: 100 })),
      }),
      response: {
        200: PageSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        429: ErrorSchema,
      },
      detail: {
        summary: "List employees, by NIK, a page at a time",
        security: [{ integrationToken: [] }],
      },
    }
  )

  .get(
    "/employees/:nik",
    async ({ params, status }) => {
      const [row] = await fromRegister()
        .where(eq(emp.nik, params.nik))
        .limit(1);
      if (!row) return status(404, notFound);
      const skills = await skillsOf([row.id]);
      return toEmployee(row, skills.get(row.id) ?? []);
    },
    {
      integration: "employees:read",
      params: t.Object({ nik: t.String({ minLength: 1 }) }),
      response: {
        200: EmployeeSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
        429: ErrorSchema,
      },
      detail: {
        summary: "One employee by NIK",
        security: [{ integrationToken: [] }],
      },
    }
  )

  /*
   * The bytes, streamed as the register's own photo route does. The ETag is
   * the version the record carries, so a sync that remembers it re-fetches a
   * photo only when it changed — and the conditional request costs no read
   * of the file at all.
   */
  .get(
    "/employees/:nik/photo",
    async ({ params, headers, status }) => {
      const [row] = await db
        .select({ photoFileName: emp.photoFileName })
        .from(emp)
        .where(eq(emp.nik, params.nik))
        .limit(1);
      if (!row?.photoFileName) return status(404, notFound);

      const etag = `"${photoVersion(row.photoFileName)}"`;
      const cacheHeaders = {
        etag,
        "cache-control": "private, no-cache",
        "x-content-type-options": "nosniff",
      };
      if (stillFresh(headers["if-none-match"], etag))
        return new Response(null, { status: 304, headers: cacheHeaders });

      const file = Bun.file(photoPath(row.photoFileName));
      if (!(await file.exists())) return status(404, notFound);
      return new Response(file, {
        headers: {
          ...cacheHeaders,
          "content-type": photoMimeType(row.photoFileName),
        },
      });
    },
    {
      integration: "employees:read",
      params: t.Object({ nik: t.String({ minLength: 1 }) }),
      // No 200 schema: the body is an image (see the register's photo route).
      response: {
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
        429: ErrorSchema,
      },
      detail: {
        summary: "An employee's photo (ETag / If-None-Match)",
        security: [{ integrationToken: [] }],
      },
    }
  );
