import { describe, expect, test } from "bun:test";

import type { PlanDefaultInfo, PlanResetPreview } from "@universe/contracts";

import { canConfirmReset, defaultLine, resetSummary } from "./plan-default";

const text = { none: "No default yet", prefix: "Default:", pairs: "pairings" };
const dateOf = (iso: string) => iso.slice(0, 10);

const info: PlanDefaultInfo = {
  fileName: "plan.xlsx",
  actorName: "Budi",
  createdAt: "2026-10-29T08:00:00.000Z",
  pairs: 42,
};

const entry = { unit: "RD5001", nik: "1", name: "A" };
const previewOf = (
  parts: Partial<PlanResetPreview> = {}
): PlanResetPreview => ({
  release: [],
  assign: [],
  skipped: [],
  unchanged: 0,
  defaultInfo: info,
  ...parts,
});

describe("defaultLine", () => {
  test("names the file, date, author and size", () => {
    expect(defaultLine(info, text, dateOf)).toBe(
      "Default: plan.xlsx · 2026-10-29 · Budi · 42 pairings"
    );
  });

  test("asks for an upload when there is no default", () => {
    expect(defaultLine(null, text, dateOf)).toBe("No default yet");
    expect(defaultLine(undefined, text, dateOf)).toBe("No default yet");
  });

  test("leaves out an unknown author instead of printing a gap", () => {
    expect(defaultLine({ ...info, actorName: null }, text, dateOf)).toBe(
      "Default: plan.xlsx · 2026-10-29 · 42 pairings"
    );
  });
});

describe("resetSummary", () => {
  test("counts each list and flags an empty diff", () => {
    expect(resetSummary(previewOf())).toEqual({
      release: 0,
      assign: 0,
      skipped: 0,
      empty: true,
    });
    expect(
      resetSummary(
        previewOf({
          release: [entry],
          assign: [entry, entry],
          skipped: [{ ...entry, reason: "x" }],
        })
      )
    ).toEqual({ release: 1, assign: 2, skipped: 1, empty: false });
  });

  test("a diff with only skipped pairings has nothing to change", () => {
    expect(
      resetSummary(previewOf({ skipped: [{ ...entry, reason: "x" }] })).empty
    ).toBe(true);
  });
});

describe("canConfirmReset", () => {
  const live = previewOf({ release: [entry] });

  test("is open only for a loaded, non-empty diff with nothing pending", () => {
    expect(
      canConfirmReset({
        preview: live,
        loading: false,
        pending: false,
        failed: false,
      })
    ).toBe(true);
  });

  test("is closed while loading, pending, missing or empty", () => {
    expect(
      canConfirmReset({
        preview: live,
        loading: true,
        pending: false,
        failed: false,
      })
    ).toBe(false);
    expect(
      canConfirmReset({
        preview: live,
        loading: false,
        pending: true,
        failed: false,
      })
    ).toBe(false);
    expect(
      canConfirmReset({
        preview: undefined,
        loading: false,
        pending: false,
        failed: false,
      })
    ).toBe(false);
    expect(
      canConfirmReset({
        preview: previewOf(),
        loading: false,
        pending: false,
        failed: false,
      })
    ).toBe(false);
  });

  test("is closed when the last refresh failed, even with an old diff kept", () => {
    // TanStack Query keeps the previous data on a failed refetch; that diff
    // was never confirmed against today's plan.
    expect(
      canConfirmReset({
        preview: live,
        loading: false,
        pending: false,
        failed: true,
      })
    ).toBe(false);
  });
});
