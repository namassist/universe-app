/**
 * The scheduler's own account of the day, for the Operations Center.
 *
 * Until now a stage that fired, refused or threw said so in the server log
 * and nowhere else — readable by whoever has the server, which is not who
 * watches the muster. Each run is now also kept here for three days: its
 * stage, when it ran, whether it did its job, and the scheduler's own note.
 *
 * The note is the scheduler's sentence, never a thrown error's text — a
 * driver's message routinely carries a connection string. A throw is recorded
 * by its error's name only; the detail stays in the log beside it.
 */

import type { ShiftKind, TimelineAction } from "@universe/contracts";

import { redis } from "../redis";
import { opsKey } from "./keys";

const RETENTION_SECONDS = 3 * 24 * 60 * 60;
const KEEP = 200;
const runsKey = (date: string) => opsKey(`stages:${date}`);
const tickKey = () => opsKey("scheduler:tick");

export type StageRun = {
  at: string;
  date: string;
  stageId: string;
  name: string;
  action: TimelineAction;
  shift: ShiftKind | null;
  ok: boolean;
  note: string;
};

export async function recordStageRun(input: {
  date: string;
  stage: {
    id: string;
    name: string;
    action: TimelineAction;
    shift: ShiftKind | null;
  };
  note: string;
  ok: boolean;
  at?: Date;
}): Promise<void> {
  const run: StageRun = {
    at: (input.at ?? new Date()).toISOString(),
    date: input.date,
    stageId: input.stage.id,
    name: input.stage.name,
    action: input.stage.action,
    shift: input.stage.shift,
    ok: input.ok,
    note: input.note.slice(0, 300),
  };
  await redis
    .multi()
    .lpush(runsKey(input.date), JSON.stringify(run))
    .ltrim(runsKey(input.date), 0, KEEP - 1)
    .expire(runsKey(input.date), RETENTION_SECONDS)
    .exec();
}

export async function readStageRuns(date: string): Promise<StageRun[]> {
  const raw = await redis.lrange(runsKey(date), 0, KEEP - 1);
  return raw.flatMap((line) => {
    try {
      return [JSON.parse(line) as StageRun];
    } catch {
      return [];
    }
  });
}

/** Stamped every tick, so a stopped scheduler shows as a stale time. */
export async function markSchedulerTick(at = new Date()): Promise<void> {
  await redis.set(tickKey(), at.toISOString(), "EX", RETENTION_SECONDS);
}

export async function lastSchedulerTick(): Promise<string | null> {
  return redis.get(tickKey());
}
