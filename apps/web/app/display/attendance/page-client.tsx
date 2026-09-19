"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Fingerprint } from "lucide-react";

import { SHIFT_KIND_LABELS } from "@universe/contracts";

import { isStatus } from "@/lib/api";
import {
  attendancePhotoUrl,
  attendanceScansQueryOptions,
  type AttendanceScan,
} from "@/lib/queries/readiness-display";
import { cn } from "@/lib/utils";
import { FTW_CAT_BADGE, ftwCatOf } from "@/components/menus/fit-to-work-shared";
import { initialsOf } from "@/components/ui/avatar";

import { DisplayShell } from "../_components/display-shell";
import { OperatorFace } from "../_components/operator-face";
import { initialQueue, receive, tick, type QueueState } from "./scan-queue";

/**
 * Attendance kiosk — the person who just scanned, as a ticket.
 *
 * It used to be the list of who had not arrived. The owner turned it round
 * (2026-09-19): the screen above the booth now answers the person standing at
 * it — their face, the time the machine took, their FTW category, and where
 * their slip sent them. It states facts and judges none: whether a tap was
 * on time is the Attendance menu's question (owner, 2026-09-19). Scans that
 * land together wait their turn, three seconds each; with nobody waiting the
 * last ticket stays up, so the glass is never blank between arrivals.
 *
 * The queue itself — what is new, what waits, what gives way in a rush — is
 * `scan-queue.ts`. This file only draws it.
 */

/** How often the queue is asked whether the dwell is up; well under a second. */
const TICK_MS = 250;

/** The ticket queue, fed by the poll and advanced by a timer. */
function useTicketQueue(scans: AttendanceScan[] | undefined, polledAt: number) {
  const [state, setState] = React.useState<{
    queue: QueueState<AttendanceScan>;
    /** The poll last fed in, so each answer is received exactly once. */
    fedAt: number;
  }>(() => ({ queue: initialQueue(), fedAt: 0 }));

  /* Fed during render rather than from an effect — React's pattern for
     adjusting state to new input. Keyed on when the poll was answered, not
     on the array, which TanStack keeps identical when nothing changed. */
  if (scans && polledAt !== state.fedAt)
    setState((s) => ({ queue: receive(s.queue, scans), fedAt: polledAt }));

  React.useEffect(() => {
    const id = setInterval(
      () =>
        setState((s) => {
          const queue = tick(s.queue, Date.now());
          // Same object when nothing moved, so an idle screen does not render.
          return queue === s.queue ? s : { ...s, queue };
        }),
      TICK_MS
    );
    return () => clearInterval(id);
  }, []);

  return state.queue;
}

export default function DisplayAttendancePage() {
  const { data, error, isError, dataUpdatedAt } = useQuery(
    attendanceScansQueryOptions()
  );
  const queue = useTicketQueue(data?.scans, dataUpdatedAt);

  /* Same split as the other kiosks: an unpaired screen is a person's errand,
     a lost API is the network's, and one banner must not stand for both. */
  const authProblem = isStatus(error, 401) || isStatus(error, 403);
  const disconnected = isError && !authProblem;
  const shiftLabel = data?.shift ? SHIFT_KIND_LABELS[data.shift] : null;

  return (
    <DisplayShell
      /* Indonesian throughout (owner, 2026-09-19); the shift moved from the
         title into the line beneath it. */
      title="Display Absensi"
      /* No device-name chip here (owner, 2026-09-19): the TV's own name is
         for whoever administers it, not for the person reading their ticket. */
      displayKind="att"
      disconnected={disconnected}
      staleSince={dataUpdatedAt || null}
      meta={
        <span className="truncate">
          {shiftLabel
            ? `Shift ${shiftLabel} · Silakan scan sidik jari di mesin absen`
            : "Menunggu jadwal shift dari timeline"}
        </span>
      }
      stats={[]}
    >
      <div className="grid min-h-0 flex-1 place-items-center">
        {queue.showing ? (
          /* Keyed on the scan, so every ticket pops in afresh — including a
             second ticket for the same person later in the shift. */
          <ScanTicket
            key={queue.showing.key}
            scan={queue.showing}
            waiting={queue.waiting.length}
            skipped={queue.skipped}
          />
        ) : (
          <AwaitingScan />
        )}
      </div>
    </DisplayShell>
  );
}

/**
 * One scan, as design option A — "Split Signal" (owner, 2026-09-19).
 *
 * A cyan identity panel on the left holds the photograph, framed like a pass;
 * the record sits on the blue to its right. Top: who — name, NIK, and the
 * status pill. Then the check-in time, large and to the right, above a grid of
 * where to go: FTW across two columns, then unit, shift, area and bus.
 *
 * Sized for the 1920 canvas read from across a room — roughly half again the
 * reference's own proportions, not a straight scale of them.
 */
