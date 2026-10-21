import { describe, expect, test } from "bun:test";

import {
  REPORT_DESCRIPTIONS,
  REPORT_KINDS,
  REPORT_LABELS,
  RUNTEXT_KIND_LABELS,
  RUNTEXT_KINDS,
  SHIFT_KIND_LABELS,
  SHIFT_KINDS,
  SOUND_OFFSET_MAX,
  SOUND_OFFSET_MIN,
  soundOffsetLabel,
  TIMELINE_ACTION_LABELS,
  TIMELINE_ACTIONS,
} from "@universe/contracts";

import {
  reportDescription,
  reportLabel,
  runTextKindLabel,
  shiftKindLabel,
  soundOffsetText,
  timelineActionText,
} from "./contract-labels";
import { en } from "./en";
import { id } from "./id";

/* In Indonesian every word is the one the contracts have always given it —
   moving them into the dictionary renames nothing — and English has its own. */
describe("contracts vocabulary", () => {
  test("shift kinds", () => {
    for (const k of SHIFT_KINDS) {
      expect(shiftKindLabel(id, k)).toBe(SHIFT_KIND_LABELS[k]);
      expect(shiftKindLabel(en, k)).toBeTruthy();
    }
  });

  test("reports and their descriptions", () => {
    for (const k of REPORT_KINDS) {
      expect(reportLabel(id, k)).toBe(REPORT_LABELS[k]);
      expect(reportDescription(id, k)).toBe(REPORT_DESCRIPTIONS[k]);
      expect(reportLabel(en, k)).toBeTruthy();
      expect(reportDescription(en, k)).toBeTruthy();
    }
  });

  test("timeline actions", () => {
    for (const a of TIMELINE_ACTIONS) {
      expect(timelineActionText(id, a)).toBe(TIMELINE_ACTION_LABELS[a]);
      expect(timelineActionText(en, a)).toBeTruthy();
    }
  });

  test("running-text kinds", () => {
    for (const k of RUNTEXT_KINDS) {
      expect(runTextKindLabel(id, k)).toBe(RUNTEXT_KIND_LABELS[k]);
      expect(runTextKindLabel(en, k)).toBeTruthy();
    }
  });

  test("sound offsets", () => {
    for (let m = SOUND_OFFSET_MIN; m <= SOUND_OFFSET_MAX; m++) {
      expect(soundOffsetText(id, m)).toBe(soundOffsetLabel(m));
      expect(soundOffsetText(en, m)).toBeTruthy();
    }
  });
});
