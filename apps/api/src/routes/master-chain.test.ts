/**
 * The organisation chain, driven through the real catalogue routes.
 *
 * These pin the requirement `add-organisation-chain` exists to correct: a
 * department's name is unique within its company rather than globally, and a
 * position's within its department — plus the guarantees that keep that shape
 * honest on the wire (the union order, the delete refusal, the parent an edit
 * cannot move, and an export that survives its own import). Needs the dev
 * Postgres and Redis:
 *   bun --env-file=.env test src/routes/master-chain.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { eq, inArray } from "drizzle-orm";

import { createSession, SESSION_COOKIE } from "../auth/session";
import { db, schema } from "../db";
import { redis } from "../redis";
import { masterRoutes } from "./master";

const app = new Elysia().use(masterRoutes);

const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ Uji Chain ${uid()}`;

const made = {
  users: [] as string[],
  roles: [] as string[],
  positions: [] as string[],
  departments: [] as string[],
  companies: [] as string[],
};

let admin: { cookie: string; id: string };

/* ------------------------------------------------------------- fixtures */

async function makeAdmin() {
  const [role] = await db
    .insert(schema.roles)
    .values({ slug: `zz-chain-${uid()}`, name: tag, scope: "all" })
    .returning({ id: schema.roles.id });
  made.roles.push(role!.id);
  await db.insert(schema.rolePermissions).values(
    (["perusahaan", "departemen", "jabatan"] as const).map((menuSlug) => ({
      roleId: role!.id,
      menuSlug,
      mode: "manage" as const,
    }))
  );
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `zz-${uid()}@uji.local`,
      name: tag,
      passwordHash: "x",
      roleId: role!.id,
      mustChangePassword: false,
    })
    .returning({ id: schema.users.id });
  made.users.push(user!.id);
  const session = await createSession("user", user!.id, "cookie");
  return { id: user!.id, cookie: `${SESSION_COOKIE}=${session.id}` };
}

async function makeCompany(label: string) {
  const [row] = await db
    .insert(schema.companies)
    .values({ name: `${tag} ${label}`, code: `ZZ${uid()}` })
    .returning({ id: schema.companies.id });
  made.companies.push(row!.id);
  return row!.id;
}

/* -------------------------------------------------------------- requests */

const send = (method: string, path: string, body?: unknown) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: body
        ? { cookie: admin.cookie, "content-type": "application/json" }
        : { cookie: admin.cookie },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  );

/** What the routes answer with — only the fields these tests assert on. */
type Row = {
  id: string;
  name?: string;
  companyId?: string;
  departmentId?: string;
  fleetAllocation?: boolean;
};

/** Remember a row created through the route, so teardown can find it. */
const track = (list: string[], record: unknown) => {
  const row = record as Row;
  list.push(row.id);
  return row;
};

beforeAll(async () => {
  // scheduler.test.ts disconnects the shared client in its teardown, and bun
  // runs every file in one process.
  if (redis.status === "end") await redis.connect();
  admin = await makeAdmin();
});

afterAll(async () => {
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
  if (made.users.length)
    await db.delete(schema.users).where(inArray(schema.users.id, made.users));
  if (made.roles.length)
    await db.delete(schema.roles).where(inArray(schema.roles.id, made.roles));
});

/* -------------------------------------------------- uniqueness per parent */

describe("a name is unique within its parent, not across the catalogue", () => {
  test("two companies can each hold a department of the same name", async () => {
    const companyA = await makeCompany("U");
    const companyB = await makeCompany("R");
    const name = `${tag} MINING OPERATION`;

    const first = await send("POST", "/master/departemen", {
      name,
      companyId: companyA,
    });
    expect(first.status).toBe(201);
    const a = track(made.departments, await first.json());

    const second = await send("POST", "/master/departemen", {
      name,
      companyId: companyB,
    });
    expect(second.status).toBe(201);
    const b = track(made.departments, await second.json());
    expect(b.id).not.toBe(a.id);

    // Within one company the index still refuses, and case is no escape —
    // the index is over (company_id, lower(name)).
    const duplicate = await send("POST", "/master/departemen", {
      name: name.toLowerCase(),
      companyId: companyA,
    });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({ code: "master_exists" });
  });

  test("two departments can each hold a position of the same name", async () => {
    const companyId = await makeCompany("P");
    const deptA = track(
      made.departments,
      await (
        await send("POST", "/master/departemen", {
          name: `${tag} OPS`,
          companyId,
        })
      ).json()
    );
    const deptB = track(
      made.departments,
      await (
        await send("POST", "/master/departemen", {
          name: `${tag} HRM`,
          companyId,
        })
      ).json()
    );

    const name = `${tag} ADMIN`;
    const first = await send("POST", "/master/jabatan", {
      name,
      departmentId: deptA.id,
    });
    expect(first.status).toBe(201);
    track(made.positions, await first.json());

    const second = await send("POST", "/master/jabatan", {
      name,
      departmentId: deptB.id,
    });
    expect(second.status).toBe(201);
    track(made.positions, await second.json());

    const duplicate = await send("POST", "/master/jabatan", {
      name: name.toLowerCase(),
      departmentId: deptA.id,
    });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({ code: "master_exists" });
  });
});

