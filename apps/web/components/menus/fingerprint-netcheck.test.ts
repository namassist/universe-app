import { describe, expect, test } from "bun:test";

import {
  rowHasProblem,
  runPooled,
  sortForDisplay,
  summarise,
  type NetcheckResult,
  type NetcheckRow,
} from "./fingerprint-netcheck";

const result = (
  over: Partial<NetcheckResult["finger"]> = {},
  printer: NetcheckResult["printer"] = null
): NetcheckResult => ({
  id: "x",
  finger: {
    ip: "10.0.0.1",
    port: 80,
    ping: "ok",
    web: "ok",
    zk: "ok",
    ...over,
  },
  printer,
});

const done = (name: string, r: NetcheckResult): NetcheckRow => ({
  id: name,
  name,
  state: "done",
  result: r,
});

describe("rowHasProblem", () => {
  test("every check ok is not a problem", () => {
    expect(rowHasProblem(done("A", result()))).toBe(false);
  });

  test("any failed check on the machine is a problem", () => {
    expect(rowHasProblem(done("A", result({ zk: "fail" })))).toBe(true);
  });

  test("a failed printer check is a problem", () => {
    const r = result(
      {},
      { ip: "10.0.0.2", port: 9100, ping: "ok", raw: "fail" }
    );
    expect(rowHasProblem(done("A", r))).toBe(true);
  });

  test("ping that could not run is not a problem", () => {
    const r = result(
      { ping: "unavailable" },
      { ip: "10.0.0.2", port: 9100, ping: "unavailable", raw: "ok" }
    );
    expect(rowHasProblem(done("A", r))).toBe(false);
  });

  test("a request that failed is a problem; one still running is not", () => {
    expect(rowHasProblem({ id: "a", name: "A", state: "error" })).toBe(true);
    expect(rowHasProblem({ id: "a", name: "A", state: "pending" })).toBe(false);
  });
});

describe("sortForDisplay and summarise", () => {
  const rows: NetcheckRow[] = [
    done("Mesin 11", result()),
    { id: "p", name: "Mesin 12", state: "pending" },
    done("Mesin 13", result({ ping: "fail" })),
    { id: "e", name: "Mesin 10", state: "error" },
  ];

  test("problems first, then still checking, then healthy", () => {
    expect(sortForDisplay(rows).map((r) => r.name)).toEqual([
      "Mesin 10",
      "Mesin 13",
      "Mesin 12",
      "Mesin 11",
    ]);
  });

  test("does not reorder its input", () => {
    sortForDisplay(rows);
    expect(rows[0]!.name).toBe("Mesin 11");
  });

  test("counts what has finished and what is wrong", () => {
    expect(summarise(rows)).toEqual({ total: 4, finished: 3, problems: 2 });
  });
});

describe("runPooled", () => {
  test("never has more than the limit in flight, and runs every item", async () => {
    let inFlight = 0;
    let peak = 0;
    const seen: number[] = [];
    await runPooled([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      seen.push(n);
      inFlight--;
    });
    expect(peak).toBe(3);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  test("stops taking new items once cancelled", async () => {
    const seen: number[] = [];
    let stop = false;
    await runPooled(
      [1, 2, 3, 4, 5],
      1,
      async (n) => {
        seen.push(n);
        if (n === 2) stop = true;
      },
      () => stop
    );
    expect(seen).toEqual([1, 2]);
  });
});
