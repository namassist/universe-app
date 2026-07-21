"use client";

import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Fingerprint,
  LayoutGrid,
  Megaphone,
  Wifi,
  WifiOff,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

type KioskKind = "fitwork" | "fingerprint";
type Tone = "success" | "warning" | "danger" | "info" | "neutral";
type Stat = {
  icon: LucideIcon;
  iconClass: string;
  value: string;
  label: string;
};

const toneChip: Record<Tone, string> = {
  success:
    "text-(--badge-success-text) bg-(--badge-success-fill) border-(--badge-success-border)",
  warning:
    "text-(--badge-warning-text) bg-(--badge-warning-fill) border-(--badge-warning-border)",
  danger:
    "text-(--badge-danger-text) bg-(--badge-danger-fill) border-(--badge-danger-border)",
  info: "text-(--color-primary-bright) bg-[rgba(0,212,255,.12)] border-[rgba(0,212,255,.4)]",
  neutral:
    "text-(--badge-neutral-text) bg-(--badge-neutral-fill) border-(--badge-neutral-border)",
};

function KioskBadge({
  tone,
  children,
}: {
  tone: Tone;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border-[1.5px] px-3 py-1 text-sm font-semibold whitespace-nowrap",
        toneChip[tone]
      )}
    >
      <span className="size-2 flex-none rounded-full bg-current" />
      {children}
    </span>
  );
}

/* ---- static sample content ---- */
const FTW_STATS: Stat[] = [
  {
    icon: ClipboardCheck,
    iconClass: "bg-(--badge-info-fill) border-(--badge-info-border)",
    value: "124",
    label: "Sudah Lapor",
  },
  {
    icon: CheckCircle2,
    iconClass: "bg-(--badge-success-fill) border-(--badge-success-border)",
    value: "121",
    label: "Fit",
  },
  {
    icon: Clock,
    iconClass: "bg-(--badge-warning-fill) border-(--badge-warning-border)",
    value: "4",
    label: "Belum Lapor",
  },
  {
    icon: AlertTriangle,
    iconClass: "bg-(--badge-danger-fill) border-(--badge-danger-border)",
    value: "3",
    label: "Kurang Tidur",
  },
];
const FTW_ROWS: {
  nik: string;
  name: string;
  pos: string;
  dept: string;
  tone: Tone;
  label: string;
  sleep: string;
  note: string;
}[] = [
  {
    nik: "OPS-0421",
    name: "Budi Santoso",
    pos: "Driver",
    dept: "Hauling",
    tone: "success",
    label: "Fit",
    sleep: "7j 20m",
    note: "—",
  },
  {
    nik: "OPS-0388",
    name: "Andi Wijaya",
    pos: "Operator",
    dept: "Loading",
    tone: "danger",
    label: "Kurang tidur",
    sleep: "3j 55m",
    note: "Diistirahatkan",
  },
  {
    nik: "OPS-0233",
    name: "Sari Lestari",
    pos: "Support",
    dept: "Support",
    tone: "warning",
    label: "Belum lapor",
    sleep: "—",
    note: "—",
  },
  {
    nik: "OPS-0510",
    name: "Rudi Hartono",
    pos: "Driver",
    dept: "Hauling",
    tone: "success",
    label: "Fit",
    sleep: "6j 45m",
    note: "—",
  },
];