function ScanTicket({
  scan,
  waiting,
  skipped,
}: {
  scan: AttendanceScan;
  waiting: number;
  skipped: number;
}) {
  return (
    <article
      className={cn(
        "grid h-[760px] w-[1640px] animate-pop-in grid-cols-[30%_1fr] overflow-hidden rounded-[32px]",
        "border border-(--glass-1-border) bg-(image:--gradient-ticket)",
        "shadow-[0_0_48px_rgba(0,212,255,.18),0_30px_100px_rgba(0,0,0,.55)]"
      )}
    >
      <div className="relative flex flex-col items-center justify-center gap-8 bg-(--color-primary) text-(--color-on-cta)">
        <span className="absolute top-10 left-9 font-mono text-[15px] font-bold [writing-mode:vertical-rl]">
          KARTU KARYAWAN
        </span>
        <div className="relative aspect-[4/5] w-[300px] overflow-hidden rounded-2xl border-2 border-(--color-on-cta)/25">
          <OperatorFace
            name={scan.name}
            src={attendancePhotoUrl(scan)}
            initialsClassName="text-[110px]"
          />
        </div>
        <span className="font-mono text-lg font-bold tracking-widest">
          {initialsOf(scan.name)}
        </span>
      </div>

      <div className="flex min-w-0 flex-col px-14 py-13">
        <div className="flex items-start justify-between gap-8">
          <div className="min-w-0">
            <p className="font-mono text-lg font-bold text-(--color-primary) uppercase">
              Catatan absensi
            </p>
            <h2
              className="mt-3 line-clamp-2 text-[60px] leading-none font-bold break-words"
              title={scan.name}
            >
              {scan.name}
            </h2>
            <p className="mt-3 font-mono text-xl font-bold text-(--text-secondary) tabular-nums">
              NIK · {scan.nik}
            </p>
          </div>
          <StatusPill status={scan.status} />
        </div>

        <div className="mt-auto mb-10 flex items-baseline justify-end gap-6">
          {/* Beside the time rather than under the grid, so its coming and
              going never moves anything. Said rather than hidden: in a rush
              the oldest give way, and a screen that skipped people must not
              look as if it showed all. */}
          {waiting || skipped ? (
            <span className="mr-auto flex gap-5 text-xl font-semibold text-(--text-secondary)">
              {waiting ? <span>{waiting} antre</span> : null}
              {skipped ? <span>+{skipped} lainnya</span> : null}
            </span>
          ) : null}
          <span className="text-xl font-bold text-(--text-secondary)">
            Jam masuk
          </span>
          <time className="font-mono text-[96px] leading-none font-bold tabular-nums">
            {scan.scannedAt}
          </time>
        </div>

        <div className="grid grid-cols-3 gap-4">
          {/* Coloured as the Fit to Work page colours its badge — one rule,
              so the booth and the office never disagree about a category. */}
          <Datum
            label="Kategori FTW"
            value={scan.ftw}
            tone={FTW_CAT_BADGE[ftwCatOf(scan.ftw)]}
            className="col-span-2"
          />
          {/* SPARE in yellow (owner, 2026-09-19): no unit yet, go to the pool. */}
          <Datum
            label="Unit"
            value={scan.unit}
            tone={scan.unit === "SPARE" ? "warning" : "neutral"}
          />
          <Datum label="Shift" value={SHIFT_KIND_LABELS[scan.shift]} />
          <Datum label="Area" value={scan.area} />
          <Datum label="Bus" value={scan.bus} />
        </div>
      </div>
    </article>
  );
}

/** The machine's IN / OUT, in the words the booth reads. */
const STATUS_LABEL: Record<AttendanceScan["status"], string> = {
  IN: "Masuk",
  OUT: "Keluar",
};

function StatusPill({ status }: { status: AttendanceScan["status"] }) {
  return (
    <span className="inline-flex flex-none items-center gap-3 rounded-full border border-[rgba(0,212,255,.4)] bg-(--glass-2-fill) px-6 py-3 font-mono text-xl font-bold text-(--color-primary-bright) uppercase">
      <span className="size-2.5 flex-none rounded-full bg-(--color-primary) shadow-[0_0_12px_rgba(0,212,255,.9)]" />
      Status {STATUS_LABEL[status]}
    </span>
  );
}

/** A box's colour, in the badge tokens every status badge is drawn with. */
const DATUM_TONE: Record<Tone, { box: string; value: string } | null> = {
  success: {
    box: "border-(--badge-success-border) bg-(--badge-success-fill)",
    value: "text-(--badge-success-text)",
  },
  warning: {
    box: "border-(--badge-warning-border) bg-(--badge-warning-fill)",
    value: "text-(--badge-warning-text)",
  },
  danger: {
    box: "border-(--badge-danger-border) bg-(--badge-danger-fill)",
    value: "text-(--badge-danger-text)",
  },
  neutral: null,
};

type Tone = "success" | "warning" | "danger" | "neutral";

/**
 * One labelled box. Anything the record does not hold reads "-", and a dash
 * is never coloured — no filing is not a verdict.
 */
function Datum({
  label,
  value,
  tone = "neutral",
  className,
}: {
  label: string;
  value: string | null;
  tone?: Tone;
  className?: string;
}) {
  const shown = value?.trim() || "-";
  const colour = shown === "-" ? null : DATUM_TONE[tone];
  return (
    <div
      className={cn(
        "min-w-0 rounded-xl border border-(--glass-1-border) bg-(--glass-2-fill) px-7 py-5",
        colour?.box,
        className
      )}
    >
      <span className="block text-[17px] font-bold text-(--text-secondary)">
        {label}
      </span>
      {/* Wrapped to two lines rather than cut: savera's categories run long
          ("Istirahat Minimal 2 Jam"), and so do area names. */}
      <strong
        className={cn(
          "mt-2 line-clamp-2 block text-[28px] leading-tight font-bold break-words",
          colour?.value
        )}
        title={shown}
      >
        {shown}
      </strong>
    </div>
  );
}

/** Before the shift's first scan: say what the screen is for. */
function AwaitingScan() {
  return (
    <div className="flex flex-col items-center gap-8 text-(--text-secondary)">
      <div className="grid size-40 place-items-center rounded-full border border-(--badge-info-border) bg-(--badge-info-fill)">
        <Fingerprint className="size-20 text-(--color-primary-bright)" />
      </div>
      <div className="text-[44px] font-semibold">Menunggu scan</div>
    </div>
  );
}
