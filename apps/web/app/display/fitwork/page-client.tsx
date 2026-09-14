"use client";

import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Ban, Clock, HeartPulse } from "lucide-react";

import { SHIFT_KIND_LABELS } from "@universe/contracts";

import { isStatus } from "@/lib/api";
import {
  fitWorkDisplayQueryOptions,
  type FitWorkDisplayRow,
} from "@/lib/queries/readiness-display";

import { CardField, DisplayCards } from "../_components/display-cards";
import { DisplayShell } from "../_components/display-shell";
import { DisplayBadge, type DisplayTone } from "../_components/display-table";

/**
 * Fit To Work kiosk — the running shift's roster against savera's verdicts.
 *
 * Cards rather than a table (owner, 2026-09-14). Seven columns on one line
 * wrapped "Yohanes Novensius Wangge" to three rows while cutting "Istirahat
 * Minimal 2 Jam" off at the edge, and at six metres a reader lost track of
 * which line belonged to whom. A card gives each person a block of their own.
 *
 * Same bargain as the attendance wall otherwise: the list is the exception
 * list, worst first and capped, while the tiles count the whole shift.
 *
 * The four verdicts a filing can carry are kept apart rather than folded into
 * "tidak lolos", because they send a supervisor to different places. `fail` is
 * a medical answer, `late` an administrative one, and `unreadable` is savera
 * having reworded a verdict — our problem, not the operator's, and invisible
 * if it were merged into a refusal.
 */

/**
 * What refused this person, in the words a supervisor acts on.
 *
 * "Tidak lolos" alone was ambiguous (owner, 2026-09-14): it stood for the
 * clinic refusing on medical grounds and for our own rule refusing on grounds
 * of its own, and only one of those is anybody here's to chase.
 */
const GROUP: Record<
  FitWorkDisplayRow["group"],
  { tone: DisplayTone; label: string }
> = {
  none: { tone: "danger", label: "Belum upload FTW" },
  /* Both read the same on a badge: the difference is in the line under it,
     which names what refused him. */
  ftwFail: { tone: "danger", label: "Tidak Lolos FTW" },
  allocFail: { tone: "danger", label: "Tidak Lolos FTW" },
  rest: { tone: "warning", label: "Istirahat" },
  fit: { tone: "success", label: "Lolos FTW" },
};

/** Why our own rule refused, when it was ours that did. */
const OUR_REASON: Partial<Record<FitWorkDisplayRow["verdict"], string>> = {
  late: "Upload lewat batas waktu",
  unreadable: "Vonis savera tidak dikenali",
};

/** 445 → "7j 25m". Minutes as savera's rules actually counted them. */
function sleepText(minutes: number | null): string {
  if (minutes === null || minutes <= 0) return "—";
  const h = Math.floor(minutes / 60);
  return h ? `${h}j ${String(minutes % 60).padStart(2, "0")}m` : `${minutes}m`;
}

