"use client";

import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Clock,
} from "lucide-react";

import { SHIFT_KIND_LABELS } from "@universe/contracts";

import { isStatus } from "@/lib/api";
import {
  fitWorkDisplayQueryOptions,
  type FitWorkDisplayRow,
} from "@/lib/queries/readiness-display";
import { FTW_CAT_BADGE, ftwCatOf } from "@/components/menus/fit-to-work-shared";

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

const VERDICT: Record<
  FitWorkDisplayRow["verdict"],
  { tone: DisplayTone; label: string }
> = {
  pass: { tone: "success", label: "Lolos FTW" },
  fail: { tone: "danger", label: "Tidak lolos" },
  late: { tone: "warning", label: "Terlambat" },
  missing: { tone: "danger", label: "Belum FTW" },
  unreadable: { tone: "warning", label: "Tak terbaca" },
  "not-required": { tone: "neutral", label: "Tidak diminta" },
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
        {
          icon: <ClipboardCheck className="text-(--color-primary-bright)" />,
          iconClass: "bg-(--badge-info-fill) border-(--badge-info-border)",
          value: String(data?.filed ?? 0),
          label: "Sudah Lapor",
        },
        {
          icon: <CheckCircle2 className="text-(--badge-success-text)" />,
          iconClass:
            "bg-(--badge-success-fill) border-(--badge-success-border)",
          value: String(data?.passed ?? 0),
          label: "Lolos FTW",
        },
        /* The two halves of "filed but not cleared", kept apart because they
           send a supervisor to different places: one man waits an hour, the
           other does not work today. Together with Lolos FTW they add up to
           Sudah Lapor exactly. */
        {
          icon: <Clock className="text-(--badge-warning-text)" />,
          iconClass:
            "bg-(--badge-warning-fill) border-(--badge-warning-border)",
          value: String(data?.rest ?? 0),
          label: "Istirahat",
        },
        {
          icon: <AlertTriangle className="text-(--color-danger-text)" />,
          iconClass: "bg-(--badge-danger-fill) border-(--badge-danger-border)",
          value: String(data?.notPassed ?? 0),
          label: "Tidak Lolos",
        },
      ]}
    >
      <DisplayCards
        items={rows.map((r) => {
          const resting = ftwCatOf(r.sleepCategory) === "istirahat";
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
                <span className="truncate text-[34px] leading-tight font-bold">
                  {r.name}
                </span>
                <span className="font-mono text-xl text-(--text-secondary) tabular-nums">
                  NIK {r.nik}
                </span>
              </CardField>,

              <CardField
                key="org"
                label="Perusahaan / Posisi / Dept"
                className="w-[20%] flex-none"
              >
                <span className="truncate text-xl font-semibold">
                  {r.company ?? "—"}
                </span>
                <span className="truncate text-xl text-(--text-secondary)">
                  {r.position ?? "—"}
                </span>
                <span className="truncate text-xl text-(--text-secondary)">
                  {r.department ?? "—"}
                </span>
              </CardField>,

              /* The verdict block. Two badges because savera can say two
                 things: its category, and the decision it signed — and where
                 those disagree is precisely why the card is on the wall. */
              <CardField key="call" label="Keputusan" className="flex-1">
                <span className="flex flex-wrap items-center gap-3">
                  <DisplayBadge tone={FTW_CAT_BADGE[ftwCatOf(r.sleepCategory)]}>
                    {r.sleepCategory ?? VERDICT[r.verdict].label}
                  </DisplayBadge>
                  {r.sleepCategory ? (
                    <DisplayBadge tone={VERDICT[r.verdict].tone}>
                      {VERDICT[r.verdict].label}
                    </DisplayBadge>
                  ) : null}
                </span>
                {r.ftwDecision ? (
                  <span className="truncate text-lg text-(--text-secondary)">
                    {r.ftwDecision}
                  </span>
                ) : null}
              </CardField>,

              <CardField
                key="sleep"
                label="Tidur efektif"
                className="w-[11%] flex-none"
              >
                <span className="font-mono text-[30px] leading-tight font-bold tabular-nums">
                  {sleepText(r.sleepMinutes)}
                </span>
              </CardField>,

              /* Pinned right, boxed, and the only cyan on the card: the one
                 number a supervisor reads off to ask "before or after the
                 deadline". An unfiled row has none, and says so rather than
                 leaving the box empty. */
              <div
                key="sent"
                className="w-[180px] flex-none rounded-panel border border-(--divider) bg-(--fill-subtle) px-6 py-4"
              >
                <span className="text-[15px] font-semibold tracking-[.12em] text-(--text-tertiary) uppercase">
                  Jam Upload
                </span>
                <div
                  className={
                    r.sentAt
                      ? "font-mono text-[38px] leading-tight font-bold text-(--color-primary-bright) tabular-nums"
                      : "text-[26px] leading-tight font-bold text-(--text-tertiary)"
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
