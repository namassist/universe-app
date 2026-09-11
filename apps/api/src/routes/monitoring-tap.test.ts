/**
 * The raw tap monitor: what it counts, and where a day ends.
 *
 * Two things here are easy to get wrong and expensive when they are. A day
 * boundary that excludes 23:59 loses the end of a night muster. And a headline
 * counted over the page rather than the day makes the morning look quieter
 * every time somebody types in the search box — which is exactly when they are
 * trying to work out how busy it was.
 *
 * Needs the dev Postgres and Redis:
 *   bun --env-file=.env test src/routes/monitoring-tap.test.ts
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
import { eq, inArray } from "drizzle-orm";

import { createSession, SESSION_COOKIE } from "../auth/session";
import { db, schema } from "../db";
import { redis } from "../redis";
import { monitoringTapRoutes } from "./monitoring-tap";

const app = new Elysia().use(monitoringTapRoutes);

const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ TapMon ${uid()}`;
const IP = "10.77.77.7";
const DATE = "1999-04-04";

const made = { users: [] as string[], roles: [] as string[] };
let watcher = "";
let outsider = "";

async function account(granted: boolean) {
  const [role] = await db
    .insert(schema.roles)
    .values({ slug: `zz-tapmon-${uid()}`, name: tag, scope: "all" })
    .returning({ id: schema.roles.id });
  made.roles.push(role!.id);
  if (granted)
    await db
      .insert(schema.rolePermissions)
      .values({ roleId: role!.id, menuSlug: "monitoring-tap", mode: "view" });
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `zz-tapmon-${uid()}@uji.local`,
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

const addTap = (nik: string, at: string) =>
  db
    .insert(schema.deviceTaps)
    .values({ ip: IP, nik, at, direction: "in", verified: 1 })
    .onConflictDoNothing();

const list = async (cookie: string, query = `date=${DATE}`) => {
  const response = await app.handle(
    new Request(`http://localhost/monitoring-tap?${query}`, {
      headers: { cookie },
    })
  );
  return { status: response.status, body: await response.json() };
};

beforeAll(async () => {
  if (redis.status === "end") await redis.connect();
  watcher = await account(true);
  outsider = await account(false);
});

beforeEach(async () => {
  await db.delete(schema.deviceTaps).where(eq(schema.deviceTaps.ip, IP));
});

afterAll(async () => {
  await db.delete(schema.deviceTaps).where(eq(schema.deviceTaps.ip, IP));
  if (made.users.length)
    await db.delete(schema.users).where(inArray(schema.users.id, made.users));
  if (made.roles.length)
    await db.delete(schema.roles).where(inArray(schema.roles.id, made.roles));
});

describe("where a day begins and ends", () => {
  test("the first and last second of it are both in", async () => {
    await addTap("111", `${DATE} 00:00:00`);
    await addTap("222", `${DATE} 23:59:59`);

    const { body } = await list(watcher);

    expect((body as { taps: number }).taps).toBe(2);
  });

  test("the next day's first second is not", async () => {
    await addTap("333", "1999-04-05 00:00:00");

    const { body } = await list(watcher);

    expect((body as { taps: number }).taps).toBe(0);
  });
});

describe("what the headline counts", () => {
  /* Counted over the day, not the page. A search narrows the rows a person is
     reading; it must not appear to change how busy the morning was. */
  test("searching narrows the rows but not the totals", async () => {
    await addTap("444", `${DATE} 04:10:00`);
    await addTap("555", `${DATE} 04:11:00`);

    const all = await list(watcher);
    const found = await list(watcher, `date=${DATE}&q=444`);

    expect((all.body as { rows: unknown[] }).rows).toHaveLength(2);
    expect((found.body as { rows: unknown[] }).rows).toHaveLength(1);
    expect((found.body as { taps: number }).taps).toBe(2);
  });

  test("people and machines are counted distinctly", async () => {
    await addTap("666", `${DATE} 04:10:00`);
    await addTap("666", `${DATE} 04:12:00`);

    const { body } = await list(watcher);
    const b = body as { taps: number; people: number; machines: number };

    /* Two taps, one person, one machine — which is the duplicate this screen
       exists to make visible. */
    expect(b.taps).toBe(2);
    expect(b.people).toBe(1);
    expect(b.machines).toBe(1);
  });
});

describe("who may look", () => {
  test("an account without the menu is refused", async () => {
    expect((await list(outsider)).status).toBe(403);
  });
});
