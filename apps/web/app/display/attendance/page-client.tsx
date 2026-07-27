"use client";

import { useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, Clock, Users } from "lucide-react";

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
};

/* ---- static sample content ---- */
const ROWS: Row[] = [
  {
    nik: "503220421",
    name: "Budi Santoso",
    pos: "Driver OHT",
    dept: "Hauling",
    tone: "success",
    label: "Hadir",
  },
  {
    nik: "508210388",
    name: "Andi Wijaya",
    pos: "Operator Excavator",
    dept: "Loading",
    tone: "warning",
    label: "Terlambat",
  },
  {
    nik: "501230510",
    name: "Rudi Hartono",
    pos: "Driver OHT",
    dept: "Hauling",
    tone: "danger",
    label: "Belum absen",
  },
  {
    nik: "505200233",
    name: "Sari Lestari",
    pos: "Admin Site",
    dept: "Support",
    tone: "success",
    label: "Hadir",
  },
  {
    nik: "511190111",
    name: "Joko Prasetyo",
    pos: "Driver OHT",
    dept: "Hauling",
    tone: "success",
    label: "Hadir",
  },
  {
    nik: "509220290",
    name: "Dewi Anggraini",
    pos: "Dispatcher",
    dept: "Support",
    tone: "success",
    label: "Hadir",
  },
  {
    nik: "502210367",
    name: "Hendra Gunawan",
    pos: "Operator Dozer",
    dept: "Loading",
    tone: "danger",
    label: "Belum absen",
  },
  {
    nik: "506230455",
    name: "Fitri Handayani",
    pos: "Checker",
    dept: "Hauling",
    tone: "success",
    label: "Hadir",
  },
  {
    nik: "504180129",
    name: "Agus Salim",
    pos: "Mekanik",
    dept: "Plant",
    tone: "warning",
    label: "Terlambat",
  },
  {
    nik: "510200602",
    name: "Rina Marlina",
    pos: "Safety Officer",
    dept: "SHE",
    tone: "success",
    label: "Hadir",
  },
];

export default function DisplayAttendancePage() {
  const deviceName = useSearchParams().get("name") ?? undefined;
  const n = (label: string) => ROWS.filter((r) => r.label === label).length;
  return (
    <DisplayShell
      title="Attendance — Shift Pagi"
      deviceName={deviceName}
      displayKind="att"
      stats={[
        {
          icon: <Users className="text-(--color-primary-bright)" />,
          iconClass: "bg-(--badge-info-fill) border-(--badge-info-border)",
          value: String(ROWS.length),
          label: "Total Roster",
        },
        {
          icon: <CheckCircle2 className="text-(--badge-success-text)" />,
          iconClass:
            "bg-(--badge-success-fill) border-(--badge-success-border)",
          value: String(n("Hadir") + n("Terlambat")),
          label: "Sudah Absen",
        },
        {
          icon: <Clock className="text-(--badge-warning-text)" />,
          iconClass:
            "bg-(--badge-warning-fill) border-(--badge-warning-border)",
          value: String(n("Terlambat")),
          label: "Terlambat",
        },
        {
          icon: <AlertTriangle className="text-(--color-danger-text)" />,
          iconClass: "bg-(--badge-danger-fill) border-(--badge-danger-border)",
          value: String(n("Belum absen")),
          label: "Belum Absen",
        },
      ]}
    >
      <DisplayTable
        cols={[
          { label: "NIK", width: "13%" },
          { label: "Nama", width: "27%" },
          { label: "Posisi", width: "24%" },
          { label: "Departemen", width: "16%" },
          { label: "Status" },
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
          ],
        }))}
      />
    </DisplayShell>
  );
}
