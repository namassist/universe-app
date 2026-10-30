import { describe, expect, test } from "bun:test";

import type { PlanGeneratePreview } from "@universe/contracts";

import { canConfirmGenerate, generateSummary } from "./plan-generate";

const assignment = (released = false) => ({
  unit: "EX6001",
  simperCode: "EXC 1200",
  priority: 2,
  nik: "9",
  name: "Spare",
  released: released
    ? { nik: "1", name: "Holder", rosterCode: "CR", standby: false }
    : null,
});

const previewOf = (
  parts: Partial<PlanGeneratePreview> = {}
): PlanGeneratePreview => ({
  date: "2026-10-30",
  shift: "day",
  assign: [],
  unfilled: [],
  sparesLeft: 0,
  token: "t",
  ...parts,
});

describe("generateSummary", () => {
  test("counts assignments, the releases among them and the unfilled", () => {
    const summary = generateSummary(
      previewOf({
        assign: [assignment(), assignment(true)],
        unfilled: [{ unit: "EX5001", simperCode: null, priority: null }],
        sparesLeft: 3,
      })
    );
    expect(summary).toEqual({
      assign: 2,
      release: 1,
      unfilled: 1,
      sparesLeft: 3,
      empty: false,
    });
  });

  test("is empty when no spare goes anywhere", () => {
    const summary = generateSummary(
      previewOf({
        unfilled: [{ unit: "EX5001", simperCode: null, priority: null }],
      })
    );
    expect(summary.empty).toBe(true);
  });
});

describe("canConfirmGenerate", () => {
  const ready = {
    preview: previewOf({ assign: [assignment()] }),
    loading: false,
    pending: false,
    failed: false,
  };

  test("allows a freshly loaded preview with something to assign", () => {
    expect(canConfirmGenerate(ready)).toBe(true);
  });

  test("refuses while loading, pending, failed or before a preview", () => {
    expect(canConfirmGenerate({ ...ready, loading: true })).toBe(false);
    expect(canConfirmGenerate({ ...ready, pending: true })).toBe(false);
    expect(canConfirmGenerate({ ...ready, failed: true })).toBe(false);
    expect(canConfirmGenerate({ ...ready, preview: undefined })).toBe(false);
  });

  test("refuses a preview with nothing to assign", () => {
    expect(canConfirmGenerate({ ...ready, preview: previewOf() })).toBe(false);
  });
});
