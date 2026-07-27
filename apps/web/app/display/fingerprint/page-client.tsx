"use client";

import { useSearchParams } from "next/navigation";
import { Fingerprint, LayoutGrid, Wifi, WifiOff } from "lucide-react";

import { cn } from "@/lib/utils";

import { DisplayShell } from "../_components/display-shell";

type Machine = { id: string; loc: string; online: boolean; meta: string };

/* ---- static sample content — offline selalu menonjol ---- */
const MACHINES: Machine[] = [
  { id: "FP-02", loc: "Gerbang Barat", online: false, meta: "offline 6m" },
  { id: "FP-06", loc: "Pos Timbang", online: false, meta: "offline 2m" },
  { id: "FP-01", loc: "Gerbang Utama", online: true, meta: "312" },
  { id: "FP-03", loc: "Mess A", online: true, meta: "188" },
  { id: "FP-04", loc: "Mess B", online: true, meta: "204" },
  { id: "FP-05", loc: "Workshop", online: true, meta: "97" },
  { id: "FP-07", loc: "Kantor Pit", online: true, meta: "156" },
  { id: "FP-08", loc: "Fuel Station", online: true, meta: "51" },
  { id: "FP-09", loc: "Klinik", online: true, meta: "44" },
  { id: "FP-10", loc: "Kantor SHE", online: true, meta: "62" },
  { id: "FP-11", loc: "Gudang Logistik", online: true, meta: "38" },
  { id: "FP-12", loc: "Pos Security", online: true, meta: "56" },
];

export default function DisplayFingerprintPage() {
  const deviceName = useSearchParams().get("name") ?? undefined;
  const online = MACHINES.filter((m) => m.online).length;
  const totalScan = MACHINES.filter((m) => m.online).reduce(
    (n, m) => n + Number(m.meta),
    0
  );
  return (
    <DisplayShell
      title="Mesin Fingerprint"
      deviceName={deviceName}
      displayKind="fingerprint"
      stats={[
        {
          icon: <LayoutGrid className="text-(--color-primary-bright)" />,
          iconClass: "bg-(--badge-info-fill) border-(--badge-info-border)",
          value: String(MACHINES.length),
          label: "Total Mesin",
        },
        {
          icon: <Wifi className="text-(--badge-success-text)" />,
          iconClass:
            "bg-(--badge-success-fill) border-(--badge-success-border)",
          value: String(online),
          label: "Online",
        },
        {
          icon: <WifiOff className="text-(--color-danger-text)" />,
          iconClass: "bg-(--badge-danger-fill) border-(--badge-danger-border)",
          value: String(MACHINES.length - online),
          label: "Offline",
        },
        {
          icon: <Fingerprint className="text-(--color-primary-bright)" />,
          iconClass: "bg-[rgba(0,212,255,.14)] border-[rgba(0,212,255,.4)]",
          value: totalScan.toLocaleString("id-ID"),
          label: "Scan Hari Ini",
        },
      ]}
    >
      {/* grid mesin — offline selalu di urutan teratas & menonjol */}
      <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-4 gap-6">
        {MACHINES.map((m) => (
          <div
            key={m.id}
            className={cn(
              "flex flex-col gap-2.5 rounded-panel p-5 glass-card",
              !m.online &&
                "border-[rgba(252,60,59,.55)] shadow-[0_0_28px_rgba(252,60,59,.25),0_20px_80px_rgba(0,0,0,.5)]"
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-[30px] font-bold">{m.id}</span>
              <span
                className={cn(
                  "grid size-13 flex-none place-items-center rounded-icon border [&_svg]:size-6.5",
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
            <div className="text-xl text-(--text-secondary)">{m.loc}</div>
            <div
              className={cn(
                "mt-auto text-lg text-(--text-tertiary)",
                !m.online && "text-(--color-danger-text)"
              )}
            >
              {m.online ? (
                <>
                  Hari ini:{" "}
                  <b className="font-mono font-semibold text-(--text-secondary) tabular-nums">
                    {m.meta} scan
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
    </DisplayShell>
  );
}
