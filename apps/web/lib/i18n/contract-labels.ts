import type {
  ReportKind,
  RunTextKind,
  ShiftKind,
  TimelineAction,
} from "@universe/contracts";

import { fmt } from "./fmt";
import type { Dict } from "./id";

/*
 * The words for the contracts' own vocabularies, in the reader's language.
 *
 * The `*_LABELS` maps in `@universe/contracts` stay the one-language reference
 * the API and the printed ticket use; the web reads them from here so they
 * follow the language switch, the same way `menuLabel` does for menus.
 */

const SHIFT_KIND: Record<ShiftKind, keyof Dict> = {
  day: "shkDay",
  night: "shkNight",
};

const REPORT: Record<ReportKind, keyof Dict> = {
  "equipment-no-operator": "rpkEquipNoOp",
  "operator-no-equipment": "rpkOpNoEquip",
  "operator-no-ftw": "rpkOpNoFtw",
  "operator-no-finger": "rpkOpNoFinger",
  "final-validation": "rpkFinal",
};

const REPORT_DESCRIPTION: Record<ReportKind, keyof Dict> = {
  "equipment-no-operator": "rpdEquipNoOp",
  "operator-no-equipment": "rpdOpNoEquip",
  "operator-no-ftw": "rpdOpNoFtw",
  "operator-no-finger": "rpdOpNoFinger",
  "final-validation": "rpdFinal",
};

const TIMELINE_ACTION: Record<TimelineAction, keyof Dict> = {
  "shift-start": "tlaShiftStart",
  "ftw-deadline": "tlaFtwDeadline",
  "ftw-ingest": "tlaFtwIngest",
  "finger-in": "tlaFingerIn",
  "finger-ingest": "tlaFingerIngest",
  "roster-ingest": "tlaRosterIngest",
  "spare-validate": "tlaSpareValidate",
  "finger-second": "tlaFingerSecond",
  "bus-depart": "tlaBusDepart",
  other: "tlaOther",
};

const RUNTEXT_KIND: Record<RunTextKind, keyof Dict> = {
  hazard: "rtkHazard",
  safety: "rtkSafety",
  general: "rtkGeneral",
};

export const shiftKindLabel = (t: Dict, kind: ShiftKind): string =>
  t[SHIFT_KIND[kind]];

export const reportLabel = (t: Dict, kind: ReportKind): string =>
  t[REPORT[kind]];

export const reportDescription = (t: Dict, kind: ReportKind): string =>
  t[REPORT_DESCRIPTION[kind]];

/** An action the contracts do not know yet reads as its own value. */
export const timelineActionText = (t: Dict, action: TimelineAction): string => {
  const key = TIMELINE_ACTION[action];
  return key ? t[key] : action;
};

export const runTextKindLabel = (t: Dict, kind: RunTextKind): string =>
  t[RUNTEXT_KIND[kind]];

/** When a stage's sound plays, against the stage's own time. */
export const soundOffsetText = (t: Dict, minutes: number): string =>
  minutes === 0
    ? t.sndAtStage
    : fmt(minutes < 0 ? t.sndBefore : t.sndAfter, { n: Math.abs(minutes) });
