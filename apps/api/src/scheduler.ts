/**
 * The morning allocation schedule (design D9).
 *
 * A tick each minute reads the active stages and fires those whose time has
 * arrived. The actions themselves are hooks: `ftw-deadline`, `finger-in`,
 * `bus-depart`, and `other` are markers; `ftw-ingest` and `finger-ingest`
 * open a readiness-ingest window (`ingest.ts`); `spare-validate` names work
 * the allocation engine will do and which does not exist yet.
 *
 * Building the trigger before the work it triggers is deliberate. The
 * alternative — persist the rows now, add firing when the engine lands — means
 * the engine's change has to design the scheduler, the locking, and the shared
 * action vocabulary on top of its own complexity. Landing the mechanism against
 * no-ops makes that change an implementation of two functions.
 *
 * The honest cost is that a scheduler firing nothing observable cannot be
 * proven from the UI. It is proven from the log line every dispatch emits, and
 * from `scheduler.test.ts`, which runs two schedulers against one Redis.
 */

import { eq } from "drizzle-orm";
import type { TimelineAction } from "@universe/contracts";

import { db, schema, type TimelineStageRow } from "./db";
// Circular on paper (ingest uses localDate from here) — harmless in practice:
// both sides only reach through the binding inside function bodies, never at
// module init.
import { runIngestWindow, type IngestKind } from "./ingest";
import { redis } from "./redis";

/** One tick per minute: the schedule is specified to the minute. */
const TICK_MS = 60_000;

/**
 * How long a claim survives.
 *
 * Longer than a day so a stage claimed just before midnight cannot have its
 * key expire back into eligibility while the same date is still current, and
 * short enough that keys do not accumulate. The key carries the date, so
 * tomorrow asks a different question regardless.
 */
const CLAIM_TTL_SECONDS = 26 * 60 * 60;

const claimKey = (stageId: string, date: string) => `stage:${stageId}:${date}`;

/** Local calendar date — the schedule is a fact about the site's morning. */
export function localDate(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Minutes since local midnight, which is what a `time` column compares to. */
export function minutesOfDay(now: Date): number {
  return now.getHours() * 60 + now.getMinutes();
}

/** "HH:MM:SS" → minutes since midnight. */
export function stageMinutes(at: string): number {
  const [hours = "0", minutes = "0"] = at.split(":");
  return Number(hours) * 60 + Number(minutes);
}

/* ------------------------------------------------------------- the hooks */

export type Dispatch = {
  stage: Pick<TimelineStageRow, "id" | "name" | "action">;
  date: string;
};

type Hook = (dispatch: Dispatch) => Promise<void>;

/** Every dispatch says so, because the log is the only observer today. */
function record(dispatch: Dispatch, note: string): void {
  console.log(
    `[scheduler] ${dispatch.date} fired "${dispatch.stage.name}" ` +
      `(${dispatch.stage.action}) — ${note}`
  );
}

const marker: Hook = async (dispatch) => {
  record(dispatch, "marker, no work attached");
};

/**
 * The two ingest stages: fire once here, then `runIngestWindow` keeps
 * re-pulling until the window closes (each pass an idempotent upsert — see
 * `ingest.ts`). The window runs detached: a stage that spends five minutes
 * pulling must not hold this tick's loop hostage, and the window logs its own
 * passes and failures, so awaiting it here would add nothing but delay for
 * whatever stage is due in the same minute.
 */
const ingest =
  (kind: IngestKind): Hook =>
  async (dispatch) => {
    record(dispatch, `ingest window opened (${kind})`);
    void runIngestWindow(kind);
  };

/**
 * ── The allocation engine attaches here. ──────────────────────────────────
 *
 * `spare-validate` matches spare operators to the units left empty — the
 * subject of the Actual-tab change. Implementing it means replacing the body
 * of this hook and nothing else: the scheduling, the once-per-day guarantee,
 * the multi-process lock, and the action vocabulary are all settled above and
 * around it.
 */
const notYetImplemented: Hook = async (dispatch) => {
  record(dispatch, "allocation engine not implemented yet — no-op");
};

const HOOKS: Record<TimelineAction, Hook> = {
  "ftw-deadline": marker,
  "finger-in": marker,
  "bus-depart": marker,
  other: marker,
  "ftw-ingest": ingest("ftw"),
  "finger-ingest": ingest("finger"),
  "spare-validate": notYetImplemented,
};

/* -------------------------------------------------------------- the tick */

/**
 * Claim a stage for a date, once across every process.
 *
 * `SET NX EX` is the whole guarantee: the first process to ask gets the key and
 * fires, every other gets nothing and returns quietly — which is not an error
 * condition, it is the mechanism working. A process restarting inside the same
 * minute finds the key already set, so a crash loop cannot turn into a dispatch
 * loop either.
 */
async function claim(stageId: string, date: string): Promise<boolean> {
  const result = await redis.set(
    claimKey(stageId, date),
    "1",
    "EX",
    CLAIM_TTL_SECONDS,
    "NX"
  );
  return result === "OK";
}

/**
 * Fire every active stage whose time has passed and which has not fired today.
 *
 * "has passed", not "is now": a tick that lands a minute late, or a process
 * that was down at 05:20 and came up at 05:23, still fires the stage — losing
 * the morning's allocation because a container restarted is worse than firing
 * it three minutes late. It is also what makes a *time edited backwards* well
 * defined (spec: "a time changed to a moment already passed"): the stage
 * becomes due immediately and fires once, because the claim is what stops
 * repetition, not the comparison.
 *
 * Exported for the test, which drives it directly rather than waiting a minute.
 */
export async function tick(now = new Date()): Promise<Dispatch[]> {
  const date = localDate(now);
  const nowMinutes = minutesOfDay(now);

  const stages = await db
    .select()
    .from(schema.timelineStages)
    .where(eq(schema.timelineStages.active, true));

  const fired: Dispatch[] = [];
  for (const stage of stages) {
    if (stageMinutes(stage.at) > nowMinutes) continue;
    if (!(await claim(stage.id, date))) continue;

    const dispatch: Dispatch = { stage, date };
    try {
      await HOOKS[stage.action](dispatch);
      fired.push(dispatch);
    } catch (error) {
      // The claim is deliberately not released: a hook that throws has already
      // half-run for all this knows, and retrying it next minute would be a
      // second dispatch. It is logged loudly and left for a human.
      console.error(
        `[scheduler] ${date} hook for "${stage.name}" (${stage.action}) threw`,
        error
      );
    }
  }
  return fired;
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startScheduler(): void {
  if (timer) return;
  // An immediate tick as well as the interval, so a stage whose time passed
  // while the process was down fires on startup rather than up to a minute
  // later.
  void tick().catch((error) => console.error("[scheduler] tick failed", error));
  timer = setInterval(() => {
    void tick().catch((error) =>
      console.error("[scheduler] tick failed", error)
    );
  }, TICK_MS);
  console.log("[scheduler] started — one tick per minute");
}

export function stopScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
