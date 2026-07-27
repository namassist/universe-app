"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Bus,
  CheckCircle2,
  Clock,
  Truck,
  UserX,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { initialsOf } from "@/components/ui/avatar";

import { DisplayShell } from "../_components/display-shell";
import { DisplayBadge, type DisplayTone } from "../_components/display-table";

/* satu tampilan = satu formasi penuh — beberapa fleet membuat layar BEROTASI */
type Card = {
  code: string;
  tone: DisplayTone;
  label: string;
  opName: string | null;
  opNik: string | null;
};
type FleetView = {
  id: string;
  digger: string;
  loc: string;
  bus: string;
  cards: Card[];
};

/* ---- static sample content ---- */
const ready = (code: string, opName: string, opNik: string): Card => ({
  code,
  tone: "success",
  label: "Ready",
  opName,
  opNik,
});

const FLEETS: FleetView[] = [
  {
    id: "fl1",
    digger: "EX-22",
    loc: "Pit 3 — Panel Utara",
    bus: "BUS-01",
    cards: [
      ready("EX-22", "Andi Wijaya", "508210388"),
      ready("DT-101", "Budi Santoso", "503220421"),
      ready("DT-102", "Joko Prasetyo", "511190111"),
      {
        code: "DT-104",
        tone: "danger",
        label: "Breakdown",
        opName: null,
        opNik: null,
      },
      ready("DT-105", "Rudi Hartono", "501230510"),
      {
        code: "DT-106",
        tone: "neutral",
        label: "Standby",
        opName: null,
        opNik: null,
      },
      ready("DT-107", "Agus Salim", "504180129"),
    ],
  },
  {
    id: "fl2",
    digger: "EX-07",
    loc: "Disposal Utara",
    bus: "BUS-02",
    cards: [
      ready("EX-07", "Hendra Gunawan", "502210367"),
      ready("DT-201", "Fitri Handayani", "506230455"),
      ready("DT-202", "Dewi Anggraini", "509220290"),
      ready("DT-203", "Rina Marlina", "510200602"),
      {
        code: "DT-204",
        tone: "neutral",
        label: "Standby",
        opName: null,
        opNik: null,
      },
    ],
  },
];

export default function DisplayFleetPage() {
  const params = useSearchParams();

  /* rotasi tiap N detik — ?interval= atau 12 dtk */
  const intervalSec = Math.max(3, Number(params.get("interval")) || 12);
  const [idx, setIdx] = React.useState(0);
  React.useEffect(() => {
    if (FLEETS.length < 2) return;
    const id = setInterval(() => setIdx((i) => i + 1), intervalSec * 1000);
    return () => clearInterval(id);
  }, [intervalSec]);

  const pos = idx % FLEETS.length;
  const fleet = FLEETS[pos]!;
  const cards = fleet.cards;
  const count = (tone: DisplayTone) =>
    cards.filter((c) => c.tone === tone).length;

  return (
    <DisplayShell
      title={`Fleet ${fleet.digger}`}
      deviceName={params.get("name") ?? undefined}
      displayKind="fleet"
      meta={
        <>
          <span className="truncate">{fleet.loc}</span>
          <span className="inline-flex flex-none items-center gap-2.5 rounded-full border border-(--badge-info-border) bg-(--badge-info-fill) px-4.5 py-1 font-bold text-(--color-primary-bright)">
            <Bus className="size-6" />
            Bus {fleet.bus}
          </span>
        </>
      }
      /* progres rotasi multi-fleet — bar segmen gaya story di tepi atas */
      topBar={
        FLEETS.length > 1 ? (
          <div className="flex gap-2">
            {FLEETS.map((f, i) => (
              <span
                key={f.id}
                className="h-[7px] min-w-0 flex-1 overflow-hidden bg-[rgba(255,255,255,.14)]"
              >
                {i < pos ? (
                  <span className="block h-full w-full bg-(--color-primary-bright)" />
                ) : i === pos ? (
                  <span
                    key={`fill-${idx}`}
                    className="kfill-run block h-full w-full origin-left bg-(--color-primary-bright) shadow-[0_0_12px_rgba(0,212,255,.8)]"
                    style={{ animationDuration: `${intervalSec}s` }}
                  />
                ) : null}
              </span>
            ))}
          </div>
        ) : undefined
      }
      stats={[
        {
          icon: <Truck className="text-(--color-primary-bright)" />,
          iconClass: "bg-(--badge-info-fill) border-(--badge-info-border)",
          value: String(cards.length),
          label: "Total Unit",
        },
        {
          icon: <CheckCircle2 className="text-(--badge-success-text)" />,
          iconClass:
            "bg-(--badge-success-fill) border-(--badge-success-border)",
          value: String(count("success")),
          label: "Ready",
        },
        {
          icon: <AlertTriangle className="text-(--color-danger-text)" />,
          iconClass: "bg-(--badge-danger-fill) border-(--badge-danger-border)",
          value: String(count("danger")),
          label: "Breakdown",
        },
        {
          icon: <Clock className="text-(--badge-neutral-text)" />,
          iconClass:
            "bg-(--badge-neutral-fill) border-(--badge-neutral-border)",
          value: String(count("neutral")),
          label: "Standby",
        },
      ]}
    >
      {/* kartu operator per unit — pergantian fleet meluncur masuk (swipe) */}
      <div
        key={fleet.id}
        className="kswipe-in grid min-h-0 flex-1 grid-cols-7 grid-rows-2 gap-5"
      >
        {cards.slice(0, 14).map((c) => (
          <div
            key={c.code}
            className={cn(
              "relative overflow-hidden rounded-card border border-(--glass-2-border)",
              c.tone === "danger" &&
                "border-[rgba(252,60,59,.55)] shadow-[0_0_28px_rgba(252,60,59,.25)]"
            )}
          >
            {/* foto karyawan memenuhi kartu (placeholder inisial) */}
            {c.opName ? (
              <div className="absolute inset-0 grid place-items-center bg-(image:--gradient-cta)">
                <span className="text-[88px] font-bold text-(--color-on-cta) opacity-80">
                  {initialsOf(c.opName)}
                </span>
              </div>
            ) : (
              <div className="absolute inset-0 grid place-items-center bg-(--fill-input)">
                <UserX className="size-20 text-(--text-disabled)" />
              </div>
            )}
            {/* scrim agar teks terbaca di atas foto */}
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(1,4,22,.65)_0%,rgba(1,4,22,0)_32%,rgba(1,4,22,0)_52%,rgba(1,4,22,.88)_100%)]" />
            <div className="absolute inset-0 flex flex-col justify-between p-3.5">
              <div className="flex items-start justify-between gap-2">
                <b className="font-mono text-[22px] font-bold tabular-nums">
                  {c.code}
                </b>
                <DisplayBadge
                  tone={c.tone}
                  className="gap-1.5 px-2.5 py-0.5 text-sm [&>span]:size-2"
                >
                  {c.label}
                </DisplayBadge>
              </div>
              <div>
                <div className="line-clamp-1 text-[21px] leading-tight font-bold">
                  {c.opName ?? "Belum ada operator"}
                </div>
                {c.opNik ? (
                  <div className="mt-0.5 font-mono text-base text-(--text-secondary) tabular-nums">
                    {c.opNik}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </DisplayShell>
  );
}
