import type { RosterCode, RosterLegendGroupId } from "@universe/contracts";

import type { Dict } from "@/lib/i18n";

/**
 * What is left of the roster's static module: presentation, and only
 * presentation.
 *
 * The documents, the grid, and the validation rows used to live here as sample
 * arrays; they come from the API now. What stays is the pair of things the API
 * has no opinion about — which colour a code is rendered in, and what a code and
 * a legend group are *called* in each language.
 *
 * The grouping itself moved to `@universe/contracts` (design D2), because the
 * legend is a fixed vocabulary the database and the API also read. Only the
 * words are here, because only the words are translated.
 */

/** Cell colour for a roster code. */
export function rosterCodeColor(c: string): string {
  if (["OFF", "CR", "AL", "LWP", "LWOP", "PH", "PHD"].includes(c))
    return "var(--text-tertiary)";
  if (["S", "SICK", "A", "ISM", "OBC", "KRT", "TERM", "RSG", "EOC"].includes(c))
    return "var(--color-danger-text)";
  if (c === "N") return "var(--color-primary-bright)";
  return "var(--text-secondary)";
}

/**
 * Legend group id → dictionary key.
 *
 * A map rather than a template string (`lg${id}`) so that a group added to
 * contracts without a translation is a type error here rather than a blank
 * heading in production.
 */
const GROUP_LABEL: Record<RosterLegendGroupId, keyof Dict> = {
  shift: "lgShift",
  leave: "lgLeave",
  absence: "lgAbsence",
  medical: "lgMedical",
  assignment: "lgAssignment",
  employment: "lgEmployment",
};

export const legendGroupLabel = (t: Dict, id: RosterLegendGroupId): string =>
  t[GROUP_LABEL[id]];

/** Roster code → dictionary key, for the same reason. */
const CODE_LABEL: Record<RosterCode, keyof Dict> = {
  D: "rcD",
  N: "rcN",
  R: "rcR",
  STB: "rcSTB",
  OFF: "rcOFF",
  CR: "rcCR",
  AL: "rcAL",
  LWP: "rcLWP",
  LWOP: "rcLWOP",
  PH: "rcPH",
  PHD: "rcPHD",
  S: "rcS",
  SICK: "rcSICK",
  A: "rcA",
  MCU: "rcMCU",
  MCR: "rcMCR",
  MCUF: "rcMCUF",
  ISM: "rcISM",
  OBC: "rcOBC",
  KRT: "rcKRT",
  TGS: "rcTGS",
  DNS: "rcDNS",
  TRV: "rcTRV",
  TR: "rcTR",
  TRS: "rcTRS",
  IN: "rcIN",
  TERM: "rcTERM",
  EOC: "rcEOC",
  RSG: "rcRSG",
};

export const rosterCodeLabel = (t: Dict, code: RosterCode): string =>
  t[CODE_LABEL[code]];

/** "D — Shift siang", the form the revision form's dropdown offers. */
export const rosterCodeOption = (t: Dict, code: RosterCode): string =>
  `${code} — ${rosterCodeLabel(t, code)}`;
