/**
 * Reading a fingerprint machine's attendance log.
 *
 * The fixtures are not invented. They are responses `192.168.1.2` actually
 * produced on 2026-09-11, including one row the operator made while the tap was
 * being watched — which is why an `IN` row and an `OUT` row are both here. A
 * hand-written fixture would only prove we parse what we expect a machine to
 * say.
 *
 * Needs nothing: parsing is pure.
 *   bun --env-file=.env test src/sources/fingerprint.test.ts
 */

import { describe, expect, test } from "bun:test";

import { parseAttLog } from "./fingerprint";

/** Captured verbatim, two IN rows and the OUT row, whitespace as sent. */
const REAL = `<GetAttLogResponse>
<Row><PIN>506264337</PIN><DateTime>2026-09-11 08:29:34</DateTime><Verified>1</Verified><Status>0</Status><WorkCode>0</WorkCode></Row>
<Row><PIN>506264337</PIN><DateTime>2026-09-11 08:39:23</DateTime><Verified>1</Verified><Status>1</Status><WorkCode>0</WorkCode></Row>
<Row><PIN>507231058</PIN><DateTime>2026-09-09 13:24:03</DateTime><Verified>1</Verified><Status>0</Status><WorkCode>0</WorkCode></Row>
</GetAttLogResponse>`;

describe("what a machine says", () => {
  test("every row becomes a tap", () => {
    expect(parseAttLog(REAL)).toHaveLength(3);
  });

  test("the PIN is the NIK, unchanged", () => {
    // `506264337` is a real operator. No mapping table stands between the
    // machine's idea of a person and ours.
    expect(parseAttLog(REAL)[0]!.nik).toBe("506264337");
  });

  /*
   * The device sends local wall-clock text with no zone, so the string is kept
   * as a string. Turning it into a `Date` would bind it to whatever zone the
   * process runs in — which is exactly how the binary client reported this
   * same 08:29:34 tap as 00:29:34Z.
   */
  test("the time is kept as the machine wrote it", () => {
    expect(parseAttLog(REAL)[0]!.at).toBe("2026-09-11 08:29:34");
  });

  /* Pinned against the machine's own web interface, which labelled the
     `Status 0` rows "IN". */
  test("status 0 is an arrival, status 1 a departure", () => {
    const [first, second] = parseAttLog(REAL);
    expect(first!.direction).toBe("in");
    expect(second!.direction).toBe("out");
  });

  test("the verification method comes through", () => {
    expect(parseAttLog(REAL)[0]!.verified).toBe(1);
  });

  test("an empty log is no taps, not a failure", () => {
    expect(parseAttLog("<GetAttLogResponse>\n</GetAttLogResponse>")).toEqual(
      []
    );
  });

  /*
   * Fifty-eight machines and two firmwares read so far. A row carrying a field
   * we have never seen must not take the whole pull down with it — the taps we
   * do understand are still the morning's attendance.
   */
  test("an unfamiliar field is ignored, not fatal", () => {
    const odd =
      "<GetAttLogResponse>\n<Row><PIN>1</PIN><DateTime>2026-09-11 08:00:00</DateTime>" +
      "<Verified>1</Verified><Status>0</Status><WorkCode>0</WorkCode><Sesuatu>x</Sesuatu></Row>\n</GetAttLogResponse>";
    expect(parseAttLog(odd)).toHaveLength(1);
  });

  /* A row missing what identifies it is not a tap. Dropping it keeps one bad
     record from being read as somebody's arrival. */
  test("a row with no PIN or no time is dropped", () => {
    const broken =
      "<GetAttLogResponse>\n<Row><PIN></PIN><DateTime>2026-09-11 08:00:00</DateTime><Status>0</Status></Row>\n" +
      "<Row><PIN>2</PIN><DateTime></DateTime><Status>0</Status></Row>\n</GetAttLogResponse>";
    expect(parseAttLog(broken)).toEqual([]);
  });

  /* An unreachable machine answers with nothing at all. */
  test("rubbish in is no taps out", () => {
    expect(parseAttLog("")).toEqual([]);
    expect(parseAttLog("<html>401 Unauthorized</html>")).toEqual([]);
  });
});
