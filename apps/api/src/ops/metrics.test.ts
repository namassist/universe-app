/**
 * What every request leaves behind for the Operations Center: per-minute
 * counts and durations, per-route figures, slow requests, server errors, and
 * who was using the application.
 *
 * Needs the dev Redis:
 *   bun --env-file=.env test src/ops/metrics.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";

import { redis } from "../redis";
import { opsKey } from "./keys";
import {
  flushOpsMetrics,
  forgetOpsTraffic,
  opsMetrics,
  readOpsMetrics,
} from "./metrics";

const tag = `zz${crypto.randomUUID().slice(0, 6)}`;
const userId = crypto.randomUUID();
const previousProxy = process.env.TRUST_PROXY;

const routes = new Elysia({ prefix: `/v1/${tag}` })
  .macro({
    asUser(enabled: boolean) {
      return {
        resolve() {
          if (!enabled) return {};
          return {
            principal: {
              kind: "user" as const,
              id: userId,
              name: "Uji Ops",
              nik: "990001",
              roleName: "Manpower",
            },
          };
        },
      };
    },
  })
  .get("/ok", () => "ok")
  .get("/items/:id", ({ params }) => params.id)
  .get("/missing", ({ status }) => status(404, "nope"))
  .get("/boom", () => {
    throw new TypeError("secret postgres://user:pw@host/db");
  })
  .get("/slow", async () => {
    await Bun.sleep(60);
    return "late";
  })
  .get("/me", () => "hi", { asUser: true });

const app = new Elysia()
  .use(opsMetrics({ slowMs: 50 }))
  .onError(({ code, status }) => {
    if (code === "UNKNOWN") return status(500, "internal");
  })
  .use(routes)
  .get("/health", () => "ok")
  .get("/v1/ops/session", () => "ok");

const get = (path: string, headers: Record<string, string> = {}) =>
  app.handle(new Request(`http://localhost${path}`, { headers }));

const routeOf = (name: string) => `GET /v1/${tag}${name}`;

beforeAll(async () => {
  if (redis.status === "end") await redis.connect();
  process.env.TRUST_PROXY = "true";
});

afterAll(async () => {
  await forgetOpsTraffic();
  if (previousProxy === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = previousProxy;
});

describe("requests", () => {
  test("are counted per route, by the route's pattern rather than its path", async () => {
    await get(`/v1/${tag}/ok`);
    await get(`/v1/${tag}/items/1`);
    await get(`/v1/${tag}/items/2`);
    await flushOpsMetrics();

    const { routes } = await readOpsMetrics();
    expect(routes.find((r) => r.route === routeOf("/ok"))?.requests).toBe(1);
    expect(
      routes.find((r) => r.route === routeOf("/items/:id"))?.requests
    ).toBe(2);
  });

  test("land in the current minute's totals", async () => {
    const before = await readOpsMetrics();
    const minute = (m: typeof before) => m.perMinute.at(-1)!;
    await get(`/v1/${tag}/ok`);
    await flushOpsMetrics();
    const after = await readOpsMetrics();
    expect(minute(after).requests).toBeGreaterThan(minute(before).requests);
    expect(after.perMinute).toHaveLength(before.perMinute.length);
  });

  test("count client and server errors apart", async () => {
    await get(`/v1/${tag}/missing`);
    await get(`/v1/${tag}/boom`);
    await flushOpsMetrics();

    const { routes } = await readOpsMetrics();
    const missing = routes.find((r) => r.route === routeOf("/missing"))!;
    const boom = routes.find((r) => r.route === routeOf("/boom"))!;
    expect(missing.clientErrors).toBe(1);
    expect(missing.serverErrors).toBe(0);
    expect(boom.serverErrors).toBe(1);
  });

  test("a server error is listed by its name, never its message", async () => {
    await get(`/v1/${tag}/boom`);
    await flushOpsMetrics();

    const { errors } = await readOpsMetrics();
    const mine = errors.find((e) => e.route === routeOf("/boom"));
    expect(mine?.status).toBe(500);
    expect(mine?.name).toBe("TypeError");
    expect(JSON.stringify(errors)).not.toContain("postgres://");
  });

  test("a slow one is kept with its duration", async () => {
    await get(`/v1/${tag}/slow`);
    await flushOpsMetrics();

    const { slow } = await readOpsMetrics();
    const mine = slow.find((s) => s.route === routeOf("/slow"));
    expect(mine?.ms).toBeGreaterThanOrEqual(50);
  });

  test("the health check and the ops page itself are not counted", async () => {
    await get("/health");
    await get("/v1/ops/session");
    await flushOpsMetrics();

    const { routes } = await readOpsMetrics();
    expect(routes.some((r) => r.route.endsWith(" /health"))).toBe(false);
    expect(routes.some((r) => r.route.includes("/v1/ops/"))).toBe(false);
  });
});

describe("who is using it", () => {
  test("a signed-in user is listed with their role, browser and what they did last — never their NIK or address", async () => {
    await get(`/v1/${tag}/me`, {
      "x-forwarded-for": "192.168.151.20",
      "user-agent": "UjiBrowser/1.0",
    });
    await get(`/v1/${tag}/me`, {
      "x-forwarded-for": "192.168.151.21",
      "user-agent": "UjiBrowser/1.0",
    });
    await flushOpsMetrics();

    const { users } = await readOpsMetrics();
    const me = users.find((u) => u.userId === userId);
    expect(me).toBeDefined();
    expect(me!.name).toBe("Uji Ops");
    expect(me!.roleName).toBe("Manpower");
    expect(me!.userAgent).toBe("UjiBrowser/1.0");
    expect(me!.lastRoute).toBe(routeOf("/me"));
    expect(me!.lastStatus).toBe(200);
    expect(me!.requests).toBe(2);
    expect(me).not.toHaveProperty("nik");
    expect(me).not.toHaveProperty("ip");
  });

  test("neither the NIK nor the address is written to Redis", async () => {
    await get(`/v1/${tag}/me`, { "x-forwarded-for": "192.168.151.22" });
    await flushOpsMetrics();

    const stored = await redis.hgetall(opsKey(`user:${userId}`));
    expect(stored.name).toBe("Uji Ops");
    expect(stored).not.toHaveProperty("nik");
    expect(stored).not.toHaveProperty("ip");
    expect(JSON.stringify(stored)).not.toContain("990001");
    expect(JSON.stringify(stored)).not.toContain("192.168.151.22");
  });

  test("an anonymous request lists nobody", async () => {
    const before = (await readOpsMetrics()).users.length;
    await get(`/v1/${tag}/ok`);
    await flushOpsMetrics();
    expect((await readOpsMetrics()).users.length).toBe(before);
  });
});

describe("hardening (security review, 2026-10-02)", () => {
  test("an invented HTTP method cannot mint new route labels", async () => {
    for (const method of [`ZZ${tag}A`, `ZZ${tag}B`, `X|${tag}|n`])
      await app.handle(
        new Request(`http://localhost/v1/${tag}/ok`, { method })
      );
    await flushOpsMetrics();
    const { routes } = await readOpsMetrics();
    expect(routes.some((r) => r.route.includes(`ZZ${tag}`))).toBe(false);
    expect(routes.some((r) => r.route.includes(`X|`))).toBe(false);
  });
});
