/**
 * The roster end to end, through the real routes.
 *
 * `roster-import.test.ts` proves the parser and the commit transaction;
 * `roster-revision.test.ts` proves the decisions. What neither covers is the
 * path an operator actually walks — upload a spreadsheet, open its grid, revise
 * a day, approve it, and find the roster in force changed — and the two places
 * that path can go wrong are precisely the ones no unit test reaches: the
 * multipart boundary, and scope.
 *
 * Needs the dev Postgres and Redis, the same as `db:seed`:
 *   bun --env-file=.env test src/routes/roster-e2e.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import ExcelJS from "exceljs";
import { Elysia } from "elysia";
import { eq, inArray } from "drizzle-orm";

import { createSession, SESSION_COOKIE } from "../auth/session";
import { db, schema } from "../db";
import { redis } from "../redis";
import { rosterRoutes } from "./roster";
import { rosterImportRoutes } from "./roster-import";
import { dayHeader, monthDays } from "./roster-month";
import { rosterRevisionRoutes } from "./roster-revision";

const app = new Elysia()
  .use(rosterImportRoutes)
  .use(rosterRoutes)
  .use(rosterRevisionRoutes);

const MONTH = "2026-11";
const FIRST_DAY = `${MONTH}-01`;
const DAYS = monthDays(FIRST_DAY);

const tag = `ZZ Uji E2E ${crypto.randomUUID().slice(0, 8)}`;
const uid = () => crypto.randomUUID();

/* --------------------------------------------------------------- fixtures */

type Person = { id: string; nik: string; name: string };

let departmentA = "";
let departmentB = "";
let alice: Person;
let bob: Person;
/** The dept admin's own employee record — `users.nik` is unique, so the two
    scoped accounts cannot share one. */
let clerk: Person;
let admin = { id: "", cookie: "" };
let deptAdmin = { id: "", cookie: "" };
let operator = { id: "", cookie: "" };

const made = {
  roles: [] as string[],
  users: [] as string[],
  documents: [] as string[],
  employees: [] as string[],
  positions: [] as string[],
  companies: [] as string[],
  departments: [] as string[],
};

async function makeRole(
  scope: "all" | "dept" | "self",
  grants: [string, "view" | "manage"][]
) {
  const [role] = await db
    .insert(schema.roles)
    .values({ slug: `zz-e2e-${uid()}`, name: tag, scope })
    .returning({ id: schema.roles.id });
  made.roles.push(role!.id);
  await db
    .insert(schema.rolePermissions)
    .values(
      grants.map(([menuSlug, mode]) => ({ roleId: role!.id, menuSlug, mode }))
    );
  return role!.id;
}

async function makeUser(roleId: string, nik: string | null) {
  const [user] = await db
    .insert(schema.users)
    .values({
      nik,
      email: nik ? null : `zz-${uid()}@uji.local`,
      name: tag,
      passwordHash: "x",
      roleId,
      mustChangePassword: false,
    })
    .returning({ id: schema.users.id });
  made.users.push(user!.id);
  const session = await createSession("user", user!.id, "cookie");
  return { id: user!.id, cookie: `${SESSION_COOKIE}=${session.id}` };
}

async function makeEmployee(
  departmentId: string,
  companyId: string,
  positionId: string,
  label: string
): Promise<Person> {
  const nik = `ZZ${label}${uid().slice(0, 8)}`;
  const [row] = await db
    .insert(schema.employees)
    .values({
      nik,
      name: `${tag} ${label}`,
      companyId,
      positionId,
      departmentId,
    })
    .returning({ id: schema.employees.id });
  made.employees.push(row!.id);
  return { id: row!.id, nik, name: `${tag} ${label}` };
}

/* ------------------------------------------------------------- requests */

const get = (path: string, cookie: string) =>
  app.handle(new Request(`http://localhost${path}`, { headers: { cookie } }));

const postForm = (path: string, cookie: string, form: FormData) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { cookie },
      body: form,
    })
  );

const postJson = (path: string, cookie: string, body: unknown) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );

