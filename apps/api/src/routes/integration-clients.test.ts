/**
 * Managing integration clients — the screen an admin hands a token out from.
 *
 * What must hold: only the menu's holders manage it; the token is shown once
 * and works at once; what is kept and listed is never enough to use it; and a
 * revoked token stops working on the next request.
 *
 * Needs the dev Postgres and Redis:
 *   bun --env-file=.env test src/routes/integration-clients.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { eq, inArray } from "drizzle-orm";
import type { AccessMode, MenuSlug } from "@universe/contracts";

import { createSession, SESSION_COOKIE } from "../auth/session";
import { db, schema } from "../db";
import { redis } from "../redis";
import { localDate } from "../scheduler";
import { integrationClientRoutes } from "./integration-clients";
import { integrationRoutes } from "./integrations";

const app = new Elysia().use(integrationClientRoutes).use(integrationRoutes);

const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ Klien ${uid()}`;

const made = { users: [] as string[], roles: [] as string[] };

type Client = {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  allowedIps: string[];
  createdByName: string;
  createdAt: string;
  lastUsedAt: string | null;
  validFrom: string;
  validUntil: string | null;
  revokedAt: string | null;
  revokedByName: string | null;
};
type Created = Client & { token: string };

async function makeUser(grants: { menu: MenuSlug; mode: AccessMode }[]) {
  const [role] = await db
    .insert(schema.roles)
    .values({ slug: `zz-klien-${uid()}`, name: tag, scope: "all" })
    .returning({ id: schema.roles.id });
  made.roles.push(role!.id);
  if (grants.length)
    await db.insert(schema.rolePermissions).values(
      grants.map((g) => ({
        roleId: role!.id,
        menuSlug: g.menu,
        mode: g.mode,
      }))
    );
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `zz-${uid()}@uji.local`,
      name: `${tag} admin`,
      passwordHash: "x",
      roleId: role!.id,
      mustChangePassword: false,
    })
    .returning({ id: schema.users.id });
  made.users.push(user!.id);
  const session = await createSession("user", user!.id, "cookie");
  return `${SESSION_COOKIE}=${session.id}`;
}

const send = (
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: unknown
) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        ...headers,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  );
const as = (cookie: string) => ({ cookie });

let manager = "";
let viewer = "";
let outsider = "";

const create = (
  cookie: string,
  body: {
    name?: string;
    scopes?: string[];
    allowedIps?: string[];
    validFrom?: string;
    validUntil?: string | null;
  } = {}
) =>
  send("POST", "/integration-clients", as(cookie), {
    name: `${tag} ${uid()}`,
    scopes: ["employees:read"],
    allowedIps: [],
    ...body,
  });

beforeAll(async () => {
  if (redis.status === "end") await redis.connect();
  manager = await makeUser([{ menu: "integrations", mode: "manage" }]);
  viewer = await makeUser([{ menu: "integrations", mode: "view" }]);
  outsider = await makeUser([{ menu: "employees", mode: "manage" }]);
});

afterAll(async () => {
  if (made.users.length) {
    await db
      .delete(schema.integrationClients)
      .where(inArray(schema.integrationClients.createdBy, made.users));
    await db.delete(schema.users).where(inArray(schema.users.id, made.users));
  }
  if (made.roles.length)
    await db.delete(schema.roles).where(inArray(schema.roles.id, made.roles));
});

describe("who manages tokens", () => {
  test("someone without the menu is refused", async () => {
    const list = await send("GET", "/integration-clients", as(outsider));
    expect(list.status).toBe(403);
    expect((await create(outsider)).status).toBe(403);
  });

  test("view may list but not create", async () => {
    const list = await send("GET", "/integration-clients", as(viewer));
    expect(list.status).toBe(200);
    expect((await create(viewer)).status).toBe(403);
  });

  test("no session is 401", async () => {
    expect((await send("GET", "/integration-clients")).status).toBe(401);
  });
});

describe("creating a client", () => {
  test("shows the token once, and it works at once", async () => {
    const response = await create(manager, { name: `${tag} HRIS` });
    expect(response.status).toBe(201);
    const created = (await response.json()) as Created;

    expect(created.token.startsWith(created.tokenPrefix)).toBe(true);
    expect(created.scopes).toEqual(["employees:read"]);

    const read = await send("GET", "/integrations/employees?limit=1", {
      authorization: `Bearer ${created.token}`,
    });
    expect(read.status).toBe(200);
  });

  test("the list never carries the token or its hash", async () => {
    const created = (await (await create(manager)).json()) as Created;

    const response = await send("GET", "/integration-clients", as(manager));
    const raw = await response.text();
    const list = JSON.parse(raw) as Client[];

    expect(list.some((c) => c.id === created.id)).toBe(true);
    expect(raw).not.toContain(created.token);
    expect(raw).not.toContain("tokenHash");
    expect(raw).not.toContain("token_hash");
  });

  test("a live name is unique, whatever its case", async () => {
    const name = `${tag} Unik`;
    expect((await create(manager, { name })).status).toBe(201);
    const again = await create(manager, { name: name.toUpperCase() });
    expect(again.status).toBe(409);
  });

  test("an unknown scope is refused", async () => {
    const response = await create(manager, { scopes: ["roster:write"] });
    expect(response.status).toBe(422);
  });

  test("no scope at all is refused", async () => {
    const response = await create(manager, { scopes: [] });
    expect(response.status).toBe(422);
  });

  test("an allowed address must be an address", async () => {
    const response = await create(manager, { allowedIps: ["server-hris"] });
    expect(response.status).toBe(422);
  });

  test("the token response is never cached", async () => {
    const response = await create(manager);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("an IPv6 address is kept in one spelling", async () => {
    const response = await create(manager, {
      allowedIps: ["0:0:0:0:0:0:0:1", "::1"],
    });
    const created = (await response.json()) as Created;
    expect(created.allowedIps).toEqual(["::1"]);
  });

  test("allowed addresses are kept, without repeats", async () => {
    const response = await create(manager, {
      allowedIps: ["192.168.151.40", " 192.168.151.40 ", "192.168.151.41"],
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as Created;
    expect(created.allowedIps).toEqual(["192.168.151.40", "192.168.151.41"]);
  });
});

/** Site dates, as the API stores and compares them. */
const today = () => localDate(new Date());
const dayOffset = (days: number) =>
  localDate(new Date(Date.now() + days * 86_400_000));

