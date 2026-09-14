"use client";

import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  HeartPulse,
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
  none: { tone: "danger", label: "Belum FTW" },
  ftwFail: { tone: "danger", label: "Tidak Lolos FTW" },
  allocFail: { tone: "danger", label: "Tidak Lolos Alokasi" },
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
        /* The two refusals, then the part of the second one that expires.
           Lolos FTW + the two refusals is exactly Sudah Lapor; Istirahat sits
           inside the allocation figure and says so, because a tile a reader
           can add to the wrong total is worse than no tile. */
        {
          icon: <HeartPulse className="text-(--color-danger-text)" />,
          iconClass: "bg-(--badge-danger-fill) border-(--badge-danger-border)",
          value: String(data?.ftwFailed ?? 0),
          label: "Tidak Lolos FTW",
        },
        {
          icon: <AlertTriangle className="text-(--color-danger-text)" />,
          iconClass: "bg-(--badge-danger-fill) border-(--badge-danger-border)",
          value: String(data?.allocFailed ?? 0),
          label: "Tidak Lolos Alokasi",
        },
        {
          icon: <Clock className="text-(--badge-warning-text)" />,
          iconClass:
            "bg-(--badge-warning-fill) border-(--badge-warning-border)",
          value: String(data?.rest ?? 0),
          label: "— di antaranya Istirahat",
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

              /* The verdict block. Two badges because savera can say two
                 things: its category, and the decision it signed — and where
                 those disagree is precisely why the card is on the wall. */
              <CardField key="call" label="Keputusan" className="flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <DisplayBadge
                    size="sm"
                    tone={FTW_CAT_BADGE[ftwCatOf(r.sleepCategory)]}
                  >
                    {r.sleepCategory ?? "Belum ada vonis"}
                  </DisplayBadge>
                  <DisplayBadge size="sm" tone={GROUP[r.group].tone}>
                    {GROUP[r.group].label}
                  </DisplayBadge>
                </span>
                {/* savera's own decision, and — where our rule is the one
                    refusing — what it was that our rule objected to. */}
                <span className="truncate text-[15px] text-(--text-secondary)">
                  {[r.ftwDecision, OUR_REASON[r.verdict]]
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
