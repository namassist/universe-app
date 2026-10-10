/**
 * The fingerprint machine registry — CRUD, and the two refusals that matter:
 * an address that is not an address, and an address already claimed.
 *
 * Needs the dev Postgres and Redis:
 *   bun --env-file=.env test src/routes/fingerprint-machines.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { eq, inArray } from "drizzle-orm";

import { createSession, SESSION_COOKIE } from "../auth/session";
import { db, schema } from "../db";
import { redis } from "../redis";
import { fingerprintMachineRoutes } from "./fingerprint-machines";

const app = new Elysia().use(fingerprintMachineRoutes);

const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ Uji Mesin ${uid()}`;

/** Documentation range (TEST-NET-3) — never a real machine on site. */
const ipOf = (last: number) => `203.0.113.${last}`;

const made = {
  users: [] as string[],
  roles: [] as string[],
  machines: [] as string[],
  printers: [] as string[],
};

/** A printer row straight in the table: pairing is what is under test here,
    not the printer registry, which has its own suite. */
async function makePrinter(last: number) {
  const [row] = await db
    .insert(schema.printers)
    .values({ name: `${tag} PRINTER ${last}`, ip: ipOf(last) })
    .returning({ id: schema.printers.id });
  made.printers.push(row!.id);
  return row!.id;
}

let admin: { cookie: string };
let viewer: { cookie: string };
/** Holds `monitoring-fingerprint` — the menu that governs the TV. */
let tvViewer: { cookie: string };

type Machine = {
  id: string;
  name: string;
  ip: string;
  active: boolean;
  printerId: string | null;
  createdAt: string;
};

async function makeUser(
  mode: "view" | "manage",
  menuSlug: "mesin-fingerprint" | "monitoring-fingerprint" = "mesin-fingerprint"
) {
  const [role] = await db
    .insert(schema.roles)
    .values({ slug: `zz-mesin-${uid()}`, name: tag, scope: "all" })
    .returning({ id: schema.roles.id });
  made.roles.push(role!.id);
  await db
    .insert(schema.rolePermissions)
    .values([{ roleId: role!.id, menuSlug, mode }]);
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
  return { cookie: `${SESSION_COOKIE}=${session.id}` };
}

const send = (method: string, path: string, cookie?: string, body?: unknown) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  );

/** Create through the API and remember the row for teardown. */
async function create(
  body: { name: string; ip: string; active?: boolean },
  cookie = admin.cookie
) {
  const response = await send("POST", "/fingerprint-machines", cookie, body);
  if (response.status === 201) {
    const row = (await response.clone().json()) as Machine;
    made.machines.push(row.id);
  }
  return response;
}

beforeAll(async () => {
  // scheduler.test.ts disconnects the shared client in its teardown, and bun
  // runs every file in one process.
  if (redis.status === "end") await redis.connect();

  admin = await makeUser("manage");
  viewer = await makeUser("view");
  tvViewer = await makeUser("view", "monitoring-fingerprint");
});

afterAll(async () => {
  if (made.machines.length)
    await db
      .delete(schema.fingerprintMachines)
      .where(inArray(schema.fingerprintMachines.id, made.machines));
  if (made.printers.length)
    await db
      .delete(schema.printers)
      .where(inArray(schema.printers.id, made.printers));
  if (made.users.length)
    await db.delete(schema.users).where(inArray(schema.users.id, made.users));
  if (made.roles.length)
    await db.delete(schema.roles).where(inArray(schema.roles.id, made.roles));
});

/* ------------------------------------------------------------------ CRUD */

