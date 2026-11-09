/**
 * The verification queue. A burst larger than the bound must still answer
 * every caller, each with its own verdict: a slot handed to the wrong waiter,
 * or never handed on, would hang a login or give it someone else's answer.
 */

import { expect, test } from "bun:test";

import { hashPassword, verifyPassword } from "./password";

test("a burst past the bound is queued, and every call gets its own answer", async () => {
  const hash = await hashPassword("benar-sekali-123");
  const tries = Array.from({ length: 13 }, (_, i) =>
    i % 3 === 0 ? "benar-sekali-123" : `salah-${i}`
  );
  const verdicts = await Promise.all(
    tries.map((plain) => verifyPassword(plain, hash))
  );
  expect(verdicts).toEqual(tries.map((plain) => plain === "benar-sekali-123"));
});

test("a verify that throws still passes its slot on", async () => {
  const hash = await hashPassword("benar-sekali-123");
  const broken = Array.from({ length: 6 }, () =>
    verifyPassword("x", "not-a-hash").catch(() => "threw")
  );
  expect(await Promise.all(broken)).toEqual(Array(6).fill("threw"));
  expect(await verifyPassword("benar-sekali-123", hash)).toBe(true);
});
