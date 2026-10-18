/**
 * Each timeline stage on the date of the muster it belongs to, and how it
 * went there: the scheduler's own claim and its last logged run.
 *
 * Read by the Operations Center and by the phone's timeline monitor
 * (docs/prd.md, Mobile app → Superadmin), so the two can never tell a
 * different story about the same muster.
 */

import { asc } from "drizzle-orm";

import { currentShift } from "../current-shift";
import { db, schema } from "../db";
import { redis } from "../redis";
import { claimKey, localDate } from "../scheduler";
import { shiftGates } from "../stage-time";
import { stageDue, stageMusterDate } from "./muster-date";
import { lastSchedulerTick, readStageRuns, type StageRun } from "./stage-log";

export async function readMusterStages(now = new Date()) {
  const date = localDate(now);
  /* The night muster under way before dawn began yesterday, so its stage
     runs are filed under yesterday's date. */
  const yesterday = localDate(new Date(now.getTime() - 24 * 60 * 60 * 1000));

  const [schedulerLastTick, gates, todayRuns, yesterdayRuns, stages] =
    await Promise.all([
      lastSchedulerTick(),
      shiftGates(),
      readStageRuns(date),
      readStageRuns(yesterday),
      db
        .select()
        .from(schema.timelineStages)
        .orderBy(
          asc(schema.timelineStages.shift),
          asc(schema.timelineStages.at)
        ),
    ]);
  const stageLog = [...todayRuns, ...yesterdayRuns];
  const runningShift = currentShift(now, gates);

  const musterDates = stages.map((stage) =>
    stageMusterDate(stage.shift, now, runningShift)
  );
  const claims = stages.length
    ? await redis.mget(
        ...stages.map((stage, i) => claimKey(stage.id, musterDates[i]!))
      )
    : [];
  const lastRunOf = new Map<string, StageRun>();
  for (const run of stageLog) {
    const key = `${run.stageId}|${run.date}`;
    if (!lastRunOf.has(key)) lastRunOf.set(key, run);
  }

  return {
    date,
    runningShift,
    schedulerLastTick,
    stageLog,
    stages: stages.map((stage, i) => {
      const musterDate = musterDates[i]!;
      const run = lastRunOf.get(`${stage.id}|${musterDate}`);
      const at = stage.at.slice(0, 5);
      return {
        id: stage.id,
        name: stage.name,
        action: stage.action,
        shift: stage.shift,
        at,
        date: musterDate,
        due: stageDue(musterDate, at, now),
        active: stage.active,
        fired: claims[i] !== null && claims[i] !== undefined,
        lastRun: run ? { at: run.at, ok: run.ok, note: run.note } : null,
      };
    }),
  };
}