/* ------------------------------------------------------------ union order */

describe("the wire carries the owner", () => {
  /**
   * `MasterRecordSchema` is a union and TypeBox keeps the first member that
   * validates, so a department matched as described-only would reach the
   * client with `companyId` stripped. Asserting the field on a listed row is
   * what guards the declaration order in `schemas.ts`.
   */
  test("a listed department still carries its companyId", async () => {
    const companyId = await makeCompany("W");
    const dept = track(
      made.departments,
      await (
        await send("POST", "/master/departemen", {
          name: `${tag} WIRE`,
          companyId,
        })
      ).json()
    );

    const list = await send("GET", "/master/departemen");
    expect(list.status).toBe(200);
    const rows = (await list.json()) as Row[];
    const row = rows.find((r) => r.id === dept.id);
    expect(row?.companyId).toBe(companyId);
  });

  test("a listed position carries departmentId and its fleet flag", async () => {
    const companyId = await makeCompany("F");
    const dept = track(
      made.departments,
      await (
        await send("POST", "/master/departemen", {
          name: `${tag} FLEET`,
          companyId,
        })
      ).json()
    );
    const position = track(
      made.positions,
      await (
        await send("POST", "/master/jabatan", {
          name: `${tag} DRIVER`,
          departmentId: dept.id,
          fleetAllocation: true,
        })
      ).json()
    );

    const list = await send("GET", "/master/jabatan");
    const rows = (await list.json()) as Row[];
    const row = rows.find((r) => r.id === position.id);
    expect(row?.departmentId).toBe(dept.id);
    expect(row?.fleetAllocation).toBe(true);
  });
});

/* --------------------------------------------------------- delete refusal */

describe("deleting a parent that is still held", () => {
  test("a company with departments is refused, and the count names them", async () => {
    const companyId = await makeCompany("D");
    track(
      made.departments,
      await (
        await send("POST", "/master/departemen", {
          name: `${tag} HELD`,
          companyId,
        })
      ).json()
    );

    const response = await send("DELETE", `/master/perusahaan/${companyId}`);
    expect(response.status).toBe(409);
    const body = (await response.json()) as { code: string; message: string };
    expect(body.code).toBe("master_in_use");
    expect(body.message).toContain("1 departemen");
  });

  test("a department with positions is refused, and the count names them", async () => {
    const companyId = await makeCompany("E");
    const dept = track(
      made.departments,
      await (
        await send("POST", "/master/departemen", {
          name: `${tag} HOLDER`,
          companyId,
        })
      ).json()
    );
    track(
      made.positions,
      await (
        await send("POST", "/master/jabatan", {
          name: `${tag} HELD POS`,
          departmentId: dept.id,
        })
      ).json()
    );

    const response = await send("DELETE", `/master/departemen/${dept.id}`);
    expect(response.status).toBe(409);
    const body = (await response.json()) as { code: string; message: string };
    expect(body.code).toBe("master_in_use");
    expect(body.message).toContain("1 jabatan");
  });
});

/* ------------------------------------------------------ the locked parent */

