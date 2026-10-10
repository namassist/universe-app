import { describe, expect, test } from "bun:test";

import { boothHealthView, isBoothProblem } from "./booth-health";

describe("how a booth's health reads on screen", () => {
  test("only a ready booth is not a problem", () => {
    expect(isBoothProblem("ready")).toBe(false);
    for (const h of [
      "offline",
      "printer_offline",
      "printer_inactive",
      "no_printer",
    ] as const)
      expect(isBoothProblem(h)).toBe(true);
  });

  test("a dead printer says so, rather than calling the machine offline", () => {
    expect(boothHealthView("printer_offline").label).toBe("Printer mati");
    expect(boothHealthView("offline").label).toBe("Offline");
  });

  test("a booth without a printer is told apart from one with a dead printer", () => {
    expect(boothHealthView("no_printer").label).toBe("Tanpa printer");
    expect(boothHealthView("printer_inactive").label).toBe("Printer nonaktif");
  });

  test("a device not yet probed is never called dead", () => {
    expect(boothHealthView("unchecked").label).toBe("Belum dicek");
    expect(boothHealthView("unchecked").variant).toBe("neutral");
    expect(isBoothProblem("unchecked")).toBe(true);
  });

  test("problems are red or amber, ready is green", () => {
    expect(boothHealthView("ready").variant).toBe("success");
    expect(boothHealthView("offline").variant).toBe("danger");
    expect(boothHealthView("printer_offline").variant).toBe("danger");
    expect(boothHealthView("no_printer").variant).toBe("warning");
  });
});