/**
 * A roster sheet: the five fixed columns, then one column per day.
 *
 * Built by hand rather than through `rosterSheetWorkbook`, so that a change to
 * the builder cannot quietly change what these tests upload — the point here is
 * that a file shaped like the template imports, not that the API agrees with
 * itself.
 */
async function sheet(
  rows: { person: Person; codes: string[] }[],
  days = DAYS.length
): Promise<File> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("roster");
  ws.addRow([
    "NO",
    "NIK",
    "NAMA",
    "DEPARTEMEN",
    "POSISI",
    ...DAYS.slice(0, days).map((d) => dayHeader(d)),
  ]);
  rows.forEach((row, i) =>
    ws.addRow([
      i + 1,
      row.person.nik,
      row.person.name,
      tag,
      "Operator",
      ...row.codes.slice(0, days),
    ])
  );
  const buffer = await wb.xlsx.writeBuffer();
  return new File([buffer], "roster.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

const all = (code: string) => DAYS.map(() => code);

function form(file: File, departmentId?: string) {
  const f = new FormData();
  f.append("file", file);
  f.append("month", MONTH);
  if (departmentId) f.append("departmentId", departmentId);
  return f;
}

beforeAll(async () => {
  // scheduler.test.ts disconnects the shared client in its teardown, and bun
  // runs every file in one process.
  if (redis.status === "end") await redis.connect();

  // Company first: a department belongs to one, and a position to a department.
  const [company] = await db
    .insert(schema.companies)
    .values({ name: tag, code: tag.slice(-8) })
    .returning({ id: schema.companies.id });
  made.companies.push(company!.id);

  const [a] = await db
    .insert(schema.departments)
    .values({ name: `${tag} A`, companyId: company!.id })
    .returning({ id: schema.departments.id });
  const [b] = await db
    .insert(schema.departments)
    .values({ name: `${tag} B`, companyId: company!.id })
    .returning({ id: schema.departments.id });
  departmentA = a!.id;
  departmentB = b!.id;
  made.departments.push(departmentA, departmentB);

  const [position] = await db
    .insert(schema.positions)
    .values({ name: tag, departmentId: departmentA })
    .returning({ id: schema.positions.id });
  made.positions.push(position!.id);

  alice = await makeEmployee(departmentA, company!.id, position!.id, "Alice");
  clerk = await makeEmployee(departmentA, company!.id, position!.id, "Clerk");
  bob = await makeEmployee(departmentB, company!.id, position!.id, "Bob");

  admin = await makeUser(
    await makeRole("all", [
      ["roster-data", "manage"],
      ["roster-revision", "manage"],
      ["roster-approval", "manage"],
    ]),
    null
  );
  // A `dept` account resolves its department through its NIK's employee record.
  deptAdmin = await makeUser(
    await makeRole("dept", [
      ["roster-data", "manage"],
      ["roster-revision", "manage"],
    ]),
    clerk.nik
  );
  // The `user` role of the seeded matrix: reads its own, submits nothing.
  operator = await makeUser(
    await makeRole("self", [
      ["roster-data", "view"],
      ["roster-revision", "view"],
    ]),
    alice.nik
  );
});

afterAll(async () => {
  if (made.documents.length)
    await db
      .delete(schema.rosterDocuments)
      .where(inArray(schema.rosterDocuments.id, made.documents));
  // Anything the routes created for these departments, not only what the tests
  // remembered the id of.
  await db
    .delete(schema.rosterDocuments)
    .where(
      inArray(schema.rosterDocuments.departmentId, [departmentA, departmentB])
    );
  if (made.employees.length)
    await db
      .delete(schema.employees)
      .where(inArray(schema.employees.id, made.employees));
  if (made.users.length)
    await db.delete(schema.users).where(inArray(schema.users.id, made.users));
  if (made.roles.length)
    await db.delete(schema.roles).where(inArray(schema.roles.id, made.roles));
  // Positions, then departments, then the company: the catalogues own each
  // other now, and `restrict` means the order is not a preference.
  if (made.positions.length)
    await db
      .delete(schema.positions)
      .where(inArray(schema.positions.id, made.positions));
  if (made.departments.length)
    await db
      .delete(schema.departments)
      .where(inArray(schema.departments.id, made.departments));
  if (made.companies.length)
    await db
      .delete(schema.companies)
      .where(inArray(schema.companies.id, made.companies));
});

/* ------------------------------------------------------------------ paths */

describe("upload, revise, approve, read in force", () => {
  let documentId = "";
  let itemId = "";
  const revisedDate = DAYS[9]!;

  test("a spreadsheet becomes a document with a readable grid", async () => {
    const file = await sheet([{ person: alice, codes: all("D") }]);

    const previewed = await postForm(
      "/roster/import/preview",
      admin.cookie,
      form(file, departmentA)
    );
    expect(previewed.status).toBe(200);
    const preview = (await previewed.json()) as {
      errorCount: number;
      newCount: number;
      rowTotal: number;
      token: string | null;
    };
    expect(preview.errorCount).toBe(0);
    expect(preview.newCount).toBe(1);
    expect(preview.rowTotal).toBe(1);

    const committed = await postForm(
      "/roster/import",
      admin.cookie,
      form(file, departmentA)
    );
    expect(committed.status).toBe(200);
    const result = (await committed.json()) as {
      documentId: string;
      created: number;
      employeeCount: number;
    };
    documentId = result.documentId;
    made.documents.push(documentId);
    expect(result.employeeCount).toBe(1);
    expect(result.created).toBe(DAYS.length);

    const grid = await get(`/roster/${documentId}/days`, admin.cookie);
    expect(grid.status).toBe(200);
    const body = (await grid.json()) as {
      days: string[];
      rows: { nik: string; codes: (string | null)[] }[];
      total: number;
    };
    expect(body.days).toHaveLength(DAYS.length);
    expect(body.total).toBe(1);
    expect(body.rows[0]!.nik).toBe(alice.nik);
    expect(body.rows[0]!.codes.every((c) => c === "D")).toBe(true);
  });

  test("a past date and a future date in the month are both accepted", async () => {
    for (const date of [DAYS[0]!, DAYS[DAYS.length - 1]!]) {
      const response = await postJson("/roster-revisions", admin.cookie, {
        entries: [
          { nik: alice.nik, date, toCode: "CR", reason: "uji tanggal" },
        ],
      });
      expect(response.status).toBe(201);
    }
  });

  test("a date outside the document's month is refused", async () => {
    const response = await postJson("/roster-revisions", admin.cookie, {
      entries: [
        { nik: alice.nik, date: "2026-12-01", toCode: "OFF", reason: "uji" },
      ],
    });
    expect(response.status).toBe(422);
  });

  test("approving a revision changes what the roster says in force", async () => {
    const before = await get(
      `/roster/in-force?date=${revisedDate}&code=D`,
      admin.cookie
    );
    const beforeRows = (await before.json()) as {
      employeeId: string;
      kind: string;
    }[];
    const beforeRow = beforeRows.find((r) => r.employeeId === alice.id);
    expect(beforeRow).toBeDefined();
    expect(beforeRow!.kind).toBe("day");

    const submitted = await postJson("/roster-revisions", admin.cookie, {
      entries: [
        {
          nik: alice.nik,
          date: revisedDate,
          toCode: "OFF",
          reason: "keperluan keluarga",
        },
      ],
    });
    expect(submitted.status).toBe(201);
    itemId = ((await submitted.json()) as { items: { id: string }[] }).items[0]!
      .id;

    const queued = await get("/roster-revisions/queue", admin.cookie);
    const queue = (await queued.json()) as { id: string }[];
    expect(queue.some((i) => i.id === itemId)).toBe(true);

    const decided = await postJson(
      `/roster-revisions/items/${itemId}/approve`,
      admin.cookie,
      {}
    );
    expect(decided.status).toBe(200);

    const after = await get(
      `/roster/in-force?date=${revisedDate}&code=D`,
      admin.cookie
    );
    const afterRows = (await after.json()) as { employeeId: string }[];
    expect(afterRows.some((r) => r.employeeId === alice.id)).toBe(false);

    // And the grid shows the new code, because approval writes it in place
    // rather than layering an overlay over it (design D11).
    const grid = await get(`/roster/${documentId}/days`, admin.cookie);
    const body = (await grid.json()) as {
      days: string[];
      rows: { codes: (string | null)[] }[];
    };
    expect(body.rows[0]!.codes[body.days.indexOf(revisedDate)]).toBe("OFF");
  });

  test("re-uploading names the revision it would revert, then archives", async () => {
    // The same file as before: it still says `D` on the revised day.
    const file = await sheet([{ person: alice, codes: all("D") }]);

    const previewed = await postForm(
      "/roster/import/preview",
      admin.cookie,
      form(file, departmentA)
    );
    const preview = (await previewed.json()) as {
      errorCount: number;
      warnings: { issue: string; badgeVariant: string }[];
      updatedCount: number;
    };
    // A warning, not an error: reverting a day is sometimes the intent (D9).
    expect(preview.errorCount).toBe(0);
    expect(preview.updatedCount).toBe(1);
    const reverted = preview.warnings.find((w) =>
      w.issue.includes(revisedDate)
    );
    expect(reverted).toBeDefined();
    expect(reverted!.badgeVariant).toBe("warning");

    // Something still pending on the old document, to watch it be closed out.
    const submitted = await postJson("/roster-revisions", admin.cookie, {
      entries: [
        { nik: alice.nik, date: DAYS[4]!, toCode: "AL", reason: "uji beku" },
      ],
    });
    const pendingId = ((await submitted.json()) as { items: { id: string }[] })
      .items[0]!.id;

    const committed = await postForm(
      "/roster/import",
      admin.cookie,
      form(file, departmentA)
    );
    expect(committed.status).toBe(200);
    const result = (await committed.json()) as {
      documentId: string;
      archivedDocumentId: string | null;
      rejectedRevisions: number;
    };
    made.documents.push(result.documentId);
    expect(result.archivedDocumentId).toBe(documentId);
    expect(result.rejectedRevisions).toBeGreaterThanOrEqual(1);

    // The archived document keeps its grid in full — that is what makes its
    // detail screen readable rather than empty (design D4).
    const archived = await get(`/roster/${documentId}/days`, admin.cookie);
    const body = (await archived.json()) as { rows: { codes: unknown[] }[] };
    expect(body.rows[0]!.codes).toHaveLength(DAYS.length);

    // And the entry that was waiting on it cannot be decided any more.
    const late = await postJson(
      `/roster-revisions/items/${pendingId}/approve`,
      admin.cookie,
      {}
    );
    expect(late.status).toBe(409);

    documentId = result.documentId;
  });
});

describe("the file's width and the month it was chosen for", () => {
  test("a sheet whose day columns do not match the month is refused whole", async () => {
    const short = await sheet(
      [{ person: alice, codes: all("D") }],
      DAYS.length - 1
    );
    const response = await postForm(
      "/roster/import/preview",
      admin.cookie,
      form(short, departmentA)
    );
    expect(response.status).toBe(422);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe("day_column_mismatch");
  });
});

describe("employment status is reported, never written", () => {
  test("a TERM row warns, still commits, and leaves the register alone", async () => {
    const codes = all("D");
    codes[DAYS.length - 1] = "TERM";
    const file = await sheet([{ person: alice, codes }]);

    const previewed = await postForm(
      "/roster/import/preview",
      admin.cookie,
      form(file, departmentA)
    );
    const preview = (await previewed.json()) as {
      errorCount: number;
      warnings: { issue: string }[];
    };
    expect(preview.errorCount).toBe(0);
    expect(preview.warnings.some((w) => w.issue.includes("TERM"))).toBe(true);

    const committed = await postForm(
      "/roster/import",
      admin.cookie,
      form(file, departmentA)
    );
    expect(committed.status).toBe(200);
    made.documents.push(
      ((await committed.json()) as { documentId: string }).documentId
    );

    const [row] = await db
      .select({ status: schema.employees.status })
      .from(schema.employees)
      .where(eq(schema.employees.id, alice.id));
    expect(row!.status).toBe("aktif");
  });
});

/**
 * The template is a department's own sheet, so the department has to be decided
 * before it can be handed out — the same rule the upload follows (D6).
 */
describe("the template a department downloads", () => {
  async function rowsOf(response: Response) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await response.arrayBuffer());
    const ws = wb.worksheets[0]!;
    const names: string[] = [];
    for (let n = 2; n <= ws.rowCount; n++)
      names.push(String(ws.getRow(n).getCell(3).value ?? ""));
    return { ws, names };
  }

  test("a dept caller gets its own department's people, nobody else's", async () => {
    const response = await get(
      `/roster/import/template?month=${MONTH.slice(0, 7)}`,
      deptAdmin.cookie
    );
    expect(response.status).toBe(200);

    const { ws, names } = await rowsOf(response);
    expect(ws.getRow(1).getCell(2).value).toBe("NIK");
    expect(ws.columnCount).toBe(5 + DAYS.length);
    // Alice and Clerk are department A; Bob is department B.
    expect(names).toContain(alice.name);
    expect(names).toContain(clerk.name);
    expect(names).not.toContain(bob.name);
  });

  test("an all-scoped caller must name a department", async () => {
    const response = await get(
      `/roster/import/template?month=${MONTH.slice(0, 7)}`,
      admin.cookie
    );
    expect(response.status).toBe(422);

    const named = await get(
      `/roster/import/template?month=${MONTH.slice(0, 7)}&departmentId=${departmentB}`,
      admin.cookie
    );
    expect(named.status).toBe(200);
    const { names } = await rowsOf(named);
    expect(names).toEqual([bob.name]);
  });

  test("the department it names is ignored for a scoped caller", async () => {
    // Asking for B as a caller scoped to A still returns A — the value is not
    // corrected, it is never read.
    const response = await get(
      `/roster/import/template?month=${MONTH.slice(0, 7)}&departmentId=${departmentB}`,
      deptAdmin.cookie
    );
    expect(response.status).toBe(200);
    const { names } = await rowsOf(response);
    expect(names).not.toContain(bob.name);
    expect(names).toContain(alice.name);
  });
});