describe("registry CRUD", () => {
  test("creates a machine and lists it back", async () => {
    const ip = ipOf(11);
    const created = await create({ name: `${tag} SATU`, ip });
    expect(created.status).toBe(201);

    const row = (await created.json()) as Machine;
    expect(row.name).toBe(`${tag} SATU`);
    expect(row.ip).toBe(ip);
    expect(row.active).toBe(true);

    const listed = await send("GET", "/fingerprint-machines", viewer.cookie);
    expect(listed.status).toBe(200);
    const rows = (await listed.json()) as Machine[];
    expect(rows.find((r) => r.ip === ip)?.name).toBe(`${tag} SATU`);
  });

  test("trims a padded name and address", async () => {
    const created = await create({
      name: `   ${tag} SPASI   `,
      ip: `  ${ipOf(12)}  `,
    });
    expect(created.status).toBe(201);
    const row = (await created.json()) as Machine;
    expect(row.name).toBe(`${tag} SPASI`);
    expect(row.ip).toBe(ipOf(12));
  });

  test("renames and deactivates through PATCH", async () => {
    const created = await create({ name: `${tag} EDIT`, ip: ipOf(13) });
    const row = (await created.json()) as Machine;

    const patched = await send(
      "PATCH",
      `/fingerprint-machines/${row.id}`,
      admin.cookie,
      { name: `${tag} EDITED`, active: false }
    );
    expect(patched.status).toBe(200);
    const updated = (await patched.json()) as Machine;
    expect(updated.name).toBe(`${tag} EDITED`);
    expect(updated.active).toBe(false);
    // Untouched fields survive a partial update.
    expect(updated.ip).toBe(ipOf(13));
  });

  test("deletes once, then reports the row gone", async () => {
    const created = await create({ name: `${tag} HAPUS`, ip: ipOf(14) });
    const row = (await created.json()) as Machine;

    const first = await send(
      "DELETE",
      `/fingerprint-machines/${row.id}`,
      admin.cookie
    );
    expect(first.status).toBe(200);

    const second = await send(
      "DELETE",
      `/fingerprint-machines/${row.id}`,
      admin.cookie
    );
    expect(second.status).toBe(404);
  });

  test("404s a PATCH against an id that does not exist", async () => {
    const response = await send(
      "PATCH",
      `/fingerprint-machines/${crypto.randomUUID()}`,
      admin.cookie,
      { name: `${tag} HANTU` }
    );
    expect(response.status).toBe(404);
  });
});

/* ------------------------------------------------------------- the address */

describe("the address", () => {
  test("refuses a second machine on one address", async () => {
    const ip = ipOf(21);
    expect((await create({ name: `${tag} ASLI`, ip })).status).toBe(201);

    // The point of the unique constraint: one address is one machine, so a
    // duplicate is a conflict rather than a second card on the wall.
    const duplicate = await create({ name: `${tag} KEMBAR`, ip });
    expect(duplicate.status).toBe(409);
  });

  test("refuses a PATCH that would move a machine onto a taken address", async () => {
    const held = ipOf(22);
    await create({ name: `${tag} PEMILIK`, ip: held });
    const other = await create({ name: `${tag} PINDAH`, ip: ipOf(23) });
    const row = (await other.json()) as Machine;

    const response = await send(
      "PATCH",
      `/fingerprint-machines/${row.id}`,
      admin.cookie,
      { ip: held }
    );
    expect(response.status).toBe(409);
  });

  test.each([
    ["missing an octet", "192.168.1"],
    ["an octet out of range", "192.168.1.256"],
    ["not numeric at all", "mesin-gerbang"],
    ["a range rather than a host", "192.168.1.0/24"],
    ["empty", ""],
  ])("refuses %s", async (_label, ip) => {
    const response = await create({ name: `${tag} SALAH`, ip });
    expect(response.status).toBe(422);
  });

  test("refuses an empty name", async () => {
    const response = await create({ name: "   ", ip: ipOf(24) });
    expect(response.status).toBe(422);
  });
});

/* --------------------------------------------------------------- the guard */

