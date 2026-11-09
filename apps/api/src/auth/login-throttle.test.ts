/**
 * The person login's guess budget. Two counters: one per address, which
 * holds everywhere, and one per account, which only counts attempts from
 * outside the site, so somebody on the internet can wear out an account's
 * budget from outside but never lock its owner out at the muster.
 *
 *   bun --env-file=.env test src/auth/login-throttle.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { redis } from "../redis";
import {
  LOGIN_LOCKOUT_SECONDS,
  LOGIN_MAX_FAILURES,
  reserveLoginAttempt,
  settleLoginSuccess,
  throttleKey,
} from "./login-throttle";

const uid = () => crypto.randomUUID().slice(0, 8);
/** A fresh public address per test, from the documentation range. */
let octet = 1;
const publicIp = () => `203.0.113.${octet++}`;
const siteIp = () => `192.168.77.${octet++}`;

/** Before as well as after: the addresses repeat between runs, and a run
 *  that died part-way would otherwise leave them locked for the next one. */
async function clearAll() {
  const keys = await redis.keys(throttleKey("*"));
  if (keys.length) await redis.del(...keys);
}
beforeAll(clearAll);
afterAll(clearAll);

async function attempts(
  n: number,
  identifier: string,
  ip: () => string | null,
  onSite: boolean
) {
  const results = [];
  for (let i = 0; i < n; i++)
    results.push(await reserveLoginAttempt(identifier, ip(), onSite));
  return results;
}

describe("per address", () => {
  test(`the attempt after ${LOGIN_MAX_FAILURES} is refused, with how long is left`, async () => {
    const ip = publicIp();
    const results = await attempts(
      LOGIN_MAX_FAILURES + 1,
      `acct-${uid()}`,
      () => ip,
      false
    );
    expect(results.slice(0, -1).every((r) => r.kind === "ok")).toBe(true);
    const last = results.at(-1)!;
    expect(last.kind).toBe("locked");
    if (last.kind === "locked") {
      expect(last.retryAfter).toBeGreaterThan(0);
      expect(last.retryAfter).toBeLessThanOrEqual(LOGIN_LOCKOUT_SECONDS);
    }
  });

  test("holds on site too, whatever account is tried", async () => {
    const ip = siteIp();
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++)
      await reserveLoginAttempt(`acct-${uid()}`, ip, true);
    expect((await reserveLoginAttempt(`acct-${uid()}`, ip, true)).kind).toBe(
      "locked"
    );
  });

  test("another address is not affected", async () => {
    const locked = publicIp();
    await attempts(
      LOGIN_MAX_FAILURES + 1,
      `acct-${uid()}`,
      () => locked,
      false
    );
    expect(
      (await reserveLoginAttempt(`acct-${uid()}`, publicIp(), false)).kind
    ).toBe("ok");
  });
});

describe("per account", () => {
  test("guesses spread over many outside addresses still run out", async () => {
    const account = `acct-${uid()}`;
    const results = await attempts(
      LOGIN_MAX_FAILURES + 1,
      account,
      publicIp,
      false
    );
    expect(results.at(-1)!.kind).toBe("locked");
  });

  test("an account worn out from outside still logs in from site", async () => {
    const account = `acct-${uid()}`;
    await attempts(LOGIN_MAX_FAILURES + 1, account, publicIp, false);
    expect((await reserveLoginAttempt(account, siteIp(), true)).kind).toBe(
      "ok"
    );
  });

  test("attempts from site do not spend the account's outside budget", async () => {
    const account = `acct-${uid()}`;
    await attempts(LOGIN_MAX_FAILURES + 1, account, siteIp, true);
    expect((await reserveLoginAttempt(account, publicIp(), false)).kind).toBe(
      "ok"
    );
  });

  test("the identifier is read the way login reads it: trimmed, any case", async () => {
    const account = `Acct-${uid()}`;
    await attempts(LOGIN_MAX_FAILURES, ` ${account} `, publicIp, false);
    expect(
      (await reserveLoginAttempt(account.toLowerCase(), publicIp(), false)).kind
    ).toBe("locked");
  });
});

describe("after a successful login", () => {
  test("the account's budget starts again", async () => {
    const account = `acct-${uid()}`;
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++)
      await reserveLoginAttempt(account, publicIp(), false);
    await settleLoginSuccess(account, publicIp());
    expect((await reserveLoginAttempt(account, publicIp(), false)).kind).toBe(
      "ok"
    );
  });

  test("its own attempt is given back to the address, so successes never lock one", async () => {
    // Many people behind one public address (a carrier's CGNAT, an office)
    // all logging in correctly must not run out.
    const ip = publicIp();
    for (let i = 0; i < LOGIN_MAX_FAILURES * 2; i++) {
      const account = `acct-${uid()}`;
      expect((await reserveLoginAttempt(account, ip, false)).kind).toBe("ok");
      await settleLoginSuccess(account, ip);
    }
  });

  test("but the address's earlier failures stand, or one valid login would reset a guesser's", async () => {
    const ip = publicIp();
    for (let i = 0; i < LOGIN_MAX_FAILURES - 1; i++)
      await reserveLoginAttempt(`acct-${uid()}`, ip, false);
    const own = `acct-${uid()}`;
    await reserveLoginAttempt(own, ip, false);
    await settleLoginSuccess(own, ip);
    await reserveLoginAttempt(`acct-${uid()}`, ip, false);
    expect((await reserveLoginAttempt(`acct-${uid()}`, ip, false)).kind).toBe(
      "locked"
    );
  });
});
