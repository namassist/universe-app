/**
 * The per-client request budget. Needs the dev Redis.
 */

import { beforeAll, describe, expect, test } from "bun:test";

import { redis } from "../redis";
import { takeRequest } from "./rate-limit";

const client = () => `zz-rate-${crypto.randomUUID()}`;
const at = (iso: string) => new Date(iso);

beforeAll(async () => {
  if (redis.status === "end") await redis.connect();
});

describe("takeRequest", () => {
  test("admits up to the limit within one minute, then refuses", async () => {
    const id = client();
    const now = at("2026-10-09T08:00:10Z");

    const answers = [];
    for (let i = 0; i < 4; i++) answers.push(await takeRequest(id, 3, now));

    expect(answers.map((a) => a.allowed)).toEqual([true, true, true, false]);
    expect(answers[3]!.retryAfterSeconds).toBe(50);
  });

  test("a new minute is a new budget", async () => {
    const id = client();
    for (let i = 0; i < 3; i++)
      await takeRequest(id, 3, at("2026-10-09T08:00:30Z"));

    const next = await takeRequest(id, 3, at("2026-10-09T08:01:00Z"));
    expect(next.allowed).toBe(true);
  });

  test("clients do not share a budget", async () => {
    const a = client();
    const b = client();
    const now = at("2026-10-09T08:00:00Z");
    for (let i = 0; i < 3; i++) await takeRequest(a, 3, now);

    expect((await takeRequest(a, 3, now)).allowed).toBe(false);
    expect((await takeRequest(b, 3, now)).allowed).toBe(true);
  });
});
