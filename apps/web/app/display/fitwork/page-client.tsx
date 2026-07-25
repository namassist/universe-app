"use client";

import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Clock,
} from "lucide-react";

import { DisplayShell } from "../_components/display-shell";
import {
  DisplayBadge,
  DisplayTable,
  type DisplayTone,
} from "../_components/display-table";

type Row = {
  nik: string;
  name: string;
  pos: string;
  dept: string;
  tone: DisplayTone;
  label: string;
  sleep: string;
  note: string;
};

/* ---- static sample content ---- */
const ROWS: Row[] = [
  {
    nik: "OPS-0421",
    name: "Budi Santoso",
    pos: "Driver OHT",
    dept: "Hauling",
    tone: "success",
    label: "Fit",
    sleep: "7j 20m",
    note: "—",
  },
  {
    nik: "OPS-0388",
    name: "Andi Wijaya",
    pos: "Operator Excavator",
    dept: "Loading",
    tone: "danger",
    label: "Kurang tidur",
    sleep: "3j 55m",
    note: "Diistirahatkan",
  },
  {
    nik: "OPS-0233",
    name: "Sari Lestari",
    pos: "Admin Site",
    dept: "Support",
    tone: "warning",
    label: "Belum lapor",
    sleep: "—",
    note: "—",
  },
  {
    nik: "OPS-0510",
    name: "Rudi Hartono",
    pos: "Driver OHT",
    dept: "Hauling",
    tone: "success",
    label: "Fit",
    sleep: "6j 45m",
    note: "—",
  },
  {
    nik: "OPS-0111",
    name: "Joko Prasetyo",
    pos: "Driver OHT",
    dept: "Hauling",
    tone: "success",
    label: "Fit",
    sleep: "7j 05m",
    note: "—",
  },
  {
    nik: "OPS-0290",
    name: "Dewi Anggraini",
    pos: "Dispatcher",
    dept: "Support",
    tone: "success",
    label: "Fit",
    sleep: "8j 10m",
    note: "—",
  },
  {
    nik: "OPS-0367",
    name: "Hendra Gunawan",
    pos: "Operator Dozer",
    dept: "Loading",
    tone: "danger",
    label: "Kurang tidur",
    sleep: "4j 10m",
    note: "Observasi medic",
  },
  {
    nik: "OPS-0455",
    name: "Fitri Handayani",
    pos: "Checker",
    dept: "Hauling",
    tone: "success",
    label: "Fit",
    sleep: "6j 55m",
    note: "—",
  },
  {
    nik: "OPS-0129",
    name: "Agus Salim",
    pos: "Mekanik",
    dept: "Plant",
    tone: "warning",
    label: "Belum lapor",
    sleep: "—",
    note: "—",
  },
  {
    nik: "OPS-0602",
    name: "Rina Marlina",
    pos: "Safety Officer",
    dept: "SHE",
    tone: "success",
    label: "Fit",
    sleep: "7j 40m",
    note: "—",
  },
];

export default function DisplayFitworkPage() {
  const deviceName = useSearchParams().get("name") ?? undefined;
  const n = (label: string) => ROWS.filter((r) => r.label === label).length;
  return (
    <DisplayShell
      title="Fit To Work — Shift Pagi"
      deviceName={deviceName}
      stats={[
        {
          icon: <ClipboardCheck className="text-(--color-primary-bright)" />,
          iconClass: "bg-(--badge-info-fill) border-(--badge-info-border)",
          value: String(n("Fit") + n("Kurang tidur")),
          label: "Sudah Lapor",
        },
        {
          icon: <CheckCircle2 className="text-(--badge-success-text)" />,
          iconClass:
            "bg-(--badge-success-fill) border-(--badge-success-border)",
          value: String(n("Fit")),
          label: "Fit",
        },
        {
          icon: <Clock className="text-(--badge-warning-text)" />,
          iconClass:
            "bg-(--badge-warning-fill) border-(--badge-warning-border)",
          value: String(n("Belum lapor")),
          label: "Belum Lapor",
        },
        {
          icon: <AlertTriangle className="text-(--color-danger-text)" />,
          iconClass: "bg-(--badge-danger-fill) border-(--badge-danger-border)",
          value: String(n("Kurang tidur")),
          label: "Kurang Tidur",
        },
      ]}
    >
      <DisplayTable
        cols={[
          { label: "NIK", width: "11%" },
          { label: "Nama", width: "18%" },
          { label: "Posisi", width: "14%" },
          { label: "Departemen", width: "11%" },
          { label: "Status", width: "13%" },
          { label: "Log Tidur", width: "12%" },
          { label: "Note" },
        ]}
        rows={ROWS.map((r) => ({
          key: r.nik,
          danger: r.tone === "danger",
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
            r.pos,
            r.dept,
            <DisplayBadge key="s" tone={r.tone}>
              {r.label}
            </DisplayBadge>,
            <span key="sl" className="font-mono whitespace-nowrap tabular-nums">
              {r.sleep}
            </span>,
            <span key="no" className="text-xl text-(--text-secondary)">
              {r.note}
            </span>,
          ],
        }))}
      />
    </DisplayShell>
  );
}