export default function DisplayFitworkPage() {
  const deviceName = useSearchParams().get("name") ?? undefined;
  const { data, error, isError, dataUpdatedAt } = useQuery(
    fitWorkDisplayQueryOptions()
  );

  const authProblem = isStatus(error, 401) || isStatus(error, 403);
  const disconnected = isError && !authProblem;

  const rows = data?.rows ?? [];
  const shiftLabel = data?.shift ? SHIFT_KIND_LABELS[data.shift] : null;
  /* Everyone the wall would show if it had room — the cleared are not among
     them, so this is not `total - rows.length`. */
  const exceptions = data ? data.total - data.passed : 0;

  return (
    <DisplayShell
      title={shiftLabel ? `Fit To Work — Shift ${shiftLabel}` : "Fit To Work"}
      deviceName={deviceName}
      displayKind="fitwork"
      disconnected={disconnected}
      staleSince={dataUpdatedAt || null}
      meta={
        /*
         * Three things this line has to keep straight, because the table now
         * holds neither the roster nor a simple slice of it.
         *
         * "terjadwal" would be a lie: the roster is larger, and the difference
         * is every operator nobody asks for a filing. "N dari M" would be
         * another one — the rows left out are not left out for space, they are
         * the people who are fine. And when nothing needs seeing to, an empty
         * table with a count above it reads as a screen that failed to load,
         * so it says so in words.
         */
        data?.date ? (
          <span className="truncate">
            {exceptions === 0
              ? `Semua ${data.total} orang wajib FTW sudah lolos`
              : rows.length < exceptions
                ? `${rows.length} dari ${exceptions} yang perlu dilihat — dari ${data.total} orang wajib FTW`
                : `${exceptions} perlu dilihat dari ${data.total} orang wajib FTW`}
          </span>
        ) : (
          <span className="truncate">Menunggu jadwal shift dari timeline</span>
        )
      }
      stats={[
        /*
         * The wall's own headcount, then the three reasons that divide it.
         *
         * "Sudah Lapor" and "Lolos FTW" were here and are gone (owner,
         * 2026-09-14): they counted people this screen does not show, and a
         * wall of exceptions that leads with two numbers about everybody else
         * buries the one a supervisor acts on.
         */
        {
          icon: <Ban className="text-(--color-danger-text)" />,
          iconClass: "bg-(--badge-danger-fill) border-(--badge-danger-border)",
          value: String(data?.allocFailed ?? 0),
          label: "Tidak Lolos Alokasi",
        },
        {
          icon: <AlertTriangle className="text-(--color-danger-text)" />,
          iconClass: "bg-(--badge-danger-fill) border-(--badge-danger-border)",
          value: String(data?.missing ?? 0),
          label: "Belum Upload",
        },
        {
          icon: <HeartPulse className="text-(--color-danger-text)" />,
          iconClass: "bg-(--badge-danger-fill) border-(--badge-danger-border)",
          value: String(data?.ftwFailed ?? 0),
          label: "Tidak Lolos FTW",
        },
        {
          icon: <Clock className="text-(--badge-warning-text)" />,
          iconClass:
            "bg-(--badge-warning-fill) border-(--badge-warning-border)",
          value: String(data?.rest ?? 0),
          label: "Istirahat",
        },
      ]}
    >
      <DisplayCards
        items={rows.map((r) => {
          const resting = r.group === "rest";
          return {
            key: r.nik,
            /* Yellow behind a man told to rest, red behind everybody else on
               the wall. Every row here is an exception now — the cleared are
               counted in the tile above and never rendered — so the question
               is only which kind, and "wait an hour" is not "do not work". */
            tone: resting ? ("warning" as const) : ("danger" as const),
            /* Read before any of the words are: a wait, or a stop. */
            mark: resting ? "~" : "!",
            cells: [
              <CardField
                key="who"
                label="Operator"
                className="w-[23%] flex-none"
              >
                <span className="truncate text-[26px] leading-tight font-bold">
                  {r.name}
                </span>
                <span className="font-mono text-[15px] text-(--text-secondary) tabular-nums">
                  NIK {r.nik}
                </span>
              </CardField>,

              <CardField
                key="org"
                label="Perusahaan / Posisi / Dept"
                className="w-[20%] flex-none"
              >
                <span className="truncate text-[16px] font-semibold">
                  {r.company ?? "—"}
                </span>
                <span className="truncate text-[16px] text-(--text-secondary)">
                  {r.position ?? "—"}
                </span>
                <span className="truncate text-[16px] text-(--text-secondary)">
                  {r.department ?? "—"}
                </span>
              </CardField>,

              /*
               * One badge, saying the thing to be acted on (owner,
               * 2026-09-14). Two of them repeated each other on most rows —
               * "Belum ada vonis" beside "Belum FTW", "Istirahat Minimal 1
               * Jam" beside "Istirahat" — and two badges that agree teach a
               * reader to stop reading the second one.
               *
               * Which text wins depends on the row, because the useful half
               * moves. For a man told to rest it is savera's own wording: the
               * badge has to carry whether he waits one hour or two. For a
               * refusal it is our verdict, because his category may read
               * "Dapat Bekerja" and a badge saying so would look like a
               * clearance. Nothing is lost either way — the line underneath
               * carries whatever the badge did not.
               */
              <CardField key="call" label="Keputusan" className="flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <DisplayBadge size="sm" tone={GROUP[r.group].tone}>
                    {r.group === "rest" && r.sleepCategory
                      ? r.sleepCategory
                      : GROUP[r.group].label}
                  </DisplayBadge>
                </span>
                <span className="truncate text-[15px] text-(--text-secondary)">
                  {[
                    r.group === "rest" ? null : r.sleepCategory,
                    r.ftwDecision,
                    OUR_REASON[r.verdict],
                  ]
                    .filter(Boolean)
                    .join(" · ") || "\u2014"}
                </span>
              </CardField>,

              <CardField
                key="sleep"
                label="Tidur efektif"
                className="w-[11%] flex-none"
              >
                <span className="font-mono text-[22px] leading-tight font-bold tabular-nums">
                  {sleepText(r.sleepMinutes)}
                </span>
              </CardField>,

              /* Pinned right, boxed, and the only cyan on the card: the one
                 number a supervisor reads off to ask "before or after the
                 deadline". An unfiled row has none, and says so rather than
                 leaving the box empty. */
              <div
                key="sent"
                className="w-[136px] flex-none rounded-card border border-(--divider) bg-(--fill-subtle) px-4 py-2.5"
              >
                <span className="text-[12px] font-semibold tracking-[.12em] text-(--text-tertiary) uppercase">
                  Jam Upload
                </span>
                <div
                  className={
                    r.sentAt
                      ? "font-mono text-[28px] leading-tight font-bold text-(--color-primary-bright) tabular-nums"
                      : "text-[19px] leading-tight font-bold text-(--text-tertiary)"
                  }
                >
                  {r.sentAt ? r.sentAt.slice(0, 5) : "Belum"}
                </div>
              </div>,
            ],
          };
        })}
      />
    </DisplayShell>
  );
}
