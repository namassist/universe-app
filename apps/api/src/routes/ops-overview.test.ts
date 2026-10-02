/**
 * The Operations Center's one read: infrastructure, today's muster, the
 * devices, request metrics, users and errors, in a single payload.
 *
 * Needs the dev Postgres and Redis (seeded timeline):
 *   bun --env-file=.env test src/routes/ops-overview.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { eq } from "drizzle-orm";

import { db, schema } from "../db";
import { flushOpsMetrics, forgetOpsTraffic, opsMetrics } from "../ops/metrics";
import { recordStageRun } from "../ops/stage-log";
import { redis } from "../redis";
import { localDate } from "../scheduler";
import { OPS_COOKIE, opsRoutes } from "./ops";

const tag = `zz${crypto.randomUUID().slice(0, 6)}`;
const userId = crypto.randomUUID();
const PASSWORD = "ops-uji-overview-123";
const previousHash = process.env.OPS_PASSWORD_HASH;

const traffic = new Elysia({ prefix: `/v1/${tag}` })
  .macro({
    asUser(enabled: boolean) {
      return {
        resolve: () =>
          enabled
            ? {
                principal: {
                  kind: "user" as const,
                  id: userId,
                  name: "Uji Overview",
                  nik: "990002",
                  roleName: "Admin",
                },
              }
            : {},
      };
    },
  })
  .get("/hello", () => "hi", { asUser: true });

const app = new Elysia()
  .use(opsMetrics())
  .use(new Elysia({ prefix: "/v1" }).use(opsRoutes))
  .use(traffic);

const send = (path: string, cookie?: string, init: RequestInit = {}) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      ...init,
      headers: { ...(cookie ? { cookie } : {}), ...(init.headers ?? {}) },
    })
  );

let cookie = "";

type Overview = {
  date: string;
  checks: Record<string, unknown>;
  muster: {
    stages: {
      id: string;
      name: string;
      action: string;
      fired: boolean;
      lastRun: { ok: boolean; note: string } | null;
    }[];
    tickets: Record<string, number>;
  };
  devices: { machines: { total: number; online: number } };
  api: { perMinute: unknown[]; routes: { route: string; requests: number }[] };
  users: { userId: string; name: string; lastRoute: string }[];
  stageLog: { name: string }[];
};

beforeAll(async () => {
  if (redis.status === "end") await redis.connect();
  process.env.OPS_PASSWORD_HASH = await Bun.password.hash(PASSWORD);
  const login = await send("/v1/ops/session", undefined, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
  });
  const match = (login.headers.get("set-cookie") ?? "").match(
    new RegExp(`${OPS_COOKIE}=([^;]+)`)
  );
  cookie = `${OPS_COOKIE}=${match![1]}`;
});

afterAll(async () => {
  await forgetOpsTraffic();
  if (previousHash === undefined) delete process.env.OPS_PASSWORD_HASH;
  else process.env.OPS_PASSWORD_HASH = previousHash;
});

describe("the overview", () => {
  test("needs the ops session", async () => {
    expect((await send("/v1/ops/overview")).status).toBe(401);
  });

  test("reports the infrastructure checks", async () => {
    const response = await send("/v1/ops/overview", cookie);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Overview;
    expect(body.checks.database).toBe(true);
    expect(body.checks.cache).toBe(true);
    expect(body.date).toBe(localDate(new Date()));
  });

  test("lists today's stages, which have fired, and how their last run ended", async () => {
    const [stage] = await db
      .select()
      .from(schema.timelineStages)
      .where(eq(schema.timelineStages.active, true))
      .limit(1);
    const today = localDate(new Date());
    await redis.set(`stage:${stage!.id}:${today}`, "1", "EX", 60);
    await recordStageRun({
      date: today,
      stage: { ...stage!, name: `${stage!.name}` },
      note: `uji ${tag}`,
      ok: false,
    });

    const body = (await (
      await send("/v1/ops/overview", cookie)
    ).json()) as Overview;
    const listed = body.muster.stages.find((s) => s.id === stage!.id);
    expect(listed?.fired).toBe(true);
    expect(listed?.lastRun).toEqual(
      expect.objectContaining({ ok: false, note: `uji ${tag}` })
    );
    expect(body.stageLog.length).toBeGreaterThan(0);
    expect(typeof body.muster.tickets.failed).toBe("number");
    expect(body.devices.machines.total).toBeGreaterThanOrEqual(
      body.devices.machines.online
    );
    await redis.del(`stage:${stage!.id}:${today}`);
  });

  test("carries request metrics and who made them", async () => {
    await send(`/v1/${tag}/hello`);
    await flushOpsMetrics();

    const body = (await (
      await send("/v1/ops/overview", cookie)
    ).json()) as Overview;
    expect(body.api.perMinute.length).toBeGreaterThan(0);
    expect(
      body.api.routes.find((r) => r.route === `GET /v1/${tag}/hello`)?.requests
    ).toBe(1);
    expect(body.users.find((u) => u.userId === userId)?.lastRoute).toBe(
      `GET /v1/${tag}/hello`
    );
  });

  test("is not counted in the metrics it reports", async () => {
    await send("/v1/ops/overview", cookie);
    await flushOpsMetrics();
    const body = (await (
      await send("/v1/ops/overview", cookie)
    ).json()) as Overview;
    expect(body.api.routes.some((r) => r.route.includes("/ops/"))).toBe(false);
  });
});
