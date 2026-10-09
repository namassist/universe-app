/**
 * The integration API, as another service on the site network reads it.
 *
 * What must hold: only a live token carrying the scope gets in, from an
 * address it is allowed; a person's session never does; and what comes out is
 * the employee record the service asked for — nothing personal beyond it.
 *
 * Needs the dev Postgres and Redis:
 *   bun --env-file=.env test src/routes/integrations.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { eq, inArray } from "drizzle-orm";
import type { IntegrationScope } from "@universe/contracts";

import { createSession } from "../auth/session";
import { db, schema } from "../db";
import { env } from "../env";
import { mintToken } from "../integrations/tokens";
import { redis } from "../redis";
import { localDate } from "../scheduler";
import { deletePhoto, storedPhotoName, writePhoto } from "../storage";
import { integrationRoutes } from "./integrations";

const app = new Elysia().use(integrationRoutes);

const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ Integrasi ${uid()}`;
const nikOf = () =>
  `97${Math.floor(Math.random() * 1e7)
    .toString()
    .padStart(7, "0")}`;

const made = {
  clients: [] as string[],
  users: [] as string[],
  roles: [] as string[],
  employees: [] as string[],
  simperCodes: [] as string[],
  positions: [] as string[],
  departments: [] as string[],
  companies: [] as string[],
  photos: [] as string[],
};

let companyId = "";
let departmentId = "";
let positionId = "";
let adminId = "";
let codeA = "";
let codeB = "";

type Employee = {
  nik: string;
  name: string;
  company: string;
  department: string;
  position: string;
  status: string;
  joinDate: string | null;
  skills: string[];
  photo: { url: string; version: string } | null;
};
type Page = { data: Employee[]; page: number; limit: number; total: number };

async function addClient(
  options: {
    scopes?: IntegrationScope[];
    allowedIps?: string[];
    revoked?: boolean;
    validFrom?: string;
    validUntil?: string | null;
  } = {}
) {
  const minted = mintToken();
  const [row] = await db
    .insert(schema.integrationClients)
    .values({
      name: `${tag} ${uid()}`,
      tokenHash: minted.hash,
      tokenPrefix: minted.prefix,
      scopes: options.scopes ?? ["employees:read"],
      allowedIps: options.allowedIps ?? [],
      createdBy: adminId,
      validFrom: options.validFrom ?? today(),
      validUntil: options.validUntil ?? null,
      ...(options.revoked ? { revokedAt: new Date(), revokedBy: adminId } : {}),
    })
    .returning({ id: schema.integrationClients.id });
  made.clients.push(row!.id);
  return { id: row!.id, token: minted.token };
}

async function addEmployee(
  values: Partial<typeof schema.employees.$inferInsert> = {},
  skills: string[] = []
) {
  const nik = nikOf();
  const [row] = await db
    .insert(schema.employees)
    .values({
      nik,
      name: `${tag} ${nik}`,
      companyId,
      departmentId,
      positionId,
      status: "aktif",
      ...values,
    })
    .returning({ id: schema.employees.id });
  made.employees.push(row!.id);
  if (skills.length)
    await db
      .insert(schema.employeeSkills)
      .values(
        skills.map((simperCodeId) => ({ employeeId: row!.id, simperCodeId }))
      );
  return { id: row!.id, nik };
}

/** Site dates, as the macro compares them. */
const today = () => localDate(new Date());
const dayOffset = (days: number) =>
  localDate(new Date(Date.now() + days * 86_400_000));

const get = (path: string, headers: Record<string, string> = {}) =>
  app.handle(new Request(`http://localhost${path}`, { headers }));
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
/** Scoped to this file's people: the test database holds everyone else's. */
const listPath = (query = "") =>
  `/integrations/employees?q=${encodeURIComponent(tag)}${query}`;