const readWith = (token: string) =>
  send("GET", "/integrations/employees?limit=1", {
    authorization: `Bearer ${token}`,
  });

const setValidity = (
  id: string,
  cookie: string,
  body: { validFrom: string; validUntil: string | null }
) => send("POST", `/integration-clients/${id}/validity`, as(cookie), body);

describe("validity dates", () => {
  test("without dates a token starts today and never expires", async () => {
    const created = (await (await create(manager)).json()) as Created;
    expect(created.validFrom).toBe(today());
    expect(created.validUntil).toBeNull();
  });

  test("a chosen range is kept as given", async () => {
    const created = (await (
      await create(manager, {
        validFrom: dayOffset(2),
        validUntil: dayOffset(30),
      })
    ).json()) as Created;
    expect(created.validFrom).toBe(dayOffset(2));
    expect(created.validUntil).toBe(dayOffset(30));
  });

  test("an end before the start is refused", async () => {
    const response = await create(manager, {
      validFrom: dayOffset(10),
      validUntil: dayOffset(5),
    });
    expect(response.status).toBe(422);
  });

  test("an end already past is refused", async () => {
    const response = await create(manager, {
      validFrom: dayOffset(-30),
      validUntil: dayOffset(-1),
    });
    expect(response.status).toBe(422);
  });

  test("a date that is not a date is refused", async () => {
    const response = await create(manager, { validUntil: "31/12/2026" });
    expect(response.status).toBe(422);
  });

  test("a well-formed date that is no day of the calendar is refused", async () => {
    const response = await create(manager, { validUntil: "2027-02-31" });
    expect(response.status).toBe(422);
    expect(((await response.json()) as { code: string }).code).toBe(
      "invalid_date"
    );
  });

  test("changing the dates keeps the token", async () => {
    const created = (await (
      await create(manager, { validUntil: dayOffset(30) })
    ).json()) as Created;

    const response = await setValidity(created.id, manager, {
      validFrom: today(),
      validUntil: dayOffset(365),
    });
    expect(response.status).toBe(200);
    const row = (await response.json()) as Client;
    expect(row.validUntil).toBe(dayOffset(365));
    expect((await readWith(created.token)).status).toBe(200);
  });

  test("clearing the end makes it never expire", async () => {
    const created = (await (
      await create(manager, { validUntil: dayOffset(30) })
    ).json()) as Created;
    const row = (await (
      await setValidity(created.id, manager, {
        validFrom: today(),
        validUntil: null,
      })
    ).json()) as Client;
    expect(row.validUntil).toBeNull();
  });

  test("new dates bring an expired token back", async () => {
    const created = (await (await create(manager)).json()) as Created;
    await db
      .update(schema.integrationClients)
      .set({ validFrom: dayOffset(-30), validUntil: dayOffset(-1) })
      .where(eq(schema.integrationClients.id, created.id));
    expect((await readWith(created.token)).status).toBe(401);

    await setValidity(created.id, manager, {
      validFrom: today(),
      validUntil: dayOffset(90),
    });
    expect((await readWith(created.token)).status).toBe(200);
  });
});

