"use client";

import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock, Users } from "lucide-react";

import { SHIFT_KIND_LABELS } from "@universe/contracts";

import { isStatus } from "@/lib/api";
import {
  attendanceDisplayQueryOptions,
  type AttendanceDisplayRow,
} from "@/lib/queries/readiness-display";

import { DisplayShell } from "../_components/display-shell";
import {
  DisplayBadge,
  DisplayTable,
  type DisplayTone,
} from "../_components/display-table";

/**
 * Attendance kiosk — the running shift's roster against this morning's taps.
 *
 * The screen shows the exception list, not the roster: several hundred people
 * scrolling past at four seconds a row is nearly an hour a loop, and nobody
 * waits that long for their own name. The API sends the rows worth walking
 * over for, worst first, and the tiles above them count the whole shift — so
 * "312 belum absen" over a table of forty is the screen being honest about
 * what it had room for.
 */

const VERDICT: Record<
  AttendanceDisplayRow["verdict"],
  { tone: DisplayTone; label: string }
> = {
  pass: { tone: "success", label: "Hadir" },
  late: { tone: "warning", label: "Terlambat" },
  missing: { tone: "danger", label: "Belum absen" },
};

export default function DisplayAttendancePage() {
  const deviceName = useSearchParams().get("name") ?? undefined;
  const { data, error, isError, dataUpdatedAt } = useQuery(
    attendanceDisplayQueryOptions()
  );

  /* Same split as the other kiosks: an unpaired screen is a person's errand,
     a lost API is the network's, and one banner must not stand for both. */
  const authProblem = isStatus(error, 401) || isStatus(error, 403);
  const disconnected = isError && !authProblem;

  const rows = data?.rows ?? [];
  const shiftLabel = data?.shift ? SHIFT_KIND_LABELS[data.shift] : null;

  return (
    <DisplayShell
      title={shiftLabel ? `Attendance — Shift ${shiftLabel}` : "Attendance"}
      deviceName={deviceName}
      displayKind="att"
      disconnected={disconnected}
      staleSince={dataUpdatedAt || null}
      meta={
        /* The wall turns from day to night by itself; without this line
           nothing on the glass says which shift is being counted. And when
           the table is a slice of a longer list, it says so rather than
           letting forty rows read as everyone. */
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
          icon: <Users className="text-(--color-primary-bright)" />,
          iconClass: "bg-(--badge-info-fill) border-(--badge-info-border)",
          value: String(data?.total ?? 0),
          label: "Total Roster",
        },
        {
          icon: <CheckCircle2 className="text-(--badge-success-text)" />,
          iconClass:
            "bg-(--badge-success-fill) border-(--badge-success-border)",
          value: String((data?.present ?? 0) + (data?.late ?? 0)),
          label: "Sudah Absen",
        },
        {
          icon: <Clock className="text-(--badge-warning-text)" />,
          iconClass:
            "bg-(--badge-warning-fill) border-(--badge-warning-border)",
          value: String(data?.late ?? 0),
          label: "Terlambat",
        },
        {
          icon: <AlertTriangle className="text-(--color-danger-text)" />,
          iconClass: "bg-(--badge-danger-fill) border-(--badge-danger-border)",
          value: String(data?.absent ?? 0),
          label: "Belum Absen",
        },
      ]}
    >
      <DisplayTable
        cols={[
          { label: "NIK", width: "13%" },
          { label: "Nama", width: "25%" },
          { label: "Posisi", width: "22%" },
          { label: "Departemen", width: "16%" },
          { label: "Jam Absen", width: "12%" },
          { label: "Status" },
        ]}
        rows={rows.map((r) => ({
          key: r.nik,
          danger: r.verdict === "missing",
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
            <span key="t" className="font-mono whitespace-nowrap tabular-nums">
              {r.tappedAt ? r.tappedAt.slice(0, 5) : "—"}
            </span>,
            <DisplayBadge key="s" tone={VERDICT[r.verdict].tone}>
              {VERDICT[r.verdict].label}
            </DisplayBadge>,
          ],
        }))}
      />
    </DisplayShell>
  );
}
