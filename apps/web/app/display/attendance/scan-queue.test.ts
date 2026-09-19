/**
 * The attendance TV's ticket queue, without a screen or a clock.
 *
 *   cd apps/web && bun test app/display/attendance/scan-queue.test.ts
 */

import { describe, expect, test } from "bun:test";

import {
  DWELL_MS,
  initialQueue,
  MAX_WAITING,
  receive,
  tick,
  type QueueState,
} from "./scan-queue";

type T = { key: string; nik: string };
const scan = (key: string, nik = key): T => ({ key, nik });

/** Poll, then let the screen's timer run at `now`. */
const at = (state: QueueState<T>, now: number) => tick(state, now);

describe("opening the screen", () => {
  test("shows only the latest scan, not the whole shift again", () => {
    const state = receive(initialQueue<T>(), [scan("a"), scan("b"), scan("c")]);
    expect(state.showing?.key).toBe("c");
    expect(state.waiting).toEqual([]);
  });

  test("with nothing scanned yet there is nothing to show", () => {
    const state = receive(initialQueue<T>(), []);
    expect(state.showing).toBeNull();
  });

  test("the first scan after an empty start appears at once", () => {
    let state = receive(initialQueue<T>(), []);
    state = receive(state, [scan("a")]);
    state = at(state, 1_000);
    expect(state.showing?.key).toBe("a");
  });
});

describe("playing the queue", () => {
  const opened = () => at(receive(initialQueue<T>(), [scan("old")]), 0);

  test("each ticket holds the screen for three seconds, in arrival order", () => {
    let state = receive(opened(), [scan("old"), scan("a"), scan("b")]);
    state = at(state, 10_000);
    expect(state.showing?.key).toBe("a");

    state = at(state, 10_000 + DWELL_MS - 1);
    expect(state.showing?.key).toBe("a");

    state = at(state, 10_000 + DWELL_MS);
    expect(state.showing?.key).toBe("b");
  });

  test("with the queue empty the last ticket stays up", () => {
    let state = receive(opened(), [scan("old"), scan("a")]);
    state = at(state, 10_000);
    state = at(state, 60_000);
    expect(state.showing?.key).toBe("a");
    expect(state.waiting).toEqual([]);
  });

  test("a scan the screen already has is never queued twice", () => {
    let state = receive(opened(), [scan("old"), scan("a")]);
    // The next poll repeats what the last one said, as every poll does.
    state = receive(state, [scan("old"), scan("a")]);
    state = at(state, 10_000);
    state = receive(state, [scan("old"), scan("a")]);
    expect(state.showing?.key).toBe("a");
    expect(state.waiting).toEqual([]);
  });

  test("a double press is one ticket, not two of the same face", () => {
    let state = receive(opened(), [scan("old"), scan("a1", "7")]);
    state = at(state, 10_000);
    // The reader logged the same finger again a second later.
    state = receive(state, [scan("old"), scan("a1", "7"), scan("a2", "7")]);
    state = receive(state, [
      scan("old"),
      scan("a1", "7"),
      scan("a2", "7"),
      scan("b1", "8"),
      scan("b2", "8"),
    ]);
    expect(state.waiting.map((s) => s.key)).toEqual(["b1"]);
  });
});

describe("a muster rush", () => {
  test("never keeps more than twenty waiting; the oldest give way", () => {
    const burst = Array.from({ length: MAX_WAITING + 5 }, (_, i) =>
      scan(`s${i}`)
    );
    let state = receive(receive(initialQueue<T>(), [scan("old")]), burst);
    expect(state.waiting).toHaveLength(MAX_WAITING);
    expect(state.waiting[0]!.key).toBe("s5");
    expect(state.skipped).toBe(5);

    // The count is cleared once the backlog has been worked through.
    for (let i = 0; i <= MAX_WAITING; i++) state = at(state, i * DWELL_MS);
    expect(state.waiting).toEqual([]);
    expect(state.skipped).toBe(0);
  });
});