describe("rotating a token", () => {
  test("hands out a new token once, and the old one stops at once", async () => {
    const created = (await (
      await create(manager, { allowedIps: ["192.168.151.40"] })
    ).json()) as Created;

    const response = await send(
      "POST",
      `/integration-clients/${created.id}/rotate`,
      as(manager),
      { validFrom: today(), validUntil: dayOffset(180) }
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const rotated = (await response.json()) as Created;

    expect(rotated.id).toBe(created.id);
    expect(rotated.token).not.toBe(created.token);
    expect(rotated.token.startsWith(rotated.tokenPrefix)).toBe(true);
    expect(rotated.allowedIps).toEqual(["192.168.151.40"]);
    expect(rotated.validUntil).toBe(dayOffset(180));

    // Restricted to one address the test cannot come from, so both are
    // refused — but differently: the old token is unknown, the new one is
    // known and only out of place.
    expect((await readWith(created.token)).status).toBe(401);
    expect((await readWith(rotated.token)).status).toBe(403);
  });

  test("a revoked client cannot be rotated or re-dated", async () => {
    const created = (await (await create(manager)).json()) as Created;
    await send(
      "POST",
      `/integration-clients/${created.id}/revoke`,
      as(manager)
    );

    for (const action of ["rotate", "validity"]) {
      const response = await send(
        "POST",
        `/integration-clients/${created.id}/${action}`,
        as(manager),
        { validFrom: today(), validUntil: dayOffset(90) }
      );
      expect(response.status).toBe(409);
    }
  });

  test("view may neither rotate nor re-date", async () => {
    const created = (await (await create(manager)).json()) as Created;
    for (const action of ["rotate", "validity"]) {
      const response = await send(
        "POST",
        `/integration-clients/${created.id}/${action}`,
        as(viewer),
        { validFrom: today(), validUntil: dayOffset(90) }
      );
      expect(response.status).toBe(403);
    }
  });
});

describe("revoking a client", () => {
  test("the token stops working on the next request", async () => {
    const created = (await (await create(manager)).json()) as Created;

    const revoked = await send(
      "POST",
      `/integration-clients/${created.id}/revoke`,
      as(manager)
    );
    expect(revoked.status).toBe(200);
    const row = (await revoked.json()) as Client;
    expect(row.revokedAt).not.toBeNull();
    expect(row.revokedByName).toBe(`${tag} admin`);

    const read = await send("GET", "/integrations/employees?limit=1", {
      authorization: `Bearer ${created.token}`,
    });
    expect(read.status).toBe(401);
  });

  test("its name is free again for a new client", async () => {
    const name = `${tag} Ganti`;
    const first = (await (await create(manager, { name })).json()) as Created;
    await send("POST", `/integration-clients/${first.id}/revoke`, as(manager));

    expect((await create(manager, { name })).status).toBe(201);
  });

  test("revoking twice is refused", async () => {
    const created = (await (await create(manager)).json()) as Created;
    const path = `/integration-clients/${created.id}/revoke`;
    await send("POST", path, as(manager));

    expect((await send("POST", path, as(manager))).status).toBe(409);
  });

  test("an unknown client is 404", async () => {
    const response = await send(
      "POST",
      `/integration-clients/${crypto.randomUUID()}/revoke`,
      as(manager)
    );
    expect(response.status).toBe(404);
  });

  test("view may not revoke", async () => {
    const created = (await (await create(manager)).json()) as Created;
    const response = await send(
      "POST",
      `/integration-clients/${created.id}/revoke`,
      as(viewer)
    );
    expect(response.status).toBe(403);
  });
});
