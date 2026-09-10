"use client";

import {
  isAllocationFailure,
  type NotificationTone,
} from "@universe/contracts";

import type { Notif } from "@/lib/queries/notifications";

export type { Notif };

export const notifToneDot: Record<NotificationTone, string> = {
  info: "bg-(--color-primary)",
  success: "bg-(--badge-success-text)",
  warning: "bg-(--badge-warning-text)",
  danger: "bg-(--color-danger)",
};

export type Lang = "id" | "en";

const SHIFT: Record<Lang, Record<string, string>> = {
  id: { day: "pagi", night: "malam" },
  en: { day: "day", night: "night" },
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
const FAILURE: Record<Lang, Record<string, string>> = {
  id: {
    "no-shift": "stage timeline ini belum diberi shift",
    "no-finger-deadline": "stage Batas Finger In tidak aktif",
    "no-ftw-deadline": "stage Batas Upload FTW tidak aktif",
    unexpected: "kesalahan tak terduga — cek log server",
  },
  en: {
    "no-shift": "the timeline stage has no shift set",
    "no-finger-deadline": "no active finger-in stage",
    "no-ftw-deadline": "no active FTW upload deadline",
    unexpected: "unexpected error — check the server log",
  },
};

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" ? v : 0);

/**
 * The sentence, composed here rather than stored.
 *
 * The row holds what happened and the facts about it; the wording is this
 * client's, in the language it is set to. An unknown kind falls back to its
 * own name — an older page against a newer API should say "something happened
 * I do not recognise", not render blank.
 */
export function notifText(n: Notif, lang: Lang): string {
  const p = n.params ?? {};
  const shift = SHIFT[lang][str(p.shift)] ?? str(p.shift);
  const date = str(p.date);

  if (n.kind === "allocation-generated") {
    const crewed = num(p.crewed);
    const units = num(p.units);
    return lang === "id"
      ? `Papan shift ${shift} ${date} selesai digenerate — ${crewed} dari ${units} unit dapat operator`
      : `${shift} board for ${date} generated — ${crewed} of ${units} units crewed`;
  }

  if (n.kind === "allocation-failed") {
    const reason = str(p.reason);
    const why = isAllocationFailure(reason) ? FAILURE[lang][reason] : reason;
    return lang === "id"
      ? `Generate papan shift ${shift} ${date} gagal — ${why}`
      : `${shift} board for ${date} failed to generate — ${why}`;
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
  const ago = Math.max(0, now - new Date(iso).getTime());
  if (ago < MINUTE) return lang === "id" ? "Baru saja" : "Just now";
  if (ago < HOUR) {
    const n = Math.floor(ago / MINUTE);
    return lang === "id"
      ? `${n} menit lalu`
      : `${n} minute${n > 1 ? "s" : ""} ago`;
  }
  if (ago < DAY) {
    const n = Math.floor(ago / HOUR);
    return lang === "id" ? `${n} jam lalu` : `${n} hour${n > 1 ? "s" : ""} ago`;
  }
  const n = Math.floor(ago / DAY);
  if (n === 1) return lang === "id" ? "Kemarin" : "Yesterday";
  return lang === "id" ? `${n} hari lalu` : `${n} days ago`;
}
