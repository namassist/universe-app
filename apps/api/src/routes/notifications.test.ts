/**
 * Notifications: whose read marks are whose, and what a failure is allowed to
 * say.
 *
 * Two things worth pinning. A notification is one site-wide row read by
 * several people, so marking it read must be a fact about the reader and not
 * about the row — two accounts looking at one event must not silently mark it
 * for each other. And a failed board reports a *reason code*, never the
 * thrown error's own text: that text routinely carries a connection string,
 * and this table persists and is read again later by anyone with the menu.
 *
 * Needs the dev Postgres and Redis:
 *   bun --env-file=.env test src/routes/notifications.test.ts
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { Elysia } from "elysia";
import { inArray } from "drizzle-orm";

import { createSession, SESSION_COOKIE } from "../auth/session";
import { db, schema } from "../db";
import { notify } from "../notify";
import { redis } from "../redis";
import { notificationRoutes } from "./notifications";

const app = new Elysia().use(notificationRoutes);

const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ Notif ${uid()}`;

const made = { users: [] as string[], roles: [] as string[] };
let alice = "";
let bob = "";
let outsider = "";

/** Rows this file wrote, so a shared dev database keeps its own history. */
let mine: string[] = [];

async function account(mode: "manage" | null): Promise<string> {
  const [role] = await db
    .insert(schema.roles)
    .values({ slug: `zz-notif-${uid()}`, name: tag, scope: "all" })
    .returning({ id: schema.roles.id });
  made.roles.push(role!.id);
  if (mode)
    await db
      .insert(schema.rolePermissions)
      .values({ roleId: role!.id, menuSlug: "notifications", mode });
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `zz-notif-${uid()}@uji.local`,
      name: tag,
      passwordHash: "x",
      roleId: role!.id,
      mustChangePassword: false,
    })
    .returning({ id: schema.users.id });
  made.users.push(user!.id);
  const session = await createSession("user", user!.id, "cookie");
  return `${SESSION_COOKIE}=${session.id}`;
}

const list = async (cookie: string) => {
  const response = await app.handle(
    new Request("http://localhost/notifications", { headers: { cookie } })
  );
  return { status: response.status, body: await response.json() };
};

const readOne = (cookie: string, id: string) =>
  app.handle(
    new Request(`http://localhost/notifications/${id}/read`, {
      method: "POST",
      headers: { cookie },
    })
  );

const readAll = (cookie: string) =>
  app.handle(
    new Request("http://localhost/notifications/read-all", {
      method: "POST",
      headers: { cookie },
    })
  );

/** This file's rows only — the dev database has whatever else it has. */
const ours = (body: unknown) =>
  (body as { id: string }[]).filter((n) => mine.includes(n.id));

beforeAll(async () => {
  if (redis.status === "end") await redis.connect();
  alice = await account("manage");
  bob = await account("manage");
  outsider = await account(null);
});

beforeEach(async () => {
  if (mine.length)
    await db
      .delete(schema.notifications)
      .where(inArray(schema.notifications.id, mine));
  mine = [];
});

afterAll(async () => {
  if (mine.length)
    await db
      .delete(schema.notifications)
      .where(inArray(schema.notifications.id, mine));
  if (made.users.length)
    await db.delete(schema.users).where(inArray(schema.users.id, made.users));
  if (made.roles.length)
    await db.delete(schema.roles).where(inArray(schema.roles.id, made.roles));
  await redis.quit();
});

/** Writes one and remembers it, so the assertions can ignore the neighbours. */
async function write(
  kind: "allocation-generated" | "allocation-failed",
  params: Record<string, unknown>
): Promise<string> {
  const before = await db
    .select({ id: schema.notifications.id })
    .from(schema.notifications);
  await notify(
    kind,
    kind === "allocation-failed" ? "danger" : "success",
    params
  );
  const after = await db
    .select({ id: schema.notifications.id })
    .from(schema.notifications);
  const seen = new Set(before.map((r) => r.id));
  const fresh = after.find((r) => !seen.has(r.id))!;
  mine.push(fresh.id);
  return fresh.id;
}

describe("what a notification carries", () => {
  test("a generated board reports its counts", async () => {
    const id = await write("allocation-generated", {
      date: "2026-09-10",
      shift: "day",
      crewed: 71,
      units: 75,
      spares: 4,
    });

    const { body } = await list(alice);
    const row = ours(body).find((n) => n.id === id) as unknown as {
      kind: string;
      tone: string;
      params: Record<string, unknown>;
      read: boolean;
    };
    expect(row.kind).toBe("allocation-generated");
    expect(row.params.crewed).toBe(71);
    expect(row.read).toBe(false);
  });

  /* The point of the closed list. A thrown error's message is not stored at
     all, so there is nothing here for a connection string to ride in on. */
  test("a failure carries a reason code and no free text", async () => {
    const id = await write("allocation-failed", {
      date: "2026-09-10",
      shift: "night",
      reason: "no-ftw-deadline",
    });

    const { body } = await list(alice);
    const row = ours(body).find((n) => n.id === id) as unknown as {
      params: Record<string, unknown>;
    };
    expect(row.params.reason).toBe("no-ftw-deadline");
    expect(Object.keys(row.params).sort()).toEqual(["date", "reason", "shift"]);
  });
});

describe("read marks belong to the reader", () => {
  test("what one account reads, another still has unread", async () => {
    const id = await write("allocation-generated", {
      date: "2026-09-10",
      shift: "day",
      crewed: 1,
      units: 1,
      spares: 0,
    });

    expect((await readOne(alice, id)).status).toBe(200);

    const seenByAlice = ours((await list(alice)).body).find(
      (n) => n.id === id
    ) as unknown as { read: boolean };
    const seenByBob = ours((await list(bob)).body).find(
      (n) => n.id === id
    ) as unknown as { read: boolean };
    expect(seenByAlice.read).toBe(true);
    expect(seenByBob.read).toBe(false);
  });

  test("marking the same one twice is not an error", async () => {
    const id = await write("allocation-failed", {
      date: "2026-09-10",
      shift: "day",
      reason: "unexpected",
    });

    expect((await readOne(alice, id)).status).toBe(200);
    expect((await readOne(alice, id)).status).toBe(200);
  });

  test("read-all leaves the other account's list alone", async () => {
    await write("allocation-generated", {
      date: "2026-09-10",
      shift: "day",
      crewed: 1,
      units: 1,
      spares: 0,
    });
    await write("allocation-failed", {
      date: "2026-09-10",
      shift: "night",
      reason: "no-shift",
    });

    expect((await readAll(alice)).status).toBe(200);

    expect(
      ours((await list(alice)).body).every(
        (n) => (n as unknown as { read: boolean }).read
      )
    ).toBe(true);
    expect(
      ours((await list(bob)).body).some(
        (n) => !(n as unknown as { read: boolean }).read
      )
    ).toBe(true);
  });

  test("a notification that does not exist cannot be marked", async () => {
    const response = await readOne(alice, crypto.randomUUID());
    expect(response.status).toBe(404);
  });
});

describe("the menu grant is the gate", () => {
  test("an account without it is refused the list", async () => {
    expect((await list(outsider)).status).toBe(403);
  });

  test("and refused the writes", async () => {
    expect((await readAll(outsider)).status).toBe(403);
  });
});
