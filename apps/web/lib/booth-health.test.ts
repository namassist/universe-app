import { describe, expect, test } from "bun:test";

import {
  boothHealthView,
  isBoothProblem,
  matchesReadiness,
} from "./booth-health";

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

describe("the readiness filter on the registry page", () => {
  const active = (
    health: Parameters<typeof matchesReadiness>[0]["health"]
  ) => ({
    active: true,
    health,
  });

  test("no filter shows every machine, inactive ones included", () => {
    expect(matchesReadiness({ active: false, health: "unchecked" }, "")).toBe(
      true
    );
    expect(matchesReadiness(active("offline"), "")).toBe(true);
  });

  test("ready is the machine and its printer both answering, nothing else", () => {
    expect(matchesReadiness(active("ready"), "ready")).toBe(true);
    expect(matchesReadiness(active("printer_offline"), "ready")).toBe(false);
  });

  test("problem gathers every way a tap does not become a slip", () => {
    for (const h of [
      "offline",
      "printer_offline",
      "printer_inactive",
      "no_printer",
      "unchecked",
    ] as const)
      expect(matchesReadiness(active(h), "problem")).toBe(true);
    expect(matchesReadiness(active("ready"), "problem")).toBe(false);
  });

  /* The two halves of "online salah satu" are kept apart: they send a
     technician to different devices. */
  test("a dead machine and a dead printer are separate choices", () => {
    expect(matchesReadiness(active("offline"), "offline")).toBe(true);
    expect(matchesReadiness(active("printer_offline"), "offline")).toBe(false);
    expect(matchesReadiness(active("printer_offline"), "printer_offline")).toBe(
      true
    );
  });

  test("a missing or switched-off printer is one choice — a setting, not an outage", () => {
    expect(matchesReadiness(active("no_printer"), "setting")).toBe(true);
    expect(matchesReadiness(active("printer_inactive"), "setting")).toBe(true);
    expect(matchesReadiness(active("printer_offline"), "setting")).toBe(false);
  });

  /* An inactive machine is not probed, so it has no readiness to match. */
  test("any readiness choice leaves inactive machines out", () => {
    const off = { active: false, health: "ready" as const };
    for (const f of ["ready", "problem", "offline", "unchecked"] as const)
      expect(matchesReadiness(off, f)).toBe(false);
  });
});