describe("an edit cannot move a record to another parent", () => {
  /**
   * `PATCH /:kind/:id` declares no parent field, so Elysia's `normalize` —
   * on by default — strips one from the body before the handler runs (design
   * D5). This pins behaviour that comes from the framework default rather
   * than from our own code, on purpose: an Elysia upgrade that changes the
   * default should break this test, not the guarantee.
   */
  test("an edit carrying companyId returns 200 with the parent unchanged", async () => {
    const companyA = await makeCompany("M1");
    const companyB = await makeCompany("M2");
    const dept = track(
      made.departments,
      await (
        await send("POST", "/master/departemen", {
          name: `${tag} STAY`,
          companyId: companyA,
        })
      ).json()
    );

    const response = await send("PATCH", `/master/departemen/${dept.id}`, {
      name: `${tag} STAY PUT`,
      companyId: companyB,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Row;
    expect(body.name).toBe(`${tag} STAY PUT`);
    // Not corrected, not refused — never seen.
    expect(body.companyId).toBe(companyA);

    const [row] = await db
      .select({ companyId: schema.departments.companyId })
      .from(schema.departments)
      .where(eq(schema.departments.id, dept.id));
    expect(row!.companyId).toBe(companyA);
  });

  test("an edit carrying departmentId leaves a position where it is", async () => {
    const companyId = await makeCompany("M3");
    const deptA = track(
      made.departments,
      await (
        await send("POST", "/master/departemen", {
          name: `${tag} FROM`,
          companyId,
        })
      ).json()
    );
    const deptB = track(
      made.departments,
      await (
        await send("POST", "/master/departemen", {
          name: `${tag} TO`,
          companyId,
        })
      ).json()
    );
    const position = track(
      made.positions,
      await (
        await send("POST", "/master/jabatan", {
          name: `${tag} FIXED`,
          departmentId: deptA.id,
        })
      ).json()
    );

    const response = await send("PATCH", `/master/jabatan/${position.id}`, {
      departmentId: deptB.id,
    });
    expect(response.status).toBe(200);
    expect(((await response.json()) as Row).departmentId).toBe(deptA.id);

    const [row] = await db
      .select({ departmentId: schema.positions.departmentId })
      .from(schema.positions)
      .where(eq(schema.positions.id, position.id));
    expect(row!.departmentId).toBe(deptA.id);
  });
});

/* -------------------------------------------------------------- round trip */

describe("an export survives its own import", () => {
  /**
   * The columns an export writes and the columns an import reads are one
   * list, and the owned catalogues carry their parents as *names* on the
   * sheet while storing ids. This asserts the translation is lossless in
   * both directions for all three: re-importing an untouched export must
   * read as "nothing to do", never as an error and never as a change.
   */
  const roundTrip = async (kind: string) => {
    const exported = await send("GET", `/master/${kind}/export`);
    expect(exported.status).toBe(200);
    const bytes = await exported.arrayBuffer();

    const form = new FormData();
    form.append(
      "file",
      new File([bytes], `${kind}.xlsx`, {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })
    );
    const preview = await app.handle(
      new Request(`http://localhost/master/${kind}/import/preview`, {
        method: "POST",
        headers: { cookie: admin.cookie },
        body: form,
      })
    );
    expect(preview.status).toBe(200);
    return (await preview.json()) as {
      newCount: number;
      updatedCount: number;
      unchangedCount: number;
      errorCount: number;
    };
  };

  test("perusahaan, departemen, and jabatan each round-trip unchanged", async () => {
    // Fixture rows so the round trip is never vacuous on an empty catalogue —
    // one department name under two companies, so the export has to qualify.
    const companyA = await makeCompany("X1");
    const companyB = await makeCompany("X2");
    for (const companyId of [companyA, companyB]) {
      const dept = track(
        made.departments,
        await (
          await send("POST", "/master/departemen", {
            name: `${tag} ROUND`,
            companyId,
          })
        ).json()
      );
      track(
        made.positions,
        await (
          await send("POST", "/master/jabatan", {
            name: `${tag} TRIP`,
            departmentId: dept.id,
            fleetAllocation: true,
          })
        ).json()
      );
    }

    for (const kind of ["perusahaan", "departemen", "jabatan"]) {
      const preview = await roundTrip(kind);
      expect(`${kind} errors: ${preview.errorCount}`).toBe(`${kind} errors: 0`);
      expect(`${kind} new: ${preview.newCount}`).toBe(`${kind} new: 0`);
      expect(`${kind} updated: ${preview.updatedCount}`).toBe(
        `${kind} updated: 0`
      );
      expect(preview.unchangedCount).toBeGreaterThan(0);
    }
  });
});
