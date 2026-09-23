/**
 * Which sound a screen should play next, and at what instant.
 *
 * The screens have the speakers; the server has the clock. A wall that worked
 * the moment out for itself would drift, and one that reloaded at 05:18:59
 * would either miss the cue or play it twice — so the server names the cue and
 * the instant, and the browser only obeys.
 *
 * Pure so the rule can be tested without a database or a fixed clock: the
 * display route passes the day's stages and `new Date()`.
 */

/** How long before a stage its sound plays. Two minutes (owner, 2026-09-23). */
export const SOUND_LEAD_SECONDS = 120;

/**
 * How far ahead a cue is worth carrying.
 *
 * The screens poll every minute, so anything inside this window will be told
 * again several times before it matters; the browser schedules against the
 * response it holds and re-schedules on the next poll.
 */
export const CUE_HORIZON_SECONDS = 15 * 60;

/** A timeline stage, as the cue rule needs it. */
export type CueStage = {
  id: string;
  name: string;
  /** Wall-clock `HH:MM`, as the timeline stores it. */
  at: string;
  /** The sound to play two minutes before it, or null for silence. */
  soundId: string | null;
  active: boolean;
};

export type SoundCue = {
  /**
   * Stage and date. A screen plays a cue once and remembers this, so a poll
   * landing twice inside the same minute cannot sound twice, and the same
   * stage tomorrow is a different cue.
   */
  id: string;
  soundId: string;
  /** What the stage is called, so a screen can say what it just announced. */
  stageName: string;
  playAt: Date;
};

const pad = (n: number) => String(n).padStart(2, "0");

/** `YYYY-MM-DD` in the machine's own timezone — the site's, on the server. */
const localDay = (at: Date) =>
  `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;

/**
 * The soonest cue still ahead of `now`, or null.
 *
 * A cue already past is not replayed — announcing a deadline that has arrived
 * is worse than silence — and one beyond the horizon waits.
 *
 * Both today's occurrence and tomorrow's are considered, which is what carries
 * the horizon across midnight: at 23:50 the cue for a 00:05 stage is thirteen
 * minutes away, and computing it from today's date alone put it a day in the
 * past and dropped it. The cue is named for the day it *fires* on, so the poll
 * before midnight and the poll after it describe the same announcement by the
 * same name — otherwise a screen holding both would sound it twice.
 */
export function nextSoundCue(stages: CueStage[], now: Date): SoundCue | null {
  const cues: SoundCue[] = [];
  for (const stage of stages) {
    if (!stage.active || !stage.soundId) continue;
    const [hours, minutes] = stage.at.split(":").map(Number);
    if (hours === undefined || minutes === undefined) continue;
    for (const dayOffset of [0, 1]) {
      const playAt = new Date(now);
      playAt.setDate(playAt.getDate() + dayOffset);
      playAt.setHours(hours, minutes, 0, 0);
      playAt.setSeconds(playAt.getSeconds() - SOUND_LEAD_SECONDS);
      const waitMs = playAt.getTime() - now.getTime();
      if (waitMs < 0 || waitMs > CUE_HORIZON_SECONDS * 1000) continue;
      cues.push({
        id: `${stage.id}:${localDay(playAt)}`,
        soundId: stage.soundId,
        stageName: stage.name,
        playAt,
      });
    }
  }
  cues.sort((a, b) => a.playAt.getTime() - b.playAt.getTime());
  return cues[0] ?? null;
}
