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

import { DisplayShell } from "../_components/display-shell";
import {
  DisplayBadge,
  DisplayTable,
  type DisplayTone,
} from "../_components/display-table";

/**
 * Fit To Work kiosk — the running shift's roster against savera's verdicts.
 *
 * Same bargain as the attendance wall: the table is the exception list, worst
 * first and capped, while the tiles count the whole shift.
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

  return (
    <DisplayShell
      title={shiftLabel ? `Fit To Work — Shift ${shiftLabel}` : "Fit To Work"}
      deviceName={deviceName}
      displayKind="fitwork"
      disconnected={disconnected}
      staleSince={dataUpdatedAt || null}
      meta={
        data?.date ? (
          <span className="truncate">
            {rows.length < data.total
              ? `${rows.length} dari ${data.total} orang — yang perlu dilihat lebih dulu`
              : `${data.total} orang terjadwal`}
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
        {
          icon: <Clock className="text-(--badge-warning-text)" />,
          iconClass:
            "bg-(--badge-warning-fill) border-(--badge-warning-border)",
          value: String(data?.refused ?? 0),
          label: "Perlu Tindak Lanjut",
        },
        {
          icon: <AlertTriangle className="text-(--color-danger-text)" />,
          iconClass: "bg-(--badge-danger-fill) border-(--badge-danger-border)",
          value: String(data?.missing ?? 0),
          label: "Belum Lapor",
        },
      ]}
    >
      <DisplayTable
        cols={[
          { label: "NIK", width: "11%" },
          { label: "Nama", width: "20%" },
          { label: "Posisi", width: "16%" },
          { label: "Departemen", width: "13%" },
          { label: "Status", width: "14%" },
          { label: "Log Tidur", width: "11%" },
          { label: "Kategori" },
        ]}
        rows={rows.map((r) => ({
          key: r.nik,
          danger: r.verdict === "missing" || r.verdict === "fail",
          cells: [
            <span
              key="k"
              className="font-mono text-(--text-secondary) tabular-nums"
            >
              {r.nik}
            </span>,
            <b key="n" className="font-bold">
              {r.name}
            </b>,
            r.position ?? "—",
            r.department ?? "—",
            <DisplayBadge key="s" tone={VERDICT[r.verdict].tone}>
              {VERDICT[r.verdict].label}
            </DisplayBadge>,
            <span key="sl" className="font-mono whitespace-nowrap tabular-nums">
              {sleepText(r.sleepMinutes)}
            </span>,
            <span key="c" className="text-xl text-(--text-secondary)">
              {r.sleepCategory ?? "—"}
            </span>,
          ],
        }))}
      />
    </DisplayShell>
  );
}
