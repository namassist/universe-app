"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, LayoutGrid, Wifi, WifiOff } from "lucide-react";

import {
  fingerprintDisplayQueryOptions,
  type FingerprintDisplayMachine,
} from "@/lib/queries/fingerprint-display";
import { cn } from "@/lib/utils";

import { DisplayShell } from "../_components/display-shell";

/**
 * Monitoring Mesin Fingerprint — a wall that answers one question.
 *
 * The layout is **priority-ordered, not uniform**. Machines that need
 * attention are pinned at the top and never scroll away; the healthy fleet
 * below rotates a page at a time, the way the fleet screen cycles its fleets.
 *
 * That split is what lets the screen survive growth. Showing every machine at
 * once means shrinking every card as the fleet grows, and past ~80 machines
 * nothing is legible from across a room. Rotating instead keeps a card the
 * size it needs to be at any fleet size — while the part anyone actually walks
 * over to read stays put, because an outage must not be waited out.
 */

/** How long ago, in the shorthand a wall is read at from across a room. */
function since(iso: string | null): string {
  if (!iso) return "—";
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  );
  if (seconds < 60) return "baru saja";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} j ${minutes % 60} m`;
  const days = Math.floor(hours / 24);
  return `${days} h ${hours % 24} j`;
}

const clock = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleTimeString("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

/**
 * Columns for the pinned offline section, from its own count rather than a
 * fixed breakpoint: `√(n · k)` keeps cells near a usable shape however many
 * there are, and never more columns than cards — so two outages are two
 * half-width cards, not two thirds of a row with a hole in it.
 */
function offlineColumns(count: number): number {
  if (count <= 0) return 1;
  const wanted = Math.min(8, Math.max(1, Math.ceil(Math.sqrt(count * 1.5))));
  return Math.min(wanted, count);
}

/**
 * The healthy fleet is paged rather than squeezed, so a card keeps one
 * readable size at any fleet size. Six across is ~300 px a card on the 1920
 * canvas — room for a machine name without truncating it to a stub.
 */
const ONLINE_COLS = 6;

/** Row heights are only the *ratio* by which the two sections divide the body. */
const OFFLINE_ROW = 150;
const OFFLINE_DENSE_ROW = 90;
const ONLINE_ROW = 130;

/** A machine that needs attention. Pinned: it is why the screen exists. */
function OfflineCard({
  machine,
  dense,
}: {
  machine: FingerprintDisplayMachine;
  dense: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-panel glass-card",
        "border-[rgba(252,60,59,.55)] shadow-[0_0_28px_rgba(252,60,59,.25),0_20px_80px_rgba(0,0,0,.5)]",
        dense ? "gap-1 p-3" : "gap-2.5 p-5"
      )}
    >
      <div className="flex shrink-0 items-center justify-between gap-3">
        <span
          className={cn(
            "min-w-0 truncate font-bold",
            dense ? "text-[18px]" : "text-[26px]"
          )}
          title={machine.name}
        >
          {machine.name}
        </span>
        <span
          className={cn(
            "grid flex-none place-items-center rounded-icon border border-(--badge-danger-border) bg-(--badge-danger-fill)",
            dense ? "size-8 [&_svg]:size-4.5" : "size-12 [&_svg]:size-6"
          )}
        >
          <WifiOff className="text-(--color-danger-text)" />
        </span>
      </div>
      <div
        className={cn(
          "shrink-0 truncate font-mono text-(--text-secondary) tabular-nums",
          dense ? "text-[13px]" : "text-lg"
        )}
      >
        {machine.ip}
      </div>
      <div
        className={cn(
          "mt-auto text-(--color-danger-text)",
          dense ? "text-[14px]" : "text-lg"
        )}
      >
        Offline{" "}
        <b className="font-mono font-semibold tabular-nums">
          {since(machine.statusSince)}
        </b>
      </div>
    </div>
  );
}

/**
 * A healthy machine, in the same card shape as the ones above — one size down.
 *
 * The surface stays glass and only the icon badge carries the status colour:
 * filling fifty-odd healthy cards with green would leave the handful of red
 * ones with nothing to stand out against.
 */
function OnlineCard({ machine }: { machine: FingerprintDisplayMachine }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 overflow-hidden rounded-panel p-3.5 glass-card">
      {/* `shrink-0` on the identity lines is load-bearing, not decoration: a
          flex child shrinks by default, so on a full page — where rows are
          short — the middle line was squeezed to nothing and the address
          vanished while the pinned bottom line stayed. Name and address are
          what identify a machine, so they hold their height and the softest
          line gives way instead. */}
      <div className="flex shrink-0 items-center justify-between gap-3">
        <span
          className="min-w-0 truncate text-[21px] font-bold"
          title={machine.name}
        >
          {machine.name}
        </span>
        <span className="grid size-9 flex-none place-items-center rounded-icon border border-(--badge-success-border) bg-(--badge-success-fill) [&_svg]:size-4.5">
          <Wifi className="text-(--badge-success-text)" />
        </span>
      </div>
      <div className="shrink-0 truncate font-mono text-[15px] text-(--text-secondary) tabular-nums">
        {machine.ip}
      </div>
      <div className="mt-auto truncate text-[14px] text-(--text-tertiary)">
        Terlihat{" "}
        <b className="font-mono font-semibold text-(--text-secondary) tabular-nums">
          {since(machine.lastSeenAt)}
        </b>
      </div>
    </div>
  );
}

export default function DisplayFingerprintPage() {
  const params = useSearchParams();
  const { data } = useQuery(fingerprintDisplayQueryOptions());

  const machines = React.useMemo(() => data?.machines ?? [], [data?.machines]);
  const offline = React.useMemo(
    () => machines.filter((m) => !m.online),
    [machines]
  );
  const online = React.useMemo(
    () => machines.filter((m) => m.online),
    [machines]
  );

  const denseOffline = offline.length > 8;
  const offCols = offlineColumns(offline.length);
  const offRows = Math.ceil(offline.length / offCols) || 1;
  /* Two rows of healthy cards when an outage is eating the screen, three when
     it is not — the pinned half always wins the space it needs. */
  const onRowsPerPage = denseOffline ? 2 : 3;
  const pageSize = ONLINE_COLS * onRowsPerPage;
  const pages = Math.max(1, Math.ceil(online.length / pageSize));

  /* Rotation, same contract as the fleet screen: ?interval= seconds. Five by
     default here rather than the fleet's twelve — a page of machine names is
     read at a glance, not studied. */
  const intervalSec = Math.max(3, Number(params.get("interval")) || 5);
  const [idx, setIdx] = React.useState(0);
  React.useEffect(() => {
    if (pages < 2) return;
    const id = setInterval(() => setIdx((i) => i + 1), intervalSec * 1000);
    return () => clearInterval(id);
  }, [intervalSec, pages]);

  const pos = idx % pages;
  const pageMachines = online.slice(pos * pageSize, pos * pageSize + pageSize);

  /**
   * The freshest probe attempt across the fleet.
   *
   * Shown because a stopped prober is otherwise invisible: every card would
   * stay green and the wall would look healthy while nothing was being checked
   * at all. A timestamp that stops advancing is the tell.
   */
  const lastCheck = React.useMemo(() => {
    const stamps = machines
      .map((m) => m.checkedAt)
      .filter((s): s is string => s !== null);
    return stamps.length ? stamps.sort().at(-1)! : null;
  }, [machines]);

  const offWeight = offRows * (denseOffline ? OFFLINE_DENSE_ROW : OFFLINE_ROW);
  const onWeight = onRowsPerPage * ONLINE_ROW;

  return (
    <DisplayShell
      title="Monitoring Mesin Fingerprint"
      meta={
        <span>
          Pengecekan terakhir{" "}
          <b className="font-mono tabular-nums">{clock(lastCheck)}</b>
        </span>
      }
      deviceName={params.get("name") ?? undefined}
      displayKind="fingerprint"
      /* Rotation progress for the healthy half — the segmented story bar the
         fleet screen uses to show which subject is on screen. */
      topBar={
        pages > 1 ? (
          <div className="flex gap-2">
            {Array.from({ length: pages }, (_, i) => (
              <span
                key={i}
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
          icon: <LayoutGrid className="text-(--color-primary-bright)" />,
          iconClass: "bg-(--badge-info-fill) border-(--badge-info-border)",
          value: String(data?.total ?? 0),
          label: "Total Mesin",
        },
        {
          icon: <Wifi className="text-(--badge-success-text)" />,
          iconClass:
            "bg-(--badge-success-fill) border-(--badge-success-border)",
          value: String(data?.online ?? 0),
          label: "Online",
        },
        {
          icon: <WifiOff className="text-(--color-danger-text)" />,
          iconClass: "bg-(--badge-danger-fill) border-(--badge-danger-border)",
          value: String(data?.offline ?? 0),
          label: "Offline",
        },
      ]}
    >
      {machines.length ? (
        <div className="flex min-h-0 flex-1 flex-col gap-5">
          {/* ---- pinned: what needs attention ---- */}
          {offline.length ? (
            <section
              className="flex min-h-0 flex-col gap-3"
              style={{ flex: `${offWeight} 1 0%` }}
            >
              <h2 className="flex flex-none items-center gap-3 text-2xl font-bold text-(--color-danger-text)">
                <WifiOff className="size-6" />
                Perlu Perhatian
                <span className="rounded-chip border border-(--badge-danger-border) bg-(--badge-danger-fill) px-3 py-0.5 font-mono text-xl tabular-nums">
                  {offline.length}
                </span>
              </h2>
              <div
                className="grid min-h-0 flex-1 auto-rows-fr gap-4"
                style={{
                  gridTemplateColumns: `repeat(${offCols}, minmax(0,1fr))`,
                }}
              >
                {offline.map((m) => (
                  <OfflineCard key={m.id} machine={m} dense={denseOffline} />
                ))}
              </div>
            </section>
          ) : (
            <section className="flex flex-none items-center gap-4 rounded-panel border border-(--badge-success-border) bg-(--badge-success-fill) px-6 py-4">
              <CheckCircle2 className="size-8 flex-none text-(--badge-success-text)" />
              <div className="text-[26px] font-bold text-(--badge-success-text)">
                Semua mesin online
              </div>
            </section>
          )}

          {/* ---- rotating: the healthy fleet ---- */}
          {online.length ? (
            <section
              className="flex min-h-0 flex-col gap-3"
              style={{ flex: `${onWeight} 1 0%` }}
            >
              <h2 className="flex flex-none items-center gap-3 text-xl font-semibold text-(--text-secondary)">
                <Wifi className="size-5 text-(--badge-success-text)" />
                Online
                <span className="font-mono tabular-nums">{online.length}</span>
                {pages > 1 ? (
                  <span className="font-mono text-lg text-(--text-tertiary) tabular-nums">
                    halaman {pos + 1}/{pages}
                  </span>
                ) : null}
              </h2>
              <div
                /* Keyed on the page so each turn re-runs the swipe, the same
                   way the fleet screen announces a change of subject. */
                key={pos}
                className="kswipe-in grid min-h-0 flex-1 gap-4"
                style={{
                  gridTemplateColumns: `repeat(${ONLINE_COLS}, minmax(0,1fr))`,
                  /* Rows are fixed to the page size, not to what this page
                     happens to hold: with `auto-rows-fr` a final page of two
                     machines stretched them over the whole band, so cards
                     changed size every time the rotation wrapped. */
                  gridTemplateRows: `repeat(${onRowsPerPage}, minmax(0,1fr))`,
                }}
              >
                {pageMachines.map((m) => (
                  <OnlineCard key={m.id} machine={m} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : (
        /* No rows is itself a reading — an unpaired screen, or a registry
           nobody has filled in. Saying so beats an empty black canvas. */
        <div className="grid min-h-0 flex-1 place-items-center">
          <div className="text-center">
            <div className="text-3xl font-bold text-(--text-secondary)">
              Belum ada data mesin
            </div>
            <div className="mt-2 text-xl text-(--text-tertiary)">
              Daftarkan mesin di menu Mesin Fingerprint.
            </div>
          </div>
        </div>
      )}
    </DisplayShell>
  );
}
