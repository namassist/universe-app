"use client";

import {
  isAllocationFailure,
  type AllocationFailure,
  type NotificationTone,
} from "@universe/contracts";

import { en } from "@/lib/i18n/en";
import { fmt } from "@/lib/i18n/fmt";
import { id, type Dict } from "@/lib/i18n/id";
import type { Notif } from "@/lib/queries/notifications";

export type { Notif };

export const notifToneDot: Record<NotificationTone, string> = {
  info: "bg-(--color-primary)",
  success: "bg-(--badge-success-text)",
  warning: "bg-(--badge-warning-text)",
  danger: "bg-(--color-danger)",
};

export type Lang = "id" | "en";

const DICT: Record<Lang, Dict> = { id, en };

const SHIFT: Record<string, keyof Dict> = {
  day: "ntxShiftDay",
  night: "ntxShiftNight",
};

/**
 * Why a board could not be built, said in a way somebody can act on.
 *
 * Each of the first three names the stage to go and fix, because that is the
 * whole remedy. `unexpected` deliberately says where to look rather than what
 * happened: the API withholds the thrown error's own text, which routinely
 * carries a connection string, and pretending to more detail than we have
 * would send the reader hunting for a message that is not there.
 */
const FAILURE: Record<AllocationFailure, keyof Dict> = {
  "no-shift": "ntxFailNoShift",
  "no-finger-deadline": "ntxFailNoFinger",
  "no-ftw-deadline": "ntxFailNoFtw",
  unexpected: "ntxFailUnexpected",
};

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" ? v : 0);

/**
 * The sentence, composed here rather than stored.
 *
 * The row holds what happened and the facts about it; the wording is this
 * client's, in the language it is set to. An unknown kind falls back to its
 * own name — an older page against a newer API should say "something happened
 * I do not recognise", not render blank — which is also why `kind` is any
 * string: the ops feed carries kinds this union may not know yet.
 */
export function notifText(
  n: { kind: string; params: Notif["params"] },
  lang: Lang
): string {
  const t = DICT[lang];
  const p = n.params ?? {};
  const shiftKey = SHIFT[str(p.shift)];
  const shift = shiftKey ? t[shiftKey] : str(p.shift);
  const date = str(p.date);

  if (n.kind === "allocation-generated")
    return fmt(t.ntxGenerated, {
      shift,
      date,
      crewed: num(p.crewed),
      units: num(p.units),
    });

  if (n.kind === "allocation-failed") {
    const reason = str(p.reason);
    const why = isAllocationFailure(reason) ? t[FAILURE[reason]] : reason;
    return fmt(t.ntxFailed, { shift, date, why });
  }

  /* The test slip at every booth printer when the first finger opens: the
     booths that failed are named, because that is where to walk. */
  if (n.kind === "printer-test") {
    const count = `${num(p.sent)}/${num(p.total)}`;
    const failed = Array.isArray(p.failed) ? p.failed.map(str).join(", ") : "";
    return failed
      ? fmt(t.ntxSlipFailed, { shift, count, failed })
      : fmt(t.ntxSlipSent, { shift, count });
  }

  return n.kind;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "5 menit lalu", worked out now.
 *
 * The row carries the moment, never a phrase: a stored "5 menit lalu" is
 * already wrong by the time the second person reads it, and would go on being
 * wrong for as long as the row survives.
 */
export function notifTime(iso: string, lang: Lang, now = Date.now()): string {
  const t = DICT[lang];
  const ago = Math.max(0, now - new Date(iso).getTime());
  if (ago < MINUTE) return t.ntxJustNow;
  if (ago < HOUR) {
    const n = Math.floor(ago / MINUTE);
    return fmt(n > 1 ? t.ntxMinAgoN : t.ntxMinAgo1, { n });
  }
  if (ago < DAY) {
    const n = Math.floor(ago / HOUR);
    return fmt(n > 1 ? t.ntxHourAgoN : t.ntxHourAgo1, { n });
  }
  const n = Math.floor(ago / DAY);
  if (n === 1) return t.ntxYesterday;
  return fmt(t.ntxDaysAgo, { n });
}
