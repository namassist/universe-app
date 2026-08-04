import { describe, expect, test } from "bun:test";

import { normalizeNik } from "./nik";

describe("normalizeNik", () => {
  test("keeps a plain numeric NIK as-is", () => {
    expect(normalizeNik("50121018")).toBe("50121018");
  });

  test("strips a source-system prefix down to its digits", () => {
    expect(normalizeNik("KBE-UDU-0050123")).toBe("50123");
  });

  test("strips leading zeros", () => {
    expect(normalizeNik("050121018")).toBe("50121018");
  });

  test("strips whitespace and separators", () => {
    expect(normalizeNik(" 502-264 070 ")).toBe("502264070");
  });

  test("an all-zero NIK keeps its digits rather than vanishing", () => {
    // savera's recipe: if stripping zeros empties the string, fall back to
    // the digits — "0000" must not collide with "" (no NIK at all).
    expect(normalizeNik("0000")).toBe("0000");
  });

  test("empty and non-digit input normalize to empty", () => {
    expect(normalizeNik("")).toBe("");
    expect(normalizeNik(null)).toBe("");
    expect(normalizeNik(undefined)).toBe("");
    expect(normalizeNik("N/A")).toBe("");
  });
});