describe("scope", () => {
  test("a dept caller sees only its own department's documents", async () => {
    // Give department B a document, so there is something to *not* see.
    const file = await sheet([{ person: bob, codes: all("N") }]);
    const committed = await postForm(
      "/roster/import",
      admin.cookie,
      form(file, departmentB)
    );
    expect(committed.status).toBe(200);
    made.documents.push(
      ((await committed.json()) as { documentId: string }).documentId
    );

    const mine = await get("/roster", deptAdmin.cookie);
    const rows = (await mine.json()) as { departmentId: string }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.departmentId === departmentA)).toBe(true);
  });

  test("a dept caller cannot upload for another department", async () => {
    const file = await sheet([{ person: bob, codes: all("D") }]);
    // The body names B; the server resolves A from the caller's own record and
    // ignores the value, so every row then fails as cross-department (D6).
    const response = await postForm(
      "/roster/import/preview",
      deptAdmin.cookie,
      form(file, departmentB)
    );
    expect(response.status).toBe(200);
    const preview = (await response.json()) as {
      errorCount: number;
      errors: { issue: string }[];
    };
    expect(preview.errorCount).toBe(1);
    expect(preview.errors[0]!.issue).toContain(`${tag} B`);
  });

  test("a self caller sees only the revisions naming itself", async () => {
    // Bob has a document but no revisions; Alice has several.
    const listed = await get("/roster-revisions", operator.cookie);
    expect(listed.status).toBe(200);
    const revisions = (await listed.json()) as {
      items: { nik: string }[];
    }[];
    expect(revisions.length).toBeGreaterThan(0);
    expect(
      revisions.every((r) => r.items.every((i) => i.nik === alice.nik))
    ).toBe(true);
  });

  test("a self caller holding only view cannot submit", async () => {
    const response = await postJson("/roster-revisions", operator.cookie, {
      entries: [
        { nik: alice.nik, date: DAYS[2]!, toCode: "OFF", reason: "uji" },
      ],
    });
    // 403 from the permission gate, before scope is even consulted.
    expect(response.status).toBe(403);
  });

  test("a self caller cannot decide anything", async () => {
    const response = await get("/roster-revisions/queue", operator.cookie);
    expect(response.status).toBe(403);
  });
});