beforeAll(async () => {
  if (redis.status === "end") await redis.connect();

  const [company] = await db
    .insert(schema.companies)
    .values({ name: `${tag} PT`, code: `ZI${uid()}` })
    .returning({ id: schema.companies.id });
  companyId = company!.id;
  made.companies.push(companyId);

  const [dept] = await db
    .insert(schema.departments)
    .values({ name: `${tag} Mining`, companyId })
    .returning({ id: schema.departments.id });
  departmentId = dept!.id;
  made.departments.push(departmentId);

  const [pos] = await db
    .insert(schema.positions)
    .values({ name: `${tag} Operator`, departmentId })
    .returning({ id: schema.positions.id });
  positionId = pos!.id;
  made.positions.push(positionId);

  const codes = await db
    .insert(schema.simperCodes)
    .values([{ name: `${tag} OHT 777` }, { name: `${tag} EXC 2600` }])
    .returning({ id: schema.simperCodes.id });
  [codeA, codeB] = codes.map((c) => c.id) as [string, string];
  made.simperCodes.push(codeA, codeB);

  const [role] = await db
    .insert(schema.roles)
    .values({ slug: `zz-integrasi-${uid()}`, name: tag, scope: "all" })
    .returning({ id: schema.roles.id });
  made.roles.push(role!.id);
  const [admin] = await db
    .insert(schema.users)
    .values({
      email: `zz-${uid()}@uji.local`,
      name: `${tag} admin`,
      passwordHash: "x",
      roleId: role!.id,
      mustChangePassword: false,
    })
    .returning({ id: schema.users.id });
  adminId = admin!.id;
  made.users.push(adminId);
});

