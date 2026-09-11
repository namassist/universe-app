/**
 * The client against real hardware, skipped unless pointed at some.
 *
 * The parsing fixtures in `fingerprint.test.ts` were captured from a machine,
 * not invented — but from *one* machine. This site has fifty-eight, and two
 * have been read. Firmware differs, and a field that moves or a response that
 * is framed differently will not be found by a fixture.
 *
 * So this is the check to run before a rollout, and before adding a machine
 * whose firmware nobody has seen, rather than on every commit:
 *
 *   FINGERPRINT_TEST_IP=192.168.1.2 bun --env-file=.env test src/sources/fingerprint-device.test.ts
 *
 * Read-only, like everything else here. It asks a machine what it holds and
 * how many; it changes nothing, and every request it makes is written to
 * `device_requests` like any other.
 */

import { describe, expect, test } from "bun:test";

import { fetchAttLog, fetchLogCount } from "./fingerprint";

const ip = process.env.FINGERPRINT_TEST_IP;
const comKey = Number(process.env.FINGERPRINT_TEST_COMKEY ?? "0");

describe.skipIf(!ip)("against a real machine", () => {
  test("it answers with a count", async () => {
    const count = await fetchLogCount(ip!);

    expect(count).not.toBeNull();
    expect(count!).toBeGreaterThanOrEqual(0);
  });

  test("it answers with taps, and they are shaped as we parse them", async () => {
    const taps = await fetchAttLog(ip!, comKey);

    /* A machine with an empty log is a legitimate answer — a new one, or one
       somebody has just cleared — so the assertion is about shape, not count. */
    for (const tap of taps.slice(0, 20)) {
      expect(tap.nik).toMatch(/^\d+$/);
      expect(tap.at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      expect(["in", "out"]).toContain(tap.direction);
    }
  });

  /* The two transports must agree about how much is there. If SOAP returns
     fewer rows than the machine says it holds, the log is being truncated
     somewhere and a morning's attendance is quietly incomplete. */
  test("the count and the log agree", async () => {
    const [count, taps] = await Promise.all([
      fetchLogCount(ip!),
      fetchAttLog(ip!, comKey),
    ]);

    expect(count).not.toBeNull();
    expect(taps.length).toBe(count!);
  });

  /* Measured at over five seconds before this was bounded ourselves. */
  test("an unreachable machine gives up quickly", async () => {
    const started = Date.now();
    await fetchLogCount("192.0.2.1", 1500);

    expect(Date.now() - started).toBeLessThan(3000);
  });
});