describe("the kiosk endpoint", () => {
  test("serves totals and machines to a user with the TV grant", async () => {
    await create({ name: `${tag} LAYAR`, ip: ipOf(41) });

    const response = await send(
      "GET",
      "/fingerprint-machines/display",
      tvViewer.cookie
    );
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      total: number;
      online: number;
      offline: number;
      machines: Machine[];
      servedAt: string;
    };
    expect(body.total).toBe(body.online + body.offline);
    expect(body.machines.length).toBe(body.total);
    expect(body.servedAt).toBeTruthy();
  });

  test("offline machines sort first — the wall exists to surface them", async () => {
    const down = await create({ name: `${tag} MATI`, ip: ipOf(42) });
    const downRow = (await down.json()) as Machine;
    const up = await create({ name: `${tag} HIDUP`, ip: ipOf(43) });
    const upRow = (await up.json()) as Machine;

    // Stand in for the prober: one reachable, one not.
    await db
      .update(schema.fingerprintMachines)
      .set({ online: true, checkedAt: new Date() })
      .where(eq(schema.fingerprintMachines.id, upRow.id));
    await db
      .update(schema.fingerprintMachines)
      .set({ online: false, checkedAt: new Date() })
      .where(eq(schema.fingerprintMachines.id, downRow.id));

    const response = await send(
      "GET",
      "/fingerprint-machines/display",
      tvViewer.cookie
    );
    const body = (await response.json()) as { machines: Machine[] };
    const downAt = body.machines.findIndex((m) => m.id === downRow.id);
    const upAt = body.machines.findIndex((m) => m.id === upRow.id);
    expect(downAt).toBeLessThan(upAt);
  });

  test("refuses an anonymous caller", async () => {
    expect((await send("GET", "/fingerprint-machines/display")).status).toBe(
      401
    );
  });

  test("refuses a caller holding only the registry grant", async () => {
    // The TV is governed by `monitoring-fingerprint`; managing machines is a
    // different grant, and holding one must not imply the other.
    const response = await send(
      "GET",
      "/fingerprint-machines/display",
      admin.cookie
    );
    expect(response.status).toBe(403);
  });
});

describe("authorization", () => {
  test("refuses an anonymous caller", async () => {
    expect((await send("GET", "/fingerprint-machines")).status).toBe(401);
  });

  test("a view grant reads but cannot write", async () => {
    expect(
      (await send("GET", "/fingerprint-machines", viewer.cookie)).status
    ).toBe(200);

    const created = await create(
      { name: `${tag} TOLAK`, ip: ipOf(31) },
      viewer.cookie
    );
    expect(created.status).toBe(403);
  });
});

/* --------------------------------------------------------------- pairing */

describe("a booth and its printer", () => {
  test("pairs a printer, and reports it back", async () => {
    const printerId = await makePrinter(81);
    const created = await create({ name: `${tag} PASANG`, ip: ipOf(31) });
    const row = (await created.json()) as Machine;
    expect(row.printerId).toBeNull();

    const patched = await send(
      "PATCH",
      `/fingerprint-machines/${row.id}`,
      admin.cookie,
      { printerId }
    );
    expect(patched.status).toBe(200);
    const paired = (await patched.json()) as Machine;
    expect(paired.printerId).toBe(printerId);
  });

  /* "Active" is the only switch now: the booth and Universe-only flags are
     gone from the row, so nothing can read them back and act on them. */
  test("a machine carries no flag besides active", async () => {
    const created = await create({ name: `${tag} SATU`, ip: ipOf(35) });
    const row = (await created.json()) as Record<string, unknown>;
    expect(row.active).toBe(true);
    expect(row).not.toHaveProperty("operatorBooth");
    expect(row).not.toHaveProperty("universeOnly");
  });

  /*
   * The ticket names the printer it came out of. Two booths sharing one would
   * put a second person's unit in the first person's hand, which is why the
   * column is unique and this is a 409 rather than a silent second pairing.
   */
  test("a printer already paired cannot be claimed again", async () => {
    const printerId = await makePrinter(82);
    const first = (await (
      await create({ name: `${tag} P1`, ip: ipOf(32) })
    ).json()) as Machine;
    const second = (await (
      await create({ name: `${tag} P2`, ip: ipOf(33) })
    ).json()) as Machine;

    expect(
      (
        await send("PATCH", `/fingerprint-machines/${first.id}`, admin.cookie, {
          printerId,
        })
      ).status
    ).toBe(200);

    const clash = await send(
      "PATCH",
      `/fingerprint-machines/${second.id}`,
      admin.cookie,
      { printerId }
    );
    expect(clash.status).toBe(409);
    expect(((await clash.json()) as { code: string }).code).toBe(
      "printer_taken"
    );
  });

  test("a machine can be created already paired, and unpaired later", async () => {
    const printerId = await makePrinter(83);
    const created = await send("POST", "/fingerprint-machines", admin.cookie, {
      name: `${tag} LANGSUNG`,
      ip: ipOf(34),
      printerId,
    });
    expect(created.status).toBe(201);
    const row = (await created.json()) as Machine;
    made.machines.push(row.id);
    expect(row.printerId).toBe(printerId);

    const cleared = await send(
      "PATCH",
      `/fingerprint-machines/${row.id}`,
      admin.cookie,
      { printerId: null }
    );
    expect(((await cleared.json()) as Machine).printerId).toBeNull();
  });
});

