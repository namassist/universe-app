/**
 * What happens when a machine does not answer.
 *
 * This is a regression test with a date on it. On 2026-09-12 the API crashed
 * on startup with `EHOSTUNREACH ... at node:dgram`, and the owner had to
 * restart the server twice. The cause was not the unreachable machine — one
 * of thirty-odd being off is normal — it was that we never gave `node-zklib`
 * an error callback. Without one the library's UDP fallback emits `error` as
 * a bare event, and Node turns an unheard event into an uncaught exception.
 * It bypassed the `try` in `fetchLogCount` entirely and took the process with
 * it, which during a muster means no taps are collected at all.
 *
 * A dead address is reached for on purpose here: localhost on the ZK port,
 * where nothing is listening. TCP is refused, which is precisely the case that
 * sends the library to UDP, and the kernel refuses that too — the same shape
 * as a machine that has gone off the site network.
 *
 * Needs Postgres, because every request is recorded like any other.
 *   bun --env-file=.env test src/sources/fingerprint-unreachable.test.ts
 */

import { describe, expect, test } from "bun:test";

import { fetchAttLog, fetchLogCount } from "./fingerprint";

/* Nothing listens here. Kept off the site's ranges so the test can never end
   up talking to real hardware. */
const DEAD = "127.0.0.1";

describe("a machine that does not answer", () => {
  test("the count comes back empty instead of killing the process", async () => {
    const count = await fetchLogCount(DEAD, 4_000);

    expect(count).toBeNull();
  });

  test("the log comes back empty instead of killing the process", async () => {
    const taps = await fetchAttLog(DEAD, 0, 4_000);

    expect(taps).toEqual([]);
  });

  test("a dead machine does not stop the ones that follow it", async () => {
    /* The muster pulls machines in a pool. The failure that mattered was not
       one empty result, it was the sixteen pulls that never happened after
       it. */
    const results = await Promise.all([
      fetchLogCount(DEAD, 4_000),
      fetchLogCount(DEAD, 4_000),
      fetchLogCount(DEAD, 4_000),
    ]);

    expect(results).toEqual([null, null, null]);
  });
});