afterAll(async () => {
  for (const name of made.photos) await deletePhoto(name);
  if (made.clients.length)
    await db
      .delete(schema.integrationClients)
      .where(inArray(schema.integrationClients.id, made.clients));
  if (made.employees.length)
    await db
      .delete(schema.employees)
      .where(inArray(schema.employees.id, made.employees));
  if (made.simperCodes.length)
    await db
      .delete(schema.simperCodes)
      .where(inArray(schema.simperCodes.id, made.simperCodes));
  if (made.users.length)
    await db.delete(schema.users).where(inArray(schema.users.id, made.users));
  if (made.roles.length)
    await db.delete(schema.roles).where(inArray(schema.roles.id, made.roles));
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

describe("who gets in", () => {
  test("no token is 401", async () => {
    const response = await get(listPath());
    expect(response.status).toBe(401);
  });

  test("an unknown token is 401", async () => {
    const response = await get(listPath(), bearer(mintToken().token));
    expect(response.status).toBe(401);
  });

  test("a revoked token is 401", async () => {
    const client = await addClient({ revoked: true });
    const response = await get(listPath(), bearer(client.token));
    expect(response.status).toBe(401);
  });

  test("a token past its last day is 401, and says it expired", async () => {
    const client = await addClient({
      validFrom: dayOffset(-30),
      validUntil: dayOffset(-1),
    });
    const response = await get(listPath(), bearer(client.token));
    expect(response.status).toBe(401);
    expect(((await response.json()) as { code: string }).code).toBe(
      "token_expired"
    );
  });

  test("the last day itself still works — the end is inclusive", async () => {
    const client = await addClient({ validUntil: today() });
    const response = await get(listPath(), bearer(client.token));
    expect(response.status).toBe(200);
  });

  test("a token before its first day is 401, and says so", async () => {
    const client = await addClient({
      validFrom: dayOffset(1),
      validUntil: dayOffset(30),
    });
    const response = await get(listPath(), bearer(client.token));
    expect(response.status).toBe(401);
    expect(((await response.json()) as { code: string }).code).toBe(
      "token_not_yet_valid"
    );
  });

  test("a person's bearer session is not a service token", async () => {
    const session = await createSession("user", adminId, "bearer");
    const response = await get(listPath(), bearer(session.id));
    expect(response.status).toBe(401);
  });

  test("a token without the scope is 403", async () => {
    const client = await addClient({ scopes: [] });
    const response = await get(listPath(), bearer(client.token));
    expect(response.status).toBe(403);
  });

  test("a token restricted to other addresses is 403", async () => {
    const client = await addClient({ allowedIps: ["192.0.2.10"] });
    const response = await get(listPath(), bearer(client.token));
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe(
      "ip_not_allowed"
    );
  });

  test("past its budget a token is 429, told when to come back", async () => {
    const client = await addClient();
    // Spend the budget for this minute and the next, so the test cannot
    // straddle a minute boundary and find a fresh one.
    const minute = Math.floor(Date.now() / 60_000);
    for (const m of [minute, minute + 1]) {
      const key = `integration:rate:${client.id}:${m}`;
      await redis.set(key, env.INTEGRATION_RATE_PER_MINUTE, "EX", 120);
    }

    const response = await get(listPath(), bearer(client.token));
    expect(response.status).toBe(429);
    expect(((await response.json()) as { code: string }).code).toBe(
      "rate_limited"
    );
    const wait = Number(response.headers.get("retry-after"));
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(60);
  });

  test("a call stamps when the token was last used", async () => {
    const client = await addClient();
    const response = await get(listPath(), bearer(client.token));
    expect(response.status).toBe(200);

    // Detached, so give it a moment to land.
    await Bun.sleep(50);
    const [row] = await db
      .select({ lastUsedAt: schema.integrationClients.lastUsedAt })
      .from(schema.integrationClients)
      .where(eq(schema.integrationClients.id, client.id));
    expect(row!.lastUsedAt).not.toBeNull();
  });
});

describe("the employee list", () => {
  test("carries what was asked for and nothing personal beyond it", async () => {
    const client = await addClient();
    const person = await addEmployee(
      {
        joinDate: "2019-04-01",
        phone: "0812000000",
        emergency: "ibu 0813",
        medical: "asma",
        blood: "O",
        simperNo: "SIM-123",
      },
      [codeA, codeB]
    );

    const response = await get(
      `/integrations/employees?q=${person.nik}`,
      bearer(client.token)
    );
    expect(response.status).toBe(200);
    const page = (await response.json()) as Page;
    const row = page.data.find((e) => e.nik === person.nik);

    expect(row).toEqual({
      nik: person.nik,
      name: `${tag} ${person.nik}`,
      company: `${tag} PT`,
      department: `${tag} Mining`,
      position: `${tag} Operator`,
      status: "aktif",
      joinDate: "2019-04-01",
      skills: [`${tag} EXC 2600`, `${tag} OHT 777`],
      photo: null,
    });
    const raw = JSON.stringify(page);
    for (const secret of ["0812000000", "ibu 0813", "asma", "SIM-123"])
      expect(raw).not.toContain(secret);
  });

  test("pages, and says how many there are in all", async () => {
    const client = await addClient();
    for (let i = 0; i < 3; i++) await addEmployee();

    const first = (await (
      await get(listPath("&limit=2&page=1"), bearer(client.token))
    ).json()) as Page;
    const second = (await (
      await get(listPath("&limit=2&page=2"), bearer(client.token))
    ).json()) as Page;

    expect(first.page).toBe(1);
    expect(first.limit).toBe(2);
    expect(first.data.length).toBe(2);
    expect(first.total).toBe(second.total);
    expect(first.total).toBeGreaterThanOrEqual(3);
    const seen = [...first.data, ...second.data].map((e) => e.nik);
    expect(new Set(seen).size).toBe(seen.length);
  });

  test("filters by status", async () => {
    const client = await addClient();
    const off = await addEmployee({ status: "nonaktif" });

    const aktif = (await (
      await get(listPath("&status=aktif&limit=500"), bearer(client.token))
    ).json()) as Page;
    const all = (await (
      await get(listPath("&limit=500"), bearer(client.token))
    ).json()) as Page;

    expect(aktif.data.some((e) => e.nik === off.nik)).toBe(false);
    expect(all.data.some((e) => e.nik === off.nik)).toBe(true);
    expect(aktif.data.every((e) => e.status === "aktif")).toBe(true);
  });

  test("a percent sign in the search is a character, not a wildcard", async () => {
    const client = await addClient();
    await addEmployee();

    const page = (await (
      await get(
        `/integrations/employees?q=${encodeURIComponent(`${tag}%`)}`,
        bearer(client.token)
      )
    ).json()) as Page;
    expect(page.total).toBe(0);
  });

  test("refuses a page past any real register", async () => {
    const client = await addClient();
    const response = await get(
      listPath("&page=9007199254740991"),
      bearer(client.token)
    );
    expect(response.status).toBe(422);
  });

  test("refuses a limit past the cap", async () => {
    const client = await addClient();
    const response = await get(listPath("&limit=5000"), bearer(client.token));
    expect(response.status).toBe(422);
  });
});

describe("one employee", () => {
  test("is found by NIK", async () => {
    const client = await addClient();
    const person = await addEmployee({}, [codeA]);

    const response = await get(
      `/integrations/employees/${person.nik}`,
      bearer(client.token)
    );
    expect(response.status).toBe(200);
    const row = (await response.json()) as Employee;
    expect(row.nik).toBe(person.nik);
    expect(row.skills).toEqual([`${tag} OHT 777`]);
  });

  test("an unknown NIK is 404", async () => {
    const client = await addClient();
    const response = await get(
      "/integrations/employees/tidak-ada",
      bearer(client.token)
    );
    expect(response.status).toBe(404);
  });
});

describe("the photo", () => {
  async function withPhoto() {
    const fileName = storedPhotoName("foto.jpg", "image/jpeg")!;
    await writePhoto(fileName, new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer);
    made.photos.push(fileName);
    return addEmployee({ photoFileName: fileName });
  }

  test("the record points at it, with a version", async () => {
    const client = await addClient();
    const person = await withPhoto();

    const row = (await (
      await get(`/integrations/employees/${person.nik}`, bearer(client.token))
    ).json()) as Employee;

    expect(row.photo?.url).toBe(
      `/v1/integrations/employees/${person.nik}/photo`
    );
    expect(row.photo?.version).toMatch(/^[0-9a-f]{16}$/);
  });

  test("is served with its version as the ETag", async () => {
    const client = await addClient();
    const person = await withPhoto();
    const row = (await (
      await get(`/integrations/employees/${person.nik}`, bearer(client.token))
    ).json()) as Employee;

    const response = await get(
      `/integrations/employees/${person.nik}/photo`,
      bearer(client.token)
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("etag")).toBe(`"${row.photo!.version}"`);
  });

  test("an unchanged photo is 304", async () => {
    const client = await addClient();
    const person = await withPhoto();
    const first = await get(
      `/integrations/employees/${person.nik}/photo`,
      bearer(client.token)
    );
    const etag = first.headers.get("etag")!;

    const again = await get(`/integrations/employees/${person.nik}/photo`, {
      ...bearer(client.token),
      "if-none-match": etag,
    });
    expect(again.status).toBe(304);
  });

  test("is never sniffed for another type", async () => {
    const client = await addClient();
    const person = await withPhoto();
    const response = await get(
      `/integrations/employees/${person.nik}/photo`,
      bearer(client.token)
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("a weak validator, a list, or * all count as unchanged", async () => {
    const client = await addClient();
    const person = await withPhoto();
    const path = `/integrations/employees/${person.nik}/photo`;
    const etag = (await get(path, bearer(client.token))).headers.get("etag")!;

    for (const header of [`W/${etag}`, `"other", ${etag}`, "*"]) {
      const response = await get(path, {
        ...bearer(client.token),
        "if-none-match": header,
      });
      expect(response.status).toBe(304);
    }

    const stale = await get(path, {
      ...bearer(client.token),
      "if-none-match": '"0000000000000000"',
    });
    expect(stale.status).toBe(200);
  });

  test("someone without a photo is 404", async () => {
    const client = await addClient();
    const person = await addEmployee();
    const response = await get(
      `/integrations/employees/${person.nik}/photo`,
      bearer(client.token)
    );
    expect(response.status).toBe(404);
  });

  test("needs a token like everything else", async () => {
    const person = await withPhoto();
    const response = await get(`/integrations/employees/${person.nik}/photo`);
    expect(response.status).toBe(401);
  });
});
