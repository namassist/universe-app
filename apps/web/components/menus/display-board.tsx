"use client";

import * as React from "react";
import {
  Activity,
  CheckCircle2,
  Clock,
  Fingerprint,
  Heart,
  Truck,
  Users,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { MENU_LABELS, type MenuSlug } from "@/lib/access";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { usePagination } from "@/components/ui/pagination";
import { PageTitle, Panel, Toolbar, ToolbarTitle } from "@/components/ui/panel";
import { StatCard } from "@/components/ui/stat-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type BoardKind =
  | "display-attendance"
  | "display-fleet"
  | "display-fitwork"
  | "monitoring-fingerprint";

type IconStyle = { background: string; borderColor: string; color: string };
type Stat = {
  icon: LucideIcon;
  style: IconStyle;
  value: string;
  label: string;
};
type Row = { key: string; cells: React.ReactNode[] };

const S_SUCCESS = {
  background: "var(--badge-success-fill)",
  borderColor: "var(--badge-success-border)",
  color: "var(--badge-success-text)",
};
const S_WARNING = {
  background: "var(--badge-warning-fill)",
  borderColor: "var(--badge-warning-border)",
  color: "var(--badge-warning-text)",
};
const S_DANGER = {
  background: "var(--badge-danger-fill)",
  borderColor: "var(--badge-danger-border)",
  color: "var(--color-danger-text)",
};
const S_INFO = {
  background: "rgba(0,212,255,.14)",
  borderColor: "rgba(0,212,255,.4)",
  color: "var(--color-primary-bright)",
};

const chip = (variant: BadgeVariant, label: string) => (
  <Badge variant={variant} dot>
    {label}
  </Badge>
);
const mono = (v: string) => (
  <span className="font-mono text-(--text-secondary) tabular-nums">{v}</span>
);

type Board = { sub: string; stats: Stat[]; cols: string[]; rows: Row[] };

const BOARDS: Record<BoardKind, Board> = {
  "display-attendance": {
    sub: "Papan kehadiran shift pagi — pembaruan langsung",
    stats: [
      { icon: Users, style: S_INFO, value: "128", label: "Total Roster" },
      { icon: CheckCircle2, style: S_SUCCESS, value: "116", label: "Hadir" },
      { icon: Clock, style: S_WARNING, value: "12", label: "Belum Absen" },
    ],
    cols: ["NIK", "Nama", "Departemen", "Shift", "Check-in", "Status"],
    rows: [
      {
        key: "1",
        cells: [
          mono("OPS-0421"),
          <b key="n">Budi Santoso</b>,
          "Hauling",
          "Pagi",
          mono("05:42"),
          chip("success", "Hadir"),
        ],
      },
      {
        key: "2",
        cells: [
          mono("OPS-0388"),
          <b key="n">Andi Wijaya</b>,
          "Loading",
          "Pagi",
          mono("06:05"),
          chip("warning", "Terlambat"),
        ],
      },
      {
        key: "3",
        cells: [
          mono("OPS-0510"),
          <b key="n">Rudi Hartono</b>,
          "Hauling",
          "Pagi",
          "—",
          chip("danger", "Belum"),
        ],
      },
    ],
  },
  "display-fleet": {
    sub: "Papan alokasi armada — shift pagi",
    stats: [
      { icon: Truck, style: S_INFO, value: "42", label: "Unit Aktif" },
      {
        icon: CheckCircle2,
        style: S_SUCCESS,
        value: "38",
        label: "Beroperasi",
      },
      { icon: XCircle, style: S_DANGER, value: "4", label: "Breakdown" },
    ],
    cols: ["Unit", "Model", "Operator", "Lokasi", "Status"],
    rows: [
      {
        key: "1",
        cells: [
          <b key="u">DT-101</b>,
          "HD785-7",
          "Budi Santoso",
          "Pit 3",
          chip("success", "Operasi"),
        ],
      },
      {
        key: "2",
        cells: [
          <b key="u">DT-104</b>,
          "HD785-7",
          "—",
          "Pit 3",
          chip("danger", "Breakdown"),
        ],
      },
      {
        key: "3",
        cells: [
          <b key="u">EX-22</b>,
          "PC2000-8",
          "Andi Wijaya",
          "Disposal",
          chip("success", "Operasi"),
        ],
      },
    ],
  },
  "display-fitwork": {
    sub: "Fit To Work — shift pagi",
    stats: [
      { icon: Heart, style: S_INFO, value: "124", label: "Sudah Lapor" },
      { icon: CheckCircle2, style: S_SUCCESS, value: "121", label: "Fit" },
      { icon: Clock, style: S_WARNING, value: "4", label: "Belum Lapor" },
      { icon: XCircle, style: S_DANGER, value: "3", label: "Kurang Tidur" },
    ],
    cols: ["NIK", "Nama", "Posisi", "Status", "Log Tidur"],
    rows: [
      {
        key: "1",
        cells: [
          mono("OPS-0421"),
          <b key="n">Budi Santoso</b>,
          "Driver",
          chip("success", "Fit"),
          mono("7j 20m"),
        ],
      },
      {
        key: "2",
        cells: [
          mono("OPS-0388"),
          <b key="n">Andi Wijaya</b>,
          "Operator",
          chip("danger", "Kurang tidur"),
          mono("3j 55m"),
        ],
      },
      {
        key: "3",
        cells: [
          mono("OPS-0233"),
          <b key="n">Sari Lestari</b>,
          "Support",
          chip("warning", "Belum lapor"),
          "—",
        ],
      },
    ],
  },
  "monitoring-fingerprint": {
    sub: "Monitoring perangkat fingerprint",
    stats: [
      {
        icon: Fingerprint,
        style: S_INFO,
        value: "8",
        label: "Total Perangkat",
      },
      { icon: Activity, style: S_SUCCESS, value: "7", label: "Online" },
      { icon: XCircle, style: S_DANGER, value: "1", label: "Offline" },
    ],
    cols: ["Perangkat", "Lokasi", "Scan Terakhir", "Status"],
    rows: [
      {
        key: "1",
        cells: [
          <b key="d">FP-Gate-A</b>,
          "Gerbang Utama",
          mono("06:12"),
          chip("success", "Online"),
        ],
      },
      {
        key: "2",
        cells: [
          <b key="d">FP-Gate-B</b>,
          "Gerbang Barat",
          "—",
          chip("danger", "Offline"),
        ],
      },
      {
        key: "3",
        cells: [
          <b key="d">FP-Mess-1</b>,
          "Mess A",
          mono("05:58"),
          chip("success", "Online"),
        ],
      },
    ],
  },
};

export function DisplayBoardMenu({ kind }: { kind: BoardKind }) {
  const board = BOARDS[kind];
  const title = MENU_LABELS[kind as MenuSlug];
  const pg = usePagination(board.rows);

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={title} sub={board.sub} />

      <div className="grid grid-cols-4 gap-4 max-xl:grid-cols-2">
        {board.stats.map((s) => {
          const Icon = s.icon;
          return (
            <StatCard
              key={s.label}
              icon={<Icon />}
              iconStyle={s.style}
              value={s.value}
              label={s.label}
            />
          );
        })}
      </div>

      <Panel>
        <Toolbar>
          <ToolbarTitle>{title}</ToolbarTitle>
        </Toolbar>
        <Table>
          <TableHeader>
            <tr>
              {board.cols.map((c) => (
                <TableHead key={c}>{c}</TableHead>
              ))}
            </tr>
          </TableHeader>
          <TableBody>
            {pg.rows.map((r) => (
              <TableRow key={r.key}>
                {r.cells.map((cell, i) => (
                  <TableCell key={i}>{cell}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>
    </div>
  );
}
