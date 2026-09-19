/**
 * The attendance TV's ticket queue — which scan is on the glass, and which
 * are waiting their turn.
 *
 * The feed says which scans exist; this decides what the screen does with
 * them. Each ticket holds the screen for `DWELL_MS`, in the order the scans
 * reached us, and when nobody is waiting the last ticket stays up rather than
 * the screen going blank between arrivals.
 *
 * **It goes by which scans it has seen, not by a timestamp.** Every poll
 * repeats the latest hundred; a scan is new when its key has not been seen
 * before. A pulled batch that reached the database "in the past" of a live
 * tap — stamped when the pull began, committed when it ended — is still new
 * here, where a cursor would have stepped over it.
 *
 * Pure, so it is tested without a screen or a clock: the page calls `receive`
 * on each poll and `tick` on a timer.
 */

/** How long a ticket holds the screen (owner, 2026-09-19). */
export const DWELL_MS = 3_000;

/**
 * The most tickets allowed to wait (owner, 2026-09-19).
 *
 * Twenty at three seconds is a minute behind. At a muster one pull can bring
 * hundreds; playing them all would put a face on the glass a quarter of an
 * hour after its owner walked off. Past twenty the oldest give way, and the
 * screen says how many it skipped rather than pretending it showed everyone.
 */
export const MAX_WAITING = 20;

type Scan = { key: string; nik: string };

export type QueueState<T extends Scan> = {
  /** On the glass now; null only before the first scan of the shift. */
  showing: T | null;
  /** When `showing` went up — the dwell is measured from here. */
  shownAt: number;
  waiting: T[];
  /** Given way to a rush since the backlog last emptied. */
  skipped: number;
  /** Keys of every scan in the last poll — what "already had" means. */
  seen: ReadonlySet<string>;
  /** Whether a poll has answered yet; the first one only sets the stage. */
  primed: boolean;
};

export function initialQueue<T extends Scan>(): QueueState<T> {
  return {
    showing: null,
    shownAt: Number.NEGATIVE_INFINITY,
    waiting: [],
    skipped: 0,
    seen: new Set(),
    primed: false,
  };
}

/**
 * Take one poll's scans, oldest first.
 *
 * The first poll puts up the latest scan and queues nothing: a screen switched
 * on at 06:00 must not replay the muster. After that, a scan is queued once —
 * not when a poll repeats it, and not when the same person is already on the
 * glass or in line, which is how a reader that logs one press twice shows one
 * ticket.
 */
export function receive<T extends Scan>(
  state: QueueState<T>,
  scans: readonly T[]
): QueueState<T> {
  const seen = new Set(scans.map((s) => s.key));

  if (!state.primed)
    return { ...state, showing: scans.at(-1) ?? null, seen, primed: true };

  const present = new Set(
    [state.showing, ...state.waiting].flatMap((s) => (s ? [s.nik] : []))
  );
  const fresh: T[] = [];
  for (const s of scans) {
    if (state.seen.has(s.key) || present.has(s.nik)) continue;
    present.add(s.nik);
    fresh.push(s);
  }

  const lined = [...state.waiting, ...fresh];
  const overflow = Math.max(0, lined.length - MAX_WAITING);
  return {
    ...state,
    waiting: lined.slice(overflow),
    skipped: state.skipped + overflow,
    seen,
  };
}

/** Move to the next ticket once the current one has had its three seconds. */
export function tick<T extends Scan>(
  state: QueueState<T>,
  now: number
): QueueState<T> {
  const [next, ...rest] = state.waiting;
  if (!next || now - state.shownAt < DWELL_MS) return state;
  return {
    ...state,
    showing: next,
    shownAt: now,
    waiting: rest,
    skipped: rest.length ? state.skipped : 0,
  };
}
