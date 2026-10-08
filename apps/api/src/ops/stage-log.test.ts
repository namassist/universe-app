/**
 * The scheduler's own account of the day, kept where the Operations Center
 * can read it rather than only in the server's log.
 *
 * Needs the dev Redis:
 *   bun --env-file=.env test src/ops/stage-log.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { redis } from "../redis";
import { opsKey } from "./keys";
import { forgetOpsTraffic } from "./metrics";
import {
  lastSchedulerTick,
  markSchedulerTick,
  readStageRuns,
  recordStageRun,
} from "./stage-log";

const date = `2099-01-${String(1 + (Date.now() % 27)).padStart(2, "0")}`;
const stage = (name: string) => ({
  id: crypto.randomUUID(),
  name,
  action: "spare-validate" as const,
  shift: "day" as const,
});

beforeAll(async () => {
  if (redis.status === "end") await redis.connect();
  await redis.del(opsKey(`stages:${date}`));
});

afterAll(() => forgetOpsTraffic());

describe("stage runs", () => {
  test("are read back for their date, newest first, with how they ended", async () => {
    await recordStageRun({
      date,
      stage: stage("Validasi Spare"),
      note: "day board: 9 of 10 units crewed",
      ok: true,
    });
    await recordStageRun({
      date,
      stage: stage("Bus Berangkat"),
      note: "marker, no work attached",
      ok: true,
    });
    await recordStageRun({
      date,
      stage: stage("Validasi Spare"),
      note: "no active finger-in stage",
      ok: false,
    });

    const runs = await readStageRuns(date);
    expect(runs.map((r) => [r.name, r.ok])).toEqual([
      ["Validasi Spare", false],
      ["Bus Berangkat", true],
      ["Validasi Spare", true],
    ]);
    expect(runs[0]!.action).toBe("spare-validate");
    expect(runs[0]!.shift).toBe("day");
    expect(typeof runs[0]!.at).toBe("string");
  });

  test("another date reads empty", async () => {
    expect(await readStageRuns("2099-12-31")).toEqual([]);
  });
});

describe("the scheduler's heartbeat", () => {
  test("is the last time it ticked", async () => {
    const at = new Date("2026-10-02T05:26:00Z");
    await markSchedulerTick(at);
    expect(await lastSchedulerTick()).toBe(at.toISOString());
  });
});
