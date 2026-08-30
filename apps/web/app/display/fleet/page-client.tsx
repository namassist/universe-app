"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Bus,
  CheckCircle2,
  Hourglass,
  Repeat2,
  Truck,
  UserX,
} from "lucide-react";

import { SHIFT_KIND_LABELS } from "@universe/contracts";

import { isStatus } from "@/lib/api";
import {
  fleetDisplayQueryOptions,
  type FleetDisplayFleet,
  type FleetDisplayUnit,
} from "@/lib/queries/fleet-display";
import { cn } from "@/lib/utils";
import { initialsOf } from "@/components/ui/avatar";

import { DisplayShell } from "../_components/display-shell";
import { DisplayBadge, type DisplayTone } from "../_components/display-table";

/**
 * Display Fleet — the Actual board of the shift now running, one formation at
 * a time.
 *
 * Nothing here chooses a date or a shift. The API answers with whichever shift
 * the master timeline says is on, so the wall turns over from day to night by
 * itself and a screen left running for a month never needs touching.
 *
 * What the screen is *for* is the empty seat. An idle unit keeps its card at
 * full size, in red, in the formation it belongs to — never summarised into a
 * count, never pushed off the end of a page — because a unit standing idle is
 * the one thing here that costs money by the hour.
 */

/** How a slot reads at six metres: filled by plan, filled by someone else, empty. */
function toneOf(unit: FleetDisplayUnit): {
  tone: DisplayTone;
  label: string;
} {
  if (!unit.employeeName) return { tone: "danger", label: "Kosong" };
  if (unit.source === "spare") return { tone: "info", label: "Spare" };
  if (unit.source === "manual") return { tone: "warning", label: "Manual" };
  return { tone: "success", label: "Plan" };
}

/**
 * Cards per page, and the shape of the grid holding them.
 *
 * Columns come from the count rather than a breakpoint, so a formation of five
 * is five wide cards on one row instead of five cells and a hole. Seven across
 * is ~250 px a card on the 1920 canvas — enough for a unit code and a full
 * name without truncating either.
 */
const MAX_COLS = 7;
const MAX_ROWS = 3;
const PAGE_SIZE = MAX_COLS * MAX_ROWS;

function gridOf(count: number): { cols: number; rows: number } {
  if (count <= 0) return { cols: 1, rows: 1 };
  const rows = Math.min(MAX_ROWS, Math.ceil(count / MAX_COLS));
  return { cols: Math.min(MAX_COLS, Math.ceil(count / rows)), rows };
}

/**
 * One turn of the rotation.
 *
 * A page rather than a fleet, because the group holding units that belong to
 * no formation has no size limit — a yard's support gear can outnumber a
 * fleet several times over, and squeezing it all onto one screen would shrink
 * every card past reading. Splitting it into pages keeps a card one size at
 * any yard size, which is the same bargain the fingerprint wall strikes.
 */
type Page = {
  key: string;
  fleet: FleetDisplayFleet;
  units: FleetDisplayUnit[];
  part: number;
  parts: number;
};

function paginate(fleets: FleetDisplayFleet[]): Page[] {
  return fleets.flatMap((fleet) => {
    const parts = Math.max(1, Math.ceil(fleet.units.length / PAGE_SIZE));
    return Array.from({ length: parts }, (_, i) => ({
      key: `${fleet.id ?? "none"}-${i}`,
      fleet,
      units: fleet.units.slice(i * PAGE_SIZE, i * PAGE_SIZE + PAGE_SIZE),
      part: i + 1,
      parts,
    }));
  });
}

