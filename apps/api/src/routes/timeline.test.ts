/**
 * The allocation schedule — CRUD, and the column that makes a night half
 * possible.
 *
 * The route had no tests at all before the schedule grew a second shift. What
 * is pinned here is mostly what `shift` must do: survive a round trip, be
 * absent rather than invented when the caller says nothing, and be clearable
 * without being confused with "unchanged".
 *
 * Needs the dev Postgres and Redis:
 *   bun --env-file=.env test src/routes/timeline.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { inArray } from "drizzle-orm";

import { createSession, SESSION_COOKIE } from "../auth/session";
import { db, schema } from "../db";
import { redis } from "../redis";
import { timelineRoutes } from "./timeline";

const app = new Elysia().use(timelineRoutes);

const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ Uji Tahap ${uid()}`;

const made = {
  users: [] as string[],
  roles: [] as string[],
  stages: [] as string[],
};

let admin: { cookie: string };
let viewer: { cookie: string };

type Stage = {
  id: string;
  name: string;
  at: string;
  action: string;
  shift: "day" | "night" | null;
  active: boolean;
  createdAt: string;
};

async function makeUser(mode: "view" | "manage") {
  const [role] = await db
    .insert(schema.roles)
    .values({ slug: `zz-timeline-${uid()}`, name: tag, scope: "all" })
    .returning({ id: schema.roles.id });
  made.roles.push(role!.id);
  await db
    .insert(schema.rolePermissions)
    .values([{ roleId: role!.id, menuSlug: "timeline", mode }]);
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

async function create(body: Record<string, unknown>, cookie = admin.cookie) {
  const response = await send("POST", "/timeline", cookie, {
    name: `${tag} ${uid()}`,
    at: "04:45",
    action: "other",
    ...body,
  });
  if (response.status === 201) {
    const row = (await response.clone().json()) as Stage;
    made.stages.push(row.id);
  }
  return response;
}

beforeAll(async () => {
  // scheduler.test.ts disconnects the shared client in its teardown, and bun
  // runs every file in one process.
  if (redis.status === "end") await redis.connect();
  admin = await makeUser("manage");
  viewer = await makeUser("view");
});

afterAll(async () => {
  if (made.stages.length)
    await db
      .delete(schema.timelineStages)
      .where(inArray(schema.timelineStages.id, made.stages));
  if (made.users.length)
    await db.delete(schema.users).where(inArray(schema.users.id, made.users));
  if (made.roles.length)
    await db.delete(schema.roles).where(inArray(schema.roles.id, made.roles));
});

/* ------------------------------------------------------------------ CRUD */

describe("schedule CRUD", () => {
  test("creates a stage and reads it back on the list", async () => {
    const response = await create({
      at: "17:15",
      action: "finger-in",
      shift: "night",
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as Stage;
    expect(created.at).toBe("17:15");

    const list = (await (
      await send("GET", "/timeline", admin.cookie)
    ).json()) as Stage[];
    expect(list.some((s) => s.id === created.id)).toBe(true);
  });

  test("refuses a name that is only whitespace", async () => {
    expect((await create({ name: "   " })).status).toBe(422);
  });

  test("refuses a time that is not a time", async () => {
    expect((await create({ at: "25:00" })).status).toBe(422);
  });

  test("refuses an action outside the vocabulary", async () => {
    expect((await create({ action: "bikin-kopi" })).status).toBe(422);
  });

  test("edits a stage's time", async () => {
    const created = (await (await create({ at: "05:15" })).json()) as Stage;
    const response = await send(
      "PATCH",
      `/timeline/${created.id}`,
      admin.cookie,
      {
        at: "05:20",
      }
    );
    expect(response.status).toBe(200);
    expect(((await response.json()) as Stage).at).toBe("05:20");
  });

  test("deletes a stage, and says so only once", async () => {
    const created = (await (await create({})).json()) as Stage;
    expect(
      (await send("DELETE", `/timeline/${created.id}`, admin.cookie)).status
    ).toBe(200);
    expect(
      (await send("DELETE", `/timeline/${created.id}`, admin.cookie)).status
    ).toBe(404);
  });
});

/* ----------------------------------------------------------------- shift */

describe("the shift a stage governs", () => {
  test("round-trips day and night", async () => {
    for (const shift of ["day", "night"] as const) {
      const created = (await (await create({ shift })).json()) as Stage;
      expect(created.shift).toBe(shift);
    }
  });

  test("is null when the caller says nothing — never invented", async () => {
    // The whole reason `action` is required on this route: an optional enum
    // injects its first value. `shift` is optional, so it must prove it does
    // not quietly become "day".
    const created = (await (await create({})).json()) as Stage;
    expect(created.shift).toBeNull();
  });

  test("refuses a shift outside the vocabulary", async () => {
    expect((await create({ shift: "sore" })).status).toBe(422);
  });

  test("an edit that omits shift leaves it alone", async () => {
    const created = (await (await create({ shift: "night" })).json()) as Stage;
    const patched = (await (
      await send("PATCH", `/timeline/${created.id}`, admin.cookie, {
        at: "18:00",
      })
    ).json()) as Stage;
    expect(patched.shift).toBe("night");
  });

  test("an explicit null clears it — distinct from omitting it", async () => {
    const created = (await (await create({ shift: "night" })).json()) as Stage;
    const patched = (await (
      await send("PATCH", `/timeline/${created.id}`, admin.cookie, {
        shift: null,
      })
    ).json()) as Stage;
    expect(patched.shift).toBeNull();
  });

  test("two stages carry the same action at different times", async () => {
    // The point of the column: the night's finger-in deadline is the same kind
    // of thing as the day's, and telling them apart must not mean comparing
    // clocks.
    const day = (await (
      await create({ at: "05:15", action: "finger-in", shift: "day" })
    ).json()) as Stage;
    const night = (await (
      await create({ at: "17:15", action: "finger-in", shift: "night" })
    ).json()) as Stage;
    expect(day.action).toBe(night.action);
    expect(day.shift).not.toBe(night.shift);
  });
});

/* ------------------------------------------------------------------ auth */

describe("who may edit the schedule", () => {
  test("refuses an anonymous caller", async () => {
    expect((await send("GET", "/timeline")).status).toBe(401);
  });

  test("a view grant reads but does not write", async () => {
    expect((await send("GET", "/timeline", viewer.cookie)).status).toBe(200);
    expect((await create({}, viewer.cookie)).status).toBe(403);
  });
});
