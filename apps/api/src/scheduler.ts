/**
 * The morning allocation schedule (design D9).
 *
 * A tick each minute reads the active stages and fires those whose time has
 * arrived. The actions themselves are hooks: `shift-start`, `ftw-deadline`,
 * `finger-in`, `bus-depart`, and `other` are markers; `ftw-ingest` and `finger-ingest`
 * open a readiness-ingest window (`ingest.ts`); `roster-ingest` mirrors the
 * schedule from unggul_att (`roster-sync.ts`) in a single pass, because a
 * roster is not a late-arriving reading and re-pulling it every minute would
 * ask a whole month of another system for nothing; `spare-validate` names work
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
import { env } from "./env";
// Circular on paper (ingest uses localDate from here) — harmless in practice:
// both sides only reach through the binding inside function bodies, never at
// module init.
import { buildBoard, storeBoard } from "./allocation";
import { runIngestWindow, type IngestKind } from "./ingest";
import { runRosterSync } from "./roster-sync";
import { fingerInDeadline, ftwDeadline } from "./readiness";
import { pullClosesAt } from "./stage-time";
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
  /**
   * `shift` is carried, not just the action: two rows now share an action
   * twelve hours apart, so a hook that does real work needs to know which half
   * of the day fired it. `spare-validate` is the one that will — it generates
   * a board for one shift, and reading the clock to guess which would be a
   * second, worse copy of the answer the row already holds.
   */
  stage: Pick<TimelineStageRow, "id" | "name" | "action" | "shift">;
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
 * `ingest.ts`). The window runs detached: a stage that spends an hour pulling
 * must not hold this tick's loop hostage, and the window logs its own passes
 * and failures, so awaiting it here would add nothing but delay for whatever
 * stage is due in the same minute.
 *
 * **The window ends at its own deadline** — `ftw-ingest` pulls until
 * `ftw-deadline`, `finger-ingest` until `finger-in` — so that opening the
 * muster wider is a decision made on the Timeline screen rather than in a
 * constant here. Before this, both ran a fixed five minutes and the readings
 * tables stood still for the rest of the morning; the wall's two badges could
 * not move because there was nothing new to move them.
 *
 * A deadline the timeline cannot name falls back to that fixed span rather
 * than refusing. `allocate` below refuses on a missing stage and is right to —
 * a board built on a guess is worse than no board. This is the opposite case:
 * pulling nothing empties the readings tables, and every screen and the board
 * itself go down with them. The old five minutes is a safe floor, and the
 * dispatch line says which of the two happened.
 */
const ingest =
  (kind: IngestKind): Hook =>
  async (dispatch) => {
    const endsAt = await pullClosesAt(
      dispatch.stage.action,
      dispatch.stage.shift
    );
    record(
      dispatch,
      endsAt
        ? `ingest window opened (${kind}), pulling until ${timeOfDay(endsAt)}`
        : `ingest window opened (${kind}), no deadline stage to pull until — ` +
            `falling back to ${env.INGEST_WINDOW_MINUTES} minutes`
    );
    void runIngestWindow(kind, endsAt ? { endsAt } : {});
  };

/** "HH:MM" of a moment, for a log line that reads like the timeline screen. */
function timeOfDay(at: Date): string {
  return `${String(at.getHours()).padStart(2, "0")}:${String(
    at.getMinutes()
  ).padStart(2, "0")}`;
}

/**
 * ── The allocation engine. ────────────────────────────────────────────────
 *
 * Builds the shift's board and stores it: planned operators who passed keep
 * their unit, and the vacancies are filled from the spare pool first come
 * first served. `dispatch.stage.shift` is what says *which* board — two rows
 * carry this action, twelve hours apart.
 *
 * Two refusals rather than a board built on a guess. A stage with no shift
 * cannot say what it is generating, and a shift with no active `finger-in`
 * deadline has no pass rule — inventing either produces a full screen of
 * confident nonsense, which is worse than an empty one and much harder to
 * notice.
 */
const allocate: Hook = async (dispatch) => {
  const shift = dispatch.stage.shift;
  if (!shift)
    return record(
      dispatch,
      "stage carries no shift — cannot tell which board to build; set it on the timeline"
    );

  const deadline = await fingerInDeadline(shift);
  if (!deadline)
    return record(
      dispatch,
      `no active finger-in stage for the ${shift} shift — no deadline, so no pass rule`
    );

  // Refused for the same reason as above, not silently skipped: with no
  // configured `ftw-deadline` there is no such thing as a late upload, and
  // treating every one as punctual would put the afternoon's data on the
  // morning's board.
  const uploadClose = await ftwDeadline(shift);
  if (!uploadClose)
    return record(
      dispatch,
      `no active ftw-deadline stage for the ${shift} shift — nothing says when an upload is late`
    );

  const board = await buildBoard(dispatch.date, shift, deadline, uploadClose);
  await storeBoard(board);
  const filled = board.slots.filter((s) => s.employeeId).length;
  record(
    dispatch,
    `${shift} board: ${filled} of ${board.slots.length} units crewed ` +
      `(${board.slots.filter((s) => s.source === "spare").length} from the spare pool)`
  );
};

const HOOKS: Record<TimelineAction, Hook> = {
  // Fires nothing. Its time is read by `shiftGates` for the walls; the dispatch
  // exists so the log records that the changeover moment passed.
  "shift-start": marker,
  "ftw-deadline": marker,
  "finger-in": marker,
  "bus-depart": marker,
  other: marker,
  "ftw-ingest": ingest("ftw"),
  "finger-ingest": ingest("finger"),
  "roster-ingest": async () => {
    await runRosterSync();
  },
  "spare-validate": allocate,
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
