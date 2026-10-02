/**
 * The Operations Center's arithmetic, kept apart from its components so the
 * readings people act on — "terlewat", an error rate, a stale scheduler — are
 * tested rather than eyeballed.
 */

import type { BadgeVariant } from "@/components/ui/badge";

/** How long ago, in the shorthand a status page is scanned at. */
export function sinceLabel(iso: string | null, now = new Date()): string {
  if (!iso) return "—";
  const seconds = Math.max(
    0,
    Math.floor((now.getTime() - new Date(iso).getTime()) / 1000)
  );
  if (seconds < 60) return "baru saja";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} m lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} j ${minutes % 60} m lalu`;
  return `${Math.floor(hours / 24)} h lalu`;
}

export type Freshness = "fresh" | "stale" | "missing";

/** Whether a heartbeat is recent enough to believe. */
export function freshness(
  iso: string | null,
  now: Date,
  staleAfterSeconds: number
): Freshness {
  if (!iso) return "missing";
  const age = (now.getTime() - new Date(iso).getTime()) / 1000;
  return age > staleAfterSeconds ? "stale" : "fresh";
}

/**
 * One stage's state on its muster.
 *
 * "Terlewat" is the one that matters: a stage whose moment has come and which
 * the scheduler never claimed. Nothing else on any screen says so — the stage
 * simply did not happen. Whether the moment has come is the API's call
 * (`due`), made against the stage's own muster date, because after midnight
 * the night muster under way began yesterday and a bare clock comparison
 * reads its gates as still ahead.
 */
export function stageStatus(stage: {
  due: boolean;
  active: boolean;
  fired: boolean;
  lastRun: { at: string; ok: boolean; note: string } | null;
}): { label: string; tone: BadgeVariant } {
  if (!stage.active) return { label: "Nonaktif", tone: "neutral" };
  if (stage.fired && stage.lastRun?.ok === false)
    return { label: "Gagal", tone: "danger" };
  if (stage.fired) return { label: "Sudah jalan", tone: "success" };
  if (stage.due) return { label: "Terlewat", tone: "warning" };
  return { label: "Menunggu", tone: "neutral" };
}

type Minute = {
  at: string;
  requests: number;
  clientErrors: number;
  serverErrors: number;
  avgMs: number;
  maxMs: number;
};

/** The window's totals; the average weighted by how many requests each minute had. */
export function apiTotals(minutes: Minute[]) {
  const requests = minutes.reduce((sum, m) => sum + m.requests, 0);
  const clientErrors = minutes.reduce((sum, m) => sum + m.clientErrors, 0);
  const serverErrors = minutes.reduce((sum, m) => sum + m.serverErrors, 0);
  const weighted = minutes.reduce((sum, m) => sum + m.avgMs * m.requests, 0);
  return {
    requests,
    clientErrors,
    serverErrors,
    errorRate: requests
      ? Math.round(((clientErrors + serverErrors) / requests) * 1000) / 10
      : 0,
    avgMs: requests ? Math.round(weighted / requests) : 0,
    maxMs: minutes.reduce((max, m) => Math.max(max, m.maxMs), 0),
  };
}

const clockOf = (iso: string) => {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes()
  ).padStart(2, "0")}`;
};

/** Chart rows: successes, client errors and server errors stack to the total. */
export function minuteRows(minutes: Minute[]) {
  return minutes.map((m) => ({
    time: clockOf(m.at),
    ok: m.requests - m.clientErrors - m.serverErrors,
    client: m.clientErrors,
    server: m.serverErrors,
    avgMs: m.avgMs,
    maxMs: m.maxMs,
  }));
}

/** "Chrome · Windows" out of a user-agent string. */
export function browserOf(userAgent: string | null): string {
  if (!userAgent) return "—";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Firefox\//.test(userAgent)
      ? "Firefox"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : "Lainnya";
  const system = /Android/.test(userAgent)
    ? "Android"
    : /iPhone|iPad/.test(userAgent)
      ? "iOS"
      : /Windows/.test(userAgent)
        ? "Windows"
        : /Mac OS X/.test(userAgent)
          ? "macOS"
          : /Linux/.test(userAgent)
            ? "Linux"
            : null;
  return system ? `${browser} · ${system}` : browser;
}

const NOTIFICATION_TEXT: Record<string, string> = {
  "allocation-generated": "Board alokasi dibuat",
  "allocation-failed": "Board alokasi gagal dibuat",
  "device-log-sizes": "Ukuran log mesin dilaporkan",
};

export type AlertItem = {
  at: string;
  tone: "danger" | "warning";
  source: "API" | "Timeline" | "Notifikasi";
  text: string;
};

/**
 * Everything worth a look, in one list: server errors, stage runs that did
 * not do their job, and notifications that came in amber or red. Successes
 * stay off it — a feed that also lists what went right is one nobody reads.
 */
export function alertFeed(input: {
  api: {
    errors: { at: string; route: string; status: number; name: string }[];
  };
  stageLog: { at: string; name: string; ok: boolean; note: string }[];
  notifications: {
    createdAt: string;
    kind: string;
    tone: string;
    params: Record<string, unknown>;
  }[];
}): AlertItem[] {
  const items: AlertItem[] = [
    ...input.api.errors.map((error) => ({
      at: error.at,
      tone: "danger" as const,
      source: "API" as const,
      text: `${error.status} ${error.name} — ${error.route}`,
    })),
    ...input.stageLog
      .filter((run) => !run.ok)
      .map((run) => ({
        at: run.at,
        tone: "warning" as const,
        source: "Timeline" as const,
        text: `${run.name}: ${run.note}`,
      })),
    ...input.notifications
      .filter((n) => n.tone === "danger" || n.tone === "warning")
      .map((n) => ({
        at: n.createdAt,
        tone: n.tone as "danger" | "warning",
        source: "Notifikasi" as const,
        text: NOTIFICATION_TEXT[n.kind] ?? n.kind,
      })),
  ];
  return items.sort((a, b) => b.at.localeCompare(a.at));
}