/* ------------------------------------------------------------- selection */

describe("bulk actions on a selection", () => {
  async function three(base: number) {
    const ids: string[] = [];
    for (const n of [0, 1, 2]) {
      const response = await create({
        name: `${tag} MASSAL ${base + n}`,
        ip: ipOf(base + n),
      });
      ids.push(((await response.json()) as Machine).id);
    }
    return ids;
  }

  const read = (id: string) =>
    db
      .select()
      .from(schema.fingerprintMachines)
      .where(eq(schema.fingerprintMachines.id, id));

  test("deactivates and reactivates exactly the ticked machines", async () => {
    const [a, b, c] = await three(140);

    const off = await send(
      "POST",
      "/fingerprint-machines/bulk-active",
      admin.cookie,
      { ids: [a, b], active: false }
    );
    expect(off.status).toBe(200);
    expect(((await off.json()) as { updated: number }).updated).toBe(2);
    expect((await read(a!))[0]!.active).toBe(false);
    expect((await read(b!))[0]!.active).toBe(false);
    expect((await read(c!))[0]!.active).toBe(true);

    const on = await send(
      "POST",
      "/fingerprint-machines/bulk-active",
      admin.cookie,
      { ids: [a], active: true }
    );
    expect(((await on.json()) as { updated: number }).updated).toBe(1);
    expect((await read(a!))[0]!.active).toBe(true);
  });

  test("deletes exactly the ticked machines", async () => {
    const [a, b, c] = await three(150);
    const response = await send(
      "POST",
      "/fingerprint-machines/bulk-delete",
      admin.cookie,
      { ids: [a, b, a] }
    );
    expect(response.status).toBe(200);
    expect(((await response.json()) as { deleted: number }).deleted).toBe(2);
    expect(await read(a!)).toHaveLength(0);
    expect(await read(b!)).toHaveLength(0);
    expect(await read(c!)).toHaveLength(1);
  });

  test("an empty selection is refused", async () => {
    const response = await send(
      "POST",
      "/fingerprint-machines/bulk-delete",
      admin.cookie,
      { ids: [] }
    );
    expect(response.status).toBe(422);
  });

  test("a viewer cannot delete or toggle a selection", async () => {
    const [a] = await three(160);
    for (const [path, body] of [
      ["/fingerprint-machines/bulk-delete", { ids: [a] }],
      ["/fingerprint-machines/bulk-active", { ids: [a], active: false }],
    ] as const) {
      const response = await send("POST", path, viewer.cookie, body);
      expect(response.status).toBe(403);
    }
    expect((await read(a!))[0]!.active).toBe(true);
  });
});

/* -------------------------------------------------------------- netcheck */

describe("network check", () => {
  /** Loopback, so the check answers at once: no machine on site has it. */
  const loopback = () => `127.0.0.${2 + Math.floor(Math.random() * 250)}`;

  test("reports every check of a machine and its printer", async () => {
    const printerId = await makePrinter(170);
    const created = await send("POST", "/fingerprint-machines", admin.cookie, {
      name: `${tag} CEK`,
      ip: loopback(),
      printerId,
    });
    const row = (await created.json()) as Machine;
    made.machines.push(row.id);

    // A viewer may diagnose: the check changes nothing.
    const response = await send(
      "POST",
      `/fingerprint-machines/${row.id}/netcheck`,
      viewer.cookie
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      id: string;
      finger: Record<string, unknown>;
      printer: Record<string, unknown> | null;
    };
    expect(body.id).toBe(row.id);
    expect(body.finger).toMatchObject({ ip: row.ip, port: 80 });
    // Nothing listens on these loopback ports.
    expect(body.finger.zk).toBe("fail");
    expect(body.printer).toMatchObject({ ip: ipOf(170), port: 9100 });
  });

  test("an unknown machine is a 404", async () => {
    const response = await send(
      "POST",
      `/fingerprint-machines/${crypto.randomUUID()}/netcheck`,
      viewer.cookie
    );
    expect(response.status).toBe(404);
  });

  test("anonymous callers are refused", async () => {
    const response = await send(
      "POST",
      `/fingerprint-machines/${crypto.randomUUID()}/netcheck`
    );
    expect(response.status).toBe(401);
  });
});
