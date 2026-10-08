/**
 * The Operations Center's own door: one shared password, a session of its own,
 * and nothing it opens beyond `/v1/ops`.
 *
 * Needs the dev Redis:
 *   bun --env-file=.env test src/routes/ops.test.ts
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

import { forgetOpsTraffic } from "../ops/metrics";
import { redis } from "../redis";
import { notificationRoutes } from "./notifications";
import { OPS_COOKIE, opsRoutes } from "./ops";

const app = new Elysia().use(opsRoutes).use(notificationRoutes);

const PASSWORD = "ops-uji-rahasia-123";
let hash = "";
const previous = {
  hash: process.env.OPS_PASSWORD_HASH,
  proxy: process.env.TRUST_PROXY,
};

let ipSeq = 0;
/** A fresh client address per test, so lockouts cannot leak between tests. */
const freshIp = () => `10.99.${Date.now() % 250}.${++ipSeq}`;

const send = (
  method: string,
  path: string,
  options: { ip?: string; cookie?: string; body?: unknown } = {}
) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        ...(options.ip
          ? { "x-forwarded-for": `203.0.113.9, ${options.ip}` }
          : {}),
        ...(options.cookie ? { cookie: options.cookie } : {}),
        ...(options.body ? { "content-type": "application/json" } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    })
  );

const login = (password: string, ip: string) =>
  send("POST", "/ops/session", { ip, body: { password } });

/** `universe_ops=<id>` from a login response, or null. */
function opsCookie(response: Response): string | null {
  const header = response.headers.get("set-cookie") ?? "";
  const match = header.match(new RegExp(`${OPS_COOKIE}=([^;]+)`));
  return match ? `${OPS_COOKIE}=${match[1]}` : null;
}

beforeAll(async () => {
  if (redis.status === "end") await redis.connect();
  hash = await Bun.password.hash(PASSWORD);
  process.env.TRUST_PROXY = "true";
});

beforeEach(() => {
  process.env.OPS_PASSWORD_HASH = hash;
});

afterAll(async () => {
  await forgetOpsTraffic();
  for (const [name, value] of [
    ["OPS_PASSWORD_HASH", previous.hash],
    ["TRUST_PROXY", previous.proxy],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("the ops password", () => {
  test("with no hash configured the whole surface is absent", async () => {
    delete process.env.OPS_PASSWORD_HASH;
    expect((await login(PASSWORD, freshIp())).status).toBe(404);
    expect((await send("GET", "/ops/session")).status).toBe(404);
  });

  test("a wrong password is refused and sets no cookie", async () => {
    const response = await login("bukan-ini", freshIp());
    expect(response.status).toBe(401);
    expect(opsCookie(response)).toBeNull();
  });

  test("the right one opens a session the page can check", async () => {
    const response = await login(PASSWORD, freshIp());
    expect(response.status).toBe(200);
    const header = response.headers.get("set-cookie") ?? "";
    expect(header).toContain("HttpOnly");
    expect(header.toLowerCase()).toContain("samesite=strict");

    const cookie = opsCookie(response);
    expect(cookie).not.toBeNull();
    expect(
      (await send("GET", "/ops/session", { cookie: cookie! })).status
    ).toBe(200);
  });

  test("without a session the check says so", async () => {
    expect((await send("GET", "/ops/session")).status).toBe(401);
  });

  test("logging out ends the session", async () => {
    const cookie = opsCookie(await login(PASSWORD, freshIp()))!;
    expect((await send("DELETE", "/ops/session", { cookie })).status).toBe(200);
    expect((await send("GET", "/ops/session", { cookie })).status).toBe(401);
  });
});

describe("guessing", () => {
  test("five wrong tries lock that address out, even for the right password", async () => {
    const ip = freshIp();
    for (let i = 0; i < 5; i++)
      expect((await login("salah", ip)).status).toBe(401);
    expect((await login(PASSWORD, ip)).status).toBe(429);
  });

  test("another address is not locked by somebody else's guesses", async () => {
    const ip = freshIp();
    for (let i = 0; i < 5; i++) await login("salah", ip);
    expect((await login(PASSWORD, freshIp())).status).toBe(200);
  });

  test("a success clears the count", async () => {
    const ip = freshIp();
    for (let i = 0; i < 4; i++) await login("salah", ip);
    expect((await login(PASSWORD, ip)).status).toBe(200);
    for (let i = 0; i < 4; i++)
      expect((await login("salah", ip)).status).toBe(401);
  });
});

describe("the ops session opens nothing else", () => {
  test("it is not a user session", async () => {
    const cookie = opsCookie(await login(PASSWORD, freshIp()))!;
    const id = cookie.split("=")[1];
    const response = await send("GET", "/notifications", {
      cookie: `universe_session=${id}`,
    });
    expect(response.status).toBe(401);
  });

  test("and a user cookie does not open the ops page", async () => {
    const cookie = opsCookie(await login(PASSWORD, freshIp()))!;
    const id = cookie.split("=")[1];
    expect(
      (await send("GET", "/ops/session", { cookie: `universe_session=${id}` }))
        .status
    ).toBe(401);
  });
});

describe("hardening (security review, 2026-10-02)", () => {
  test("a burst of concurrent guesses is still held to five", async () => {
    const ip = freshIp();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => login("salah", ip))
    );
    const refused = results.filter((r) => r.status === 401).length;
    expect(refused).toBeLessThanOrEqual(5);
    expect(results.filter((r) => r.status === 429).length).toBe(20 - refused);
    expect((await login(PASSWORD, ip)).status).toBe(429);
  });

  test("changing the password ends every session opened with the old one", async () => {
    const cookie = opsCookie(await login(PASSWORD, freshIp()))!;
    process.env.OPS_PASSWORD_HASH = await Bun.password.hash(
      "kata-sandi-baru-456"
    );
    expect((await send("GET", "/ops/session", { cookie })).status).toBe(401);
  });

  test("ops responses are never cached", async () => {
    const cookie = opsCookie(await login(PASSWORD, freshIp()))!;
    const response = await send("GET", "/ops/session", { cookie });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