const clock = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleTimeString("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

function UnitCard({
  unit,
  provisional,
}: {
  unit: FleetDisplayUnit;
  provisional: boolean;
}) {
  const { tone, label } = toneOf(unit);
  return (
    <div
      className={cn(
        "relative min-w-0 overflow-hidden rounded-card border border-(--glass-2-border)",
        tone === "danger" &&
          !provisional &&
          "border-[rgba(252,60,59,.55)] shadow-[0_0_28px_rgba(252,60,59,.25)]",
        /* Unfinished, and it has to look it from across the yard: dimmed,
           desaturated, dashed. Nobody has checked FTW or the tap yet, so an
           empty unit here is not the red alarm it becomes on a real board —
           only a unit whose standing operator is off today. */
        provisional &&
          "border-dashed border-(--border-input) opacity-55 saturate-50"
      )}
    >
      {/* The operator fills the card — initials until there are photographs. */}
      {unit.employeeName ? (
        <div className="absolute inset-0 grid place-items-center bg-(image:--gradient-cta)">
          <span className="text-[88px] font-bold text-(--color-on-cta) opacity-80">
            {initialsOf(unit.employeeName)}
          </span>
        </div>
      ) : (
        <div className="absolute inset-0 grid place-items-center bg-(--fill-input)">
          <UserX className="size-20 text-(--text-disabled)" />
        </div>
      )}
      {/* Scrim, so the text survives whatever is behind it. */}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(1,4,22,.65)_0%,rgba(1,4,22,0)_32%,rgba(1,4,22,0)_52%,rgba(1,4,22,.88)_100%)]" />
      <div className="absolute inset-0 flex flex-col justify-between p-3.5">
        <div className="flex items-start justify-between gap-2">
          <b
            className="min-w-0 truncate font-mono text-[22px] font-bold tabular-nums"
            title={unit.unitCode}
          >
            {unit.unitCode}
          </b>
          <DisplayBadge
            tone={tone}
            className="flex-none gap-1.5 px-2.5 py-0.5 text-sm [&>span]:size-2"
          >
            {label}
          </DisplayBadge>
        </div>
        <div className="min-w-0">
          <div className="line-clamp-1 text-[21px] leading-tight font-bold">
            {unit.employeeName ?? "Belum ada operator"}
          </div>
          <div className="mt-0.5 flex items-baseline gap-2.5 font-mono text-base text-(--text-secondary) tabular-nums">
            {unit.employeeNik ? <span>{unit.employeeNik}</span> : null}
            {/* The tap time, because it is the half of the pass rule a
                supervisor can act on — a name with no time is someone the
                board placed off the plan, not someone who arrived. */}
            {unit.tappedAt ? (
              <span className="text-(--text-tertiary)">
                {unit.tappedAt.slice(0, 5)}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DisplayFleetPage() {
  const params = useSearchParams();
  /* `?device=` is set by the Display menu's preview button; a paired TV has a
     session instead and needs no parameter. */
  const { data, error, isError, dataUpdatedAt } = useQuery(
    fleetDisplayQueryOptions(params.get("device") ?? undefined)
  );

  /* Same split as the other kiosks: an unpaired screen is a person's errand,
     a lost API is the network's, and one banner must not stand for both. */
  const authProblem = isStatus(error, 401) || isStatus(error, 403);
  const disconnected = isError && !authProblem;

  const pages = React.useMemo(
    () => paginate(data?.fleets ?? []),
    [data?.fleets]
  );

  /* Rotation comes from the screen's own setting, edited in the Display menu
     and delivered with the board. `?interval=` still wins, so a preview can be
     hurried along without touching what the TV in the yard is set to. */
  const intervalSec = Math.max(
    3,
    Number(params.get("interval")) || data?.rotateSeconds || 30
  );
  const [idx, setIdx] = React.useState(0);
  React.useEffect(() => {
    if (pages.length < 2) return;
    const id = setInterval(() => setIdx((i) => i + 1), intervalSec * 1000);
    return () => clearInterval(id);
  }, [intervalSec, pages.length]);

  const pos = pages.length ? idx % pages.length : 0;
  const page = pages[pos];
  const grid = gridOf(page?.units.length ?? 0);

  const shiftLabel = data?.shift ? SHIFT_KIND_LABELS[data.shift] : null;
  const title = page ? `Fleet ${page.fleet.diggerCode}` : "Alokasi Aktual";

  return (
    <DisplayShell
      title={title}
      deviceName={params.get("name") ?? undefined}
      displayKind="fleet"
      disconnected={disconnected}
      staleSince={dataUpdatedAt || null}
      meta={
        <>
          {shiftLabel ? (
            <span className="inline-flex flex-none items-center gap-2.5 rounded-full border border-(--badge-info-border) bg-(--badge-info-fill) px-4.5 py-1 font-bold text-(--color-primary-bright)">
              Shift {shiftLabel}
            </span>
          ) : null}
          {/* Said in words as well as in styling: dimmed cards tell a
              passer-by that something is different, this tells them what. */}
          {data?.provisional ? (
            <span className="inline-flex flex-none items-center gap-2.5 rounded-full border border-(--badge-warning-border) bg-(--badge-warning-fill) px-4.5 py-1 font-bold text-(--badge-warning-text)">
              <Hourglass className="size-6" />
              Line-up sementara — belum digenerate
            </span>
          ) : null}
          {page?.fleet.area ? (
            <span className="truncate">{page.fleet.area}</span>
          ) : null}
          {page?.fleet.busCode ? (
            <span className="inline-flex flex-none items-center gap-2.5 rounded-full border border-(--badge-info-border) bg-(--badge-info-fill) px-4.5 py-1 font-bold text-(--color-primary-bright)">
              <Bus className="size-6" />
              Bus {page.fleet.busCode}
            </span>
          ) : null}
          {page && page.parts > 1 ? (
            <span className="flex-none font-mono text-(--text-tertiary) tabular-nums">
              {page.part}/{page.parts}
            </span>
          ) : null}
          {data?.generatedAt ? (
            <span className="flex-none text-(--text-tertiary)">
              digenerate{" "}
              <b className="font-mono tabular-nums">
                {clock(data.generatedAt)}
              </b>
            </span>
          ) : data?.provisional ? (
            <span className="flex-none text-(--text-tertiary)">
              dari pasangan tetap + roster
            </span>
          ) : null}
        </>
      }
      /* Rotation progress — the segmented story bar, one segment a page. */
      topBar={
        pages.length > 1 ? (
          <div className="flex gap-2">
            {pages.map((p, i) => (
              <span
                key={p.key}
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
      /* The formation's own counts, not the site's (owner, 2026-08-29).
         Someone standing in front of the Pit 3 screen acts on Pit 3, and a
         site-wide number here would be read as this fleet's and be wrong.
         They count the whole formation even when it spans two pages — a
         header that recounted itself every twelve seconds is unreadable. */
      stats={[
        {
          icon: <Truck className="text-(--color-primary-bright)" />,
          iconClass: "bg-(--badge-info-fill) border-(--badge-info-border)",
          value: String(page?.fleet.total ?? 0),
          label: "Unit Aktif",
        },
        {
          icon: <CheckCircle2 className="text-(--badge-success-text)" />,
          iconClass:
            "bg-(--badge-success-fill) border-(--badge-success-border)",
          value: String(page?.fleet.crewed ?? 0),
          label: "Teralokasi",
        },
        {
          icon: <UserX className="text-(--color-danger-text)" />,
          iconClass: "bg-(--badge-danger-fill) border-(--badge-danger-border)",
          value: String(page?.fleet.idle ?? 0),
          label: "Tanpa Operator",
        },
        {
          icon: <Repeat2 className="text-(--badge-warning-text)" />,
          iconClass:
            "bg-(--badge-warning-fill) border-(--badge-warning-border)",
          value: String(page?.fleet.substituted ?? 0),
          label: "Spare",
        },
      ]}
    >
      {page ? (
        <div
          /* Keyed on the page so each turn re-runs the swipe — the wall says
             out loud that the subject changed. */
          key={page.key}
          className="kswipe-in grid min-h-0 flex-1 gap-5"
          style={{
            gridTemplateColumns: `repeat(${grid.cols}, minmax(0,1fr))`,
            gridTemplateRows: `repeat(${grid.rows}, minmax(0,1fr))`,
          }}
        >
          {page.units.map((u) => (
            <UnitCard
              key={u.unitId}
              unit={u}
              provisional={data?.provisional ?? false}
            />
          ))}
        </div>
      ) : (
        /* Reached only when there is genuinely nothing to draw — a provisional
           line-up renders like any other, so "no board yet" is no longer one
           of the cases here. */
        <div className="grid min-h-0 flex-1 place-items-center">
          {disconnected ? null : (
            <div className="text-center">
              <div className="text-3xl font-bold text-(--text-secondary)">
                {!data
                  ? "Memuat papan…"
                  : !data.date
                    ? "Timeline belum menentukan shift"
                    : "Belum ada fleet yang bisa ditampilkan"}
              </div>
              <div className="mt-2 text-xl text-(--text-tertiary)">
                {!data
                  ? " "
                  : !data.date
                    ? "Atur tahap Ambil Data FTW untuk shift siang dan malam di Master Timeline."
                    : "Tidak ada unit fleet yang aktif. Unit di luar fleet tidak ditampilkan di layar."}
              </div>
            </div>
          )}
        </div>
      )}
    </DisplayShell>
  );
}