const FP_STATS: Stat[] = [
  {
    icon: LayoutGrid,
    iconClass: "bg-(--badge-info-fill) border-(--badge-info-border)",
    value: "12",
    label: "Total Mesin",
  },
  {
    icon: Wifi,
    iconClass: "bg-(--badge-success-fill) border-(--badge-success-border)",
    value: "10",
    label: "Online",
  },
  {
    icon: WifiOff,
    iconClass: "bg-(--badge-danger-fill) border-(--badge-danger-border)",
    value: "2",
    label: "Offline",
  },
  {
    icon: Fingerprint,
    iconClass: "bg-[rgba(0,212,255,.14)] border-[rgba(0,212,255,.4)]",
    value: "1.208",
    label: "Scan Hari Ini",
  },
];
const FP_MACHINES: {
  id: string;
  loc: string;
  online: boolean;
  meta: string;
}[] = [
  { id: "FP-01", loc: "Gerbang Utama", online: true, meta: "312 scan" },
  { id: "FP-02", loc: "Gerbang Barat", online: false, meta: "offline 6m" },
  { id: "FP-03", loc: "Mess A", online: true, meta: "188 scan" },
  { id: "FP-04", loc: "Mess B", online: true, meta: "204 scan" },
  { id: "FP-05", loc: "Workshop", online: true, meta: "97 scan" },
  { id: "FP-06", loc: "Pos Timbang", online: false, meta: "offline 2m" },
  { id: "FP-07", loc: "Kantor Pit", online: true, meta: "156 scan" },
  { id: "FP-08", loc: "Fuel Station", online: true, meta: "51 scan" },
];

const CONFIG: Record<
  KioskKind,
  { title: string; runtext: string; stats: Stat[] }
> = {
  fitwork: {
    title: "Fit To Work — Shift Pagi",
    runtext:
      "Pastikan istirahat cukup sebelum bertugas — keselamatan nomor satu.",
    stats: FTW_STATS,
  },
  fingerprint: {
    title: "Mesin Fingerprint",
    runtext: "Lapor ke IT bila mesin offline lebih dari 5 menit.",
    stats: FP_STATS,
  },
};

function useClock() {
  const [clock, setClock] = React.useState("--:--:--");
  React.useEffect(() => {
    const two = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    const fmt = () => {
      const d = new Date();
      return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
    };
    const t0 = setTimeout(() => setClock(fmt()), 0);
    const tick = setInterval(() => setClock(fmt()), 1000);
    return () => {
      clearTimeout(t0);
      clearInterval(tick);
    };
  }, []);
  return clock;
}

