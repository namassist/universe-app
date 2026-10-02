import { describe, expect, test } from "bun:test";

import {
  alertFeed,
  apiTotals,
  browserOf,
  freshness,
  minuteRows,
  sinceLabel,
  stageStatus,
} from "./ops";

const now = new Date("2026-10-02T05:40:00");

describe("sinceLabel", () => {
  test("reads in the shorthand a status page is scanned at", () => {
    expect(sinceLabel(null, now)).toBe("—");
    expect(sinceLabel(new Date("2026-10-02T05:39:30").toISOString(), now)).toBe(
      "baru saja"
    );
    expect(sinceLabel(new Date("2026-10-02T05:35:00").toISOString(), now)).toBe(
      "5 m lalu"
    );
    expect(sinceLabel(new Date("2026-10-02T03:20:00").toISOString(), now)).toBe(
      "2 j 20 m lalu"
    );
  });
});

describe("freshness", () => {
  test("is missing, fresh, or stale against its own limit", () => {
    expect(freshness(null, now, 180)).toBe("missing");
    expect(
      freshness(new Date("2026-10-02T05:38:00").toISOString(), now, 180)
    ).toBe("fresh");
    expect(
      freshness(new Date("2026-10-02T05:30:00").toISOString(), now, 180)
    ).toBe("stale");
  });
});

describe("stageStatus", () => {
  const stage = (over: Partial<Parameters<typeof stageStatus>[0]>) => ({
    due: false,
    active: true,
    fired: false,
    lastRun: null,
    ...over,
  });

  test("a switched-off stage is off, whatever else is true", () => {
    expect(stageStatus(stage({ active: false, fired: true })).label).toBe(
      "Nonaktif"
    );
  });

  test("a stage that ran and said it failed is a failure", () => {
    expect(
      stageStatus(
        stage({
          fired: true,
          due: true,
          lastRun: { at: "", ok: false, note: "x" },
        })
      )
    ).toEqual({ label: "Gagal", tone: "danger" });
  });

  test("a stage that fired is done", () => {
    expect(stageStatus(stage({ fired: true, due: true }))).toEqual({
      label: "Sudah jalan",
      tone: "success",
    });
  });

  test("a stage whose moment has come without firing is overdue", () => {
    expect(stageStatus(stage({ due: true }))).toEqual({
      label: "Terlewat",
      tone: "warning",
    });
  });

  test("a stage still ahead is waiting", () => {
    expect(stageStatus(stage({ due: false }))).toEqual({
      label: "Menunggu",
      tone: "neutral",
    });
  });
});

describe("apiTotals", () => {
  test("sums the window and weights the average by requests", () => {
    const totals = apiTotals([
      {
        at: "",
        requests: 10,
        clientErrors: 1,
        serverErrors: 0,
        avgMs: 10,
        maxMs: 40,
      },
      {
        at: "",
        requests: 30,
        clientErrors: 0,
        serverErrors: 2,
        avgMs: 50,
        maxMs: 900,
      },
      {
        at: "",
        requests: 0,
        clientErrors: 0,
        serverErrors: 0,
        avgMs: 0,
        maxMs: 0,
      },
    ]);
    expect(totals).toEqual({
      requests: 40,
      clientErrors: 1,
      serverErrors: 2,
      errorRate: 7.5,
      avgMs: 40,
      maxMs: 900,
    });
  });

  test("an empty window is all zeros, not NaN", () => {
    expect(apiTotals([]).errorRate).toBe(0);
    expect(apiTotals([]).avgMs).toBe(0);
  });
});

describe("minuteRows", () => {
  test("labels each minute by the local clock and splits the errors out", () => {
    const at = new Date("2026-10-02T05:12:00").toISOString();
    expect(
      minuteRows([
        {
          at,
          requests: 9,
          clientErrors: 2,
          serverErrors: 1,
          avgMs: 20,
          maxMs: 80,
        },
      ])
    ).toEqual([
      { time: "05:12", ok: 6, client: 2, server: 1, avgMs: 20, maxMs: 80 },
    ]);
  });
});

describe("browserOf", () => {
  test("names the browser, not the whole user-agent string", () => {
    expect(
      browserOf(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36"
      )
    ).toBe("Chrome · Windows");
    expect(
      browserOf(
        "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0"
      )
    ).toBe("Edge · Windows");
    expect(
      browserOf(
        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36"
      )
    ).toBe("Chrome · Android");
    expect(browserOf(null)).toBe("—");
  });
});

describe("alertFeed", () => {
  test("merges server errors, failed stage runs and loud notifications, newest first", () => {
    const feed = alertFeed({
      api: {
        errors: [
          {
            at: "2026-10-02T05:30:00.000Z",
            route: "GET /v1/x",
            status: 500,
            name: "TypeError",
          },
        ],
      },
      stageLog: [
        {
          at: "2026-10-02T05:26:00.000Z",
          name: "Validasi Spare",
          ok: false,
          note: "no finger-in",
        },
        {
          at: "2026-10-02T05:00:00.000Z",
          name: "Awal Shift",
          ok: true,
          note: "ok",
        },
      ],
      notifications: [
        {
          createdAt: "2026-10-02T05:35:00.000Z",
          kind: "allocation-failed",
          tone: "danger",
          params: {},
        },
        {
          createdAt: "2026-10-02T05:36:00.000Z",
          kind: "allocation-generated",
          tone: "success",
          params: {},
        },
      ],
    });
    expect(feed.map((item) => item.source)).toEqual([
      "Notifikasi",
      "API",
      "Timeline",
    ]);
    expect(feed.every((item) => (item.tone as string) !== "success")).toBe(
      true
    );
  });
});