export function DisplayKioskMenu({ kind }: { kind: KioskKind }) {
  const cfg = CONFIG[kind];
  const clock = useClock();

  return (
    <div
      data-theme="dark"
      className="flex min-h-[calc(100vh-160px)] flex-col gap-6 overflow-hidden rounded-panel bg-(image:--gradient-kiosk) p-8 text-(--text-primary) shadow-(--shadow-panel)"
    >
      {/* header */}
      <header className="flex flex-none items-center gap-5">
        <div className="grid size-14 flex-none place-items-center rounded-full bg-(image:--gradient-logo) text-2xl font-bold text-(--color-on-cta) shadow-[0_0_28px_rgba(0,212,255,.4)]">
          U
        </div>
        <h1 className="truncate text-3xl font-bold">{cfg.title}</h1>
        <div className="ml-auto flex flex-col items-center gap-0.5 rounded-full px-6 py-2 glass-card">
          <span className="font-mono text-3xl leading-none font-bold tabular-nums">
            {clock}
          </span>
          <span className="text-sm text-(--text-secondary)">WITA</span>
        </div>
      </header>

      {/* stats */}
      <div className="grid flex-none grid-cols-4 gap-4 max-xl:grid-cols-2">
        {cfg.stats.map((s) => {
          const Icon = s.icon;
          return (
            <div
              key={s.label}
              className="flex items-center gap-4 rounded-card px-5 py-4 glass-card"
            >
              <div
                className={cn(
                  "grid size-11 flex-none place-items-center rounded-icon border [&_svg]:size-5.5",
                  s.iconClass
                )}
              >
                <Icon />
              </div>
              <div>
                <div className="text-4xl leading-none font-bold tabular-nums">
                  {s.value}
                </div>
                <div className="mt-1 text-sm font-semibold text-(--text-secondary)">
                  {s.label}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* body */}
      {kind === "fitwork" ? (
        <div className="min-h-0 flex-1 overflow-auto rounded-panel px-6 py-5 glass-panel">
          <table className="w-full border-collapse text-lg">
            <thead>
              <tr>
                {[
                  "NIK",
                  "Nama",
                  "Posisi",
                  "Departemen",
                  "Status",
                  "Log Tidur",
                  "Note",
                ].map((h) => (
                  <th
                    key={h}
                    className="bg-[linear-gradient(90deg,rgba(37,99,235,.4),rgba(0,84,199,.3))] px-4 py-3 text-left text-sm font-semibold tracking-[.05em] uppercase first:rounded-l-[14px] last:rounded-r-[14px]"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FTW_ROWS.map((r) => (
                <tr
                  key={r.nik}
                  className={cn(
                    r.tone === "danger" &&
                      "[&>td]:bg-[rgba(252,60,59,.1)] [&>td:first-child]:shadow-[inset_4px_0_0_var(--color-danger)]"
                  )}
                >
                  <td className="border-b border-[rgba(255,255,255,.08)] px-4 py-3 font-mono text-(--text-secondary) tabular-nums">
                    {r.nik}
                  </td>
                  <td className="border-b border-[rgba(255,255,255,.08)] px-4 py-3 font-bold">
                    {r.name}
                  </td>
                  <td className="border-b border-[rgba(255,255,255,.08)] px-4 py-3">
                    {r.pos}
                  </td>
                  <td className="border-b border-[rgba(255,255,255,.08)] px-4 py-3">
                    {r.dept}
                  </td>
                  <td className="border-b border-[rgba(255,255,255,.08)] px-4 py-3">
                    <KioskBadge tone={r.tone}>{r.label}</KioskBadge>
                  </td>
                  <td className="border-b border-[rgba(255,255,255,.08)] px-4 py-3 font-mono tabular-nums">
                    {r.sleep}
                  </td>
                  <td className="border-b border-[rgba(255,255,255,.08)] px-4 py-3 text-(--text-secondary)">
                    {r.note}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-4 gap-5 max-xl:grid-cols-2">
          {FP_MACHINES.map((m) => (
            <div
              key={m.id}
              className={cn(
                "flex flex-col gap-2 rounded-panel p-4 glass-card",
                !m.online &&
                  "border-[rgba(252,60,59,.55)] shadow-[0_0_28px_rgba(252,60,59,.25)]"
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-xl font-bold">{m.id}</span>
                <span
                  className={cn(
                    "grid size-9 flex-none place-items-center rounded-icon border [&_svg]:size-4.5",
                    m.online
                      ? "border-(--badge-success-border) bg-(--badge-success-fill)"
                      : "border-(--badge-danger-border) bg-(--badge-danger-fill)"
                  )}
                >
                  {m.online ? (
                    <Wifi className="text-(--badge-success-text)" />
                  ) : (
                    <WifiOff className="text-(--color-danger-text)" />
                  )}
                </span>
              </div>
              <div className="text-sm text-(--text-secondary)">{m.loc}</div>
              <div
                className={cn(
                  "mt-auto text-sm text-(--text-tertiary)",
                  !m.online && "text-(--color-danger-text)"
                )}
              >
                {m.online ? (
                  <>
                    Hari ini:{" "}
                    <b className="font-mono font-semibold text-(--text-secondary) tabular-nums">
                      {m.meta}
                    </b>
                  </>
                ) : (
                  <b className="font-mono font-semibold text-(--color-danger-text) tabular-nums">
                    {m.meta}
                  </b>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* runtext bar */}
      <div className="flex h-12 flex-none items-center gap-4 rounded-full border border-(--glass-1-border) bg-(--glass-1-fill) px-6 backdrop-blur-md">
        <span className="grid size-8 flex-none place-items-center rounded-full border border-(--badge-info-border) bg-(--badge-info-fill)">
          <Megaphone className="size-4 text-primary-bright" />
        </span>
        <span className="truncate text-(--text-secondary)">{cfg.runtext}</span>
      </div>
    </div>
  );
}
