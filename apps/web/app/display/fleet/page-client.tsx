"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Bus,
  CheckCircle2,
  Hourglass,
  Pickaxe,
  Repeat2,
  Truck,
  UserX,
} from "lucide-react";

import {
  MONITOR_FLEETS_PER_PAGE,
  SHIFT_KIND_LABELS,
} from "@universe/contracts";

import { isStatus } from "@/lib/api";
import {
  fleetDisplayQueryOptions,
  fleetPhotoUrl,
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

/**
 * How a slot reads at six metres: filled by plan, filled by someone else, empty.
 *
 * Spare and manual share amber because the header counts them as one number,
 * under one amber card, labelled Spare — a badge in a different colour from
 * the tile that counts it reads as a different thing, and someone standing in
 * front of the wall counting cyan cards against an amber four would be right
 * to think one of them was wrong. The word still separates them: both are a
 * seat filled by someone other than its planned holder, and which of the two
 * says only how that came about.
 */
function toneOf(unit: FleetDisplayUnit): {
  tone: DisplayTone;
  label: string;
} {
  if (!unit.employeeName) return { tone: "danger", label: "Kosong" };
  if (unit.source === "spare") return { tone: "warning", label: "Spare" };
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

/**
 * The operator's photograph filling the card, with their initials underneath.
 *
 * Underneath rather than instead: a wall runs unattended for weeks, and every
 * way a photo can fail to arrive — no file on the volume, the API unreachable
 * between polls, a face added to the register after this card was drawn — must
 * land on the initials rather than on a broken-image glyph six metres up. The
 * failure is remembered by URL, as `<Avatar>` does it, so a replaced photo is
 * tried again instead of being suppressed by the previous one's failure.
 */
function OperatorFace({
  name,
  src,
  compact,
}: {
  name: string;
  src: string | null;
  compact: boolean;
}) {
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null);
  const showPhoto = !!src && failedSrc !== src;

  return (
    <div className="absolute inset-0 grid place-items-center bg-(image:--gradient-cta)">
      {showPhoto ? (
        /* Served by the API behind a session cookie, which the Next image
           optimizer cannot forward — no loader would make <Image> work here. */
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={name}
          onError={() => setFailedSrc(src)}
          /* Top-weighted, because a mugshot is framed on the face and the
             bottom of the card is under the scrim that carries the name. */
          className="absolute inset-0 size-full object-cover object-top"
        />
      ) : (
        <span
          className={cn(
            "font-bold text-(--color-on-cta) opacity-80",
            compact ? "text-[44px]" : "text-[88px]"
          )}
        >
          {initialsOf(name)}
        </span>
      )}
    </div>
  );
}

function UnitCard({
  unit,
  provisional,
  /**
   * A quadrant on a monitor wall, not the whole screen. Everything shrinks
   * together — the code, the name, the padding — because a card that kept its
   * slideshow type would push the name out and leave the unit unlabelled,
   * which is the one thing the card exists to say.
   */
  compact = false,
}: {
  unit: FleetDisplayUnit;
  provisional: boolean;
  compact?: boolean;
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
      {/* The operator fills the card: their photograph, their initials, or the
          empty-seat mark. */}
      {unit.employeeName ? (
        <OperatorFace
          name={unit.employeeName}
          src={fleetPhotoUrl(unit)}
          compact={compact}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center bg-(--fill-input)">
          <UserX
            className={cn(
              "text-(--text-disabled)",
              compact ? "size-10" : "size-20"
            )}
          />
        </div>
      )}
      {/* Scrim, so the text survives whatever is behind it. */}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(1,4,22,.65)_0%,rgba(1,4,22,0)_32%,rgba(1,4,22,0)_52%,rgba(1,4,22,.88)_100%)]" />
      <div
        className={cn(
          "absolute inset-0 flex flex-col justify-between",
          compact ? "p-2" : "p-3.5"
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <b
            className={cn(
              "min-w-0 truncate font-mono font-bold tabular-nums",
              compact ? "text-[15px]" : "text-[22px]"
            )}
            title={unit.unitCode}
          >
            {unit.unitCode}
          </b>
          <DisplayBadge
            tone={tone}
            className={cn(
              "flex-none gap-1.5 py-0.5 [&>span]:size-2",
              compact ? "px-1.5 text-[11px]" : "px-2.5 text-sm"
            )}
          >
            {label}
          </DisplayBadge>
        </div>
        <div className="min-w-0">
          <div
            className={cn(
              "line-clamp-1 leading-tight font-bold",
              compact ? "text-[14px]" : "text-[21px]"
            )}
          >
            {unit.employeeName ?? "Belum ada operator"}
          </div>
          <div
            className={cn(
              "mt-0.5 flex items-baseline gap-2.5 font-mono text-(--text-secondary) tabular-nums",
              compact ? "text-[11px]" : "text-base"
            )}
          >
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

/**
 * One formation on a monitor wall: its own header, its own badges, its own
 * cards.
 *
 * Always two rows of cards; the column count follows the size of the
 * formation. That keeps card *height* fixed across quadrants — a five-unit
 * fleet gets wider cards rather than leaving half its quadrant empty, and a
 * fourteen-unit fleet narrows instead of spilling. Two rows also means the
 * grid always holds `2 * ceil(n / 2) >= n`, so nothing is ever cut and the
 * wall keeps its promise that an idle unit is never summarised away.
 *
 * Cards here are far smaller than on a single-fleet wall (~115-278 x 134 px
 * against 241x312). What decides legibility is not the pixel count but the
 * physical size of the panel: on an 80-inch TV, 1920 px spans 177 cm, so
 * 1 px is 0.92 mm — a 115 px card is ~10.6 cm wide and a 15 px name ~1.4 cm
 * tall. The operator's photograph is the part that survives shrinking best,
 * because a face is recognised rather than read.
 */
function FleetQuadrant({
  fleet,
  provisional,
  className,
  style,
}: {
  fleet: FleetDisplayFleet;
  provisional: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const cols = Math.max(3, Math.ceil(fleet.units.length / 2));

  return (
    <div
      style={style}
      className={cn(
        "flex min-h-0 flex-col gap-2.5 rounded-card border border-(--glass-2-border) bg-(--glass-2-fill) px-4.5 py-3.5",
        /* The quadrant itself goes red when someone in it is missing, so an
           empty seat is visible before anyone reads a single card. */
        fleet.idle > 0 && !provisional && "border-[rgba(252,60,59,.45)]",
        className
      )}
    >
      <div className="flex flex-none items-baseline gap-3">
        {/* The formation's name is its digger, everywhere in this app — an
            ordinal would be a vocabulary the yard does not use. */}
        <b className="truncate font-mono text-[26px] leading-none font-bold">
          Fleet {fleet.diggerCode}
        </b>
        <span className="ml-auto truncate text-[17px] text-(--text-secondary)">
          {fleet.area ?? "—"}
        </span>
      </div>

      <div className="flex flex-none flex-wrap items-center gap-2">
        {/* The bus, because it is how the crew gets to the formation — on a
            single-fleet wall it sits in the header for the same reason. */}
        <span className="inline-flex items-center gap-1.5 rounded-full border border-(--badge-info-border) bg-(--badge-info-fill) px-3 py-0.5 text-[16px] font-bold text-(--color-primary-bright)">
          <Bus className="size-4" />
          {fleet.busCode ?? "—"}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-(--badge-warning-border) bg-(--badge-warning-fill) px-3 py-0.5 text-[16px] font-bold text-(--badge-warning-text)">
          <Pickaxe className="size-4" />
          {fleet.diggerCode}
        </span>
        <span className="rounded-full border border-(--badge-neutral-border) bg-(--badge-neutral-fill) px-3 py-0.5 text-[16px] font-semibold text-(--badge-neutral-text)">
          {fleet.total} unit · {fleet.crewed} siap
          {fleet.idle ? ` · ${fleet.idle} kosong` : ""}
          {fleet.substituted ? ` · ${fleet.substituted} spare` : ""}
        </span>
      </div>

      <div
        className="grid min-h-0 flex-1 grid-rows-2 gap-2"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {fleet.units.map((u) => (
          <UnitCard key={u.unitId} unit={u} provisional={provisional} compact />
        ))}
      </div>
    </div>
  );
}

/**
 * A held-open slot on the last page.
 *
 * Rendered rather than collapsed on purpose: it keeps every formation in the
 * same position from one page to the next, so a crew who knows theirs appears
 * bottom-right does not have to rescan the whole wall every turn.
 */
function EmptyQuadrant({ style }: { style?: React.CSSProperties }) {
  return (
    <div
      style={style}
      className="grid place-items-center rounded-card border border-dashed border-(--divider) bg-[rgba(255,255,255,.02)]"
    >
      <span className="text-[22px] text-(--text-disabled)">—</span>
    </div>
  );
}

/*
 * One turn of a monitor: hold → close → swap the page → open.
 *
 * The animation's own durations live here rather than only in CSS, because the
 * scheduler has to know when a panel has finished closing before it swaps what
 * is inside it. If the two numbers lived apart, the contents would change
 * while the panel was still half open and the turn would read as a flicker
 * rather than as a card being flipped.
 */
const FLIP_OUT_MS = 360;
const FLIP_IN_MS = 440;
/** Between quadrants — four panels, so the sweep finishes after three steps. */
const STAGGER_MS = 70;
const CLOSE_TOTAL = FLIP_OUT_MS + STAGGER_MS * (MONITOR_FLEETS_PER_PAGE - 1);
const OPEN_TOTAL = FLIP_IN_MS + STAGGER_MS * (MONITOR_FLEETS_PER_PAGE - 1);
/** The shortest hold still worth reading, if the dwell is set below the flip. */
const MIN_HOLD_MS = 800;

type FlipPhase = "open" | "closing" | "opening";

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

  /* The screen's own type, delivered with the board. A browser previewing the
     site-wide wall is told `slideshow`, which is what it has always been. */
  const isMonitor = data?.layout === "monitor";

  const pages = React.useMemo(
    () => paginate(data?.fleets ?? []),
    [data?.fleets]
  );

  /**
   * A monitor's pages: the formations it was given, in the order it was given
   * them, four to a screen.
   *
   * A monitor is not a smaller slideshow — it is a slideshow whose subject is
   * four formations instead of one. A screen given nine turns three pages at
   * the same dwell, so the control room keeps the breadth without giving up
   * any of the pits it supervises.
   */
  const monPages = React.useMemo(() => {
    const fleets = data?.fleets ?? [];
    const count = Math.max(
      1,
      Math.ceil(fleets.length / MONITOR_FLEETS_PER_PAGE)
    );
    return Array.from({ length: count }, (_, i) =>
      fleets.slice(
        i * MONITOR_FLEETS_PER_PAGE,
        i * MONITOR_FLEETS_PER_PAGE + MONITOR_FLEETS_PER_PAGE
      )
    ).filter((page) => page.length);
  }, [data?.fleets]);

  /* Rotation comes from the screen's own setting, edited in the Display menu
     and delivered with the board. `?interval=` still wins, so a preview can be
     hurried along without touching what the TV in the yard is set to. */
  const intervalSec = Math.max(
    3,
    Number(params.get("interval")) || data?.rotateSeconds || 30
  );
  const [idx, setIdx] = React.useState(0);
  const turns = isMonitor ? monPages.length : pages.length;

  /* A slideshow keeps its plain interval: one subject leaves, the next slides
     in, and a progress bar says how long is left. */
  React.useEffect(() => {
    if (isMonitor || turns < 2) return;
    const id = setInterval(() => setIdx((i) => i + 1), intervalSec * 1000);
    return () => clearInterval(id);
  }, [isMonitor, intervalSec, turns]);

  /*
   * A monitor turns differently, and it has to: four panels sliding together
   * reads as the whole screen jumping, where four panels flipping in place
   * reads as each quadrant changing its own contents. So one turn is a
   * three-phase machine — hold, close, swap, open — rather than one interval.
   * Written as phases that each schedule their own successor, because a single
   * interval in a browser-throttled tab stacks timers and leaves panels stuck
   * half-closed.
   */
  const [phase, setPhase] = React.useState<FlipPhase>("open");
  const holdMs = Math.max(
    MIN_HOLD_MS,
    intervalSec * 1000 - CLOSE_TOTAL - OPEN_TOTAL
  );
  React.useEffect(() => {
    if (!isMonitor || turns < 2) return;
    if (phase === "open") {
      const t = setTimeout(() => setPhase("closing"), holdMs);
      return () => clearTimeout(t);
    }
    if (phase === "closing") {
      const t = setTimeout(() => {
        setIdx((i) => i + 1);
        setPhase("opening");
      }, CLOSE_TOTAL);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setPhase("open"), OPEN_TOTAL);
    return () => clearTimeout(t);
  }, [isMonitor, phase, turns, holdMs]);

  /* Clamped during render, not corrected in an effect: fixing the index in an
     effect means one render uses a page outside the range, and the wall blinks
     empty before showing the right thing. */
  const pos = turns ? idx % turns : 0;
  const page = pages[pos];
  const grid = gridOf(page?.units.length ?? 0);

  /* Always MONITOR_FLEETS_PER_PAGE slots. The blanks on the last page are
     rendered rather than dropped so that a formation keeps its position from
     one turn to the next. */
  const slots = React.useMemo(() => {
    const shown = monPages[pos] ?? [];
    return Array.from(
      { length: MONITOR_FLEETS_PER_PAGE },
      (_, i) => shown[i] ?? null
    );
  }, [monPages, pos]);
  const shownCount = monPages[pos]?.length ?? 0;

  const flipClass =
    phase === "closing"
      ? "display-flip [animation:kflip-out_360ms_cubic-bezier(.4,0,.9,.3)_both]"
      : phase === "opening"
        ? "display-flip [animation:kflip-in_440ms_cubic-bezier(.12,.72,.3,1)_both]"
        : undefined;

  /* A monitor is headed by the screen's own name — it shows four formations,
     so no one of them can name it, and the name is what the control room calls
     the wall. A slideshow is headed by the formation on the glass. `?name=` is
     the preview's stand-in for a paired TV's registered name. */
  const screenName = data?.deviceName ?? params.get("name");
  const shiftLabel = data?.shift ? SHIFT_KIND_LABELS[data.shift] : null;
  const title = isMonitor
    ? (screenName ?? "Alokasi Aktual")
    : page
      ? `Fleet ${page.fleet.diggerCode}`
      : "Alokasi Aktual";
  /* Site-wide counts belong to a slideshow, whose header is about the one
     formation on the glass. A monitor's header would be about four, so it
     drops the tiles entirely and each quadrant carries its own numbers —
     which also gives the cards back the height the tiles were taking. */
  const stats = isMonitor
    ? []
    : [
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
      ];

  return (
    <DisplayShell
      title={title}
      /* No name badge on this wall: a monitor already carries the screen's
         name as its heading, and on a slideshow the badge was a second answer
         to a question the formation title had already answered. The other
         kiosks keep theirs — they have no name in their heading. */
      displayKind="fleet"
      disconnected={disconnected}
      staleSince={dataUpdatedAt || null}
      meta={
        <>
          {/* The wall turns from day to night by itself, so which shift it is
              showing is something only the header can say. */}
          {shiftLabel ? (
            <span className="inline-flex flex-none items-center gap-2.5 rounded-full border border-(--badge-info-border) bg-(--badge-info-fill) px-4.5 py-1 font-bold text-(--color-primary-bright)">
              Shift {shiftLabel}
            </span>
          ) : null}
          {/* Said in words as well as in styling: dimmed cards tell a
              passer-by that something is different, this tells them what.
              Kept on both layouts because it is an alarm, not a label — the
              wall is showing a line-up nobody has checked yet. */}
          {data?.provisional ? (
            <span className="inline-flex flex-none items-center gap-2.5 rounded-full border border-(--badge-warning-border) bg-(--badge-warning-fill) px-4.5 py-1 font-bold text-(--badge-warning-text)">
              <Hourglass className="size-6" />
              Line-up sementara — belum digenerate
            </span>
          ) : null}

          {/* A monitor heads itself with where it is and which turn it is on.
              From a distance the page counter is what tells a crew their fleet
              is coming round shortly — without it the wall reads as four
              formations changing on their own. */}
          {isMonitor ? (
            data?.fleets.length ? (
              <span className="truncate">
                Halaman <b className="text-(--text-primary)">{pos + 1}</b>/
                {turns}
                <span className="mx-3 text-(--text-tertiary)">|</span>
                fleet {pos * MONITOR_FLEETS_PER_PAGE + 1}–
                {pos * MONITOR_FLEETS_PER_PAGE + shownCount} dari{" "}
                {data.fleets.length}
              </span>
            ) : null
          ) : (
            /* A slideshow heads itself with the formation on the glass: where
               it works, and the bus that gets its crew there. */
            <>
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
            </>
          )}
        </>
      }
      /* Rotation progress — the segmented story bar, one segment a page. */
      topBar={
        !isMonitor && turns > 1 ? (
          <div className="flex gap-2">
            {Array.from({ length: turns }, (_, i) => i).map((i) => (
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
      /* The formation's own counts, not the site's (owner, 2026-08-29).
         Someone standing in front of the Pit 3 screen acts on Pit 3, and a
         site-wide number here would be read as this fleet's and be wrong.
         They count the whole formation even when it spans two pages — a
         header that recounted itself every twelve seconds is unreadable. */
      stats={stats}
    >
      {isMonitor ? (
        shownCount ? (
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            {/* Keyed on the page so the panels remount each turn and the
                opening flip always starts from zero — without it React reuses
                the old nodes and the quadrants merely appear. */}
            <div
              key={pos}
              className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-6 perspective-[2200px]"
            >
              {slots.map((f, i) =>
                f ? (
                  <FleetQuadrant
                    key={f.id}
                    fleet={f}
                    provisional={data?.provisional ?? false}
                    className={flipClass}
                    style={{ animationDelay: `${i * STAGGER_MS}ms` }}
                  />
                ) : (
                  <EmptyQuadrant
                    key={`kosong-${i}`}
                    style={{ animationDelay: `${i * STAGGER_MS}ms` }}
                  />
                )
              )}
            </div>

            {turns > 1 ? (
              <div className="flex flex-none items-center justify-center gap-3">
                {Array.from({ length: turns }, (_, i) => (
                  <span
                    key={i}
                    className={cn(
                      "h-2.5 rounded-full transition-[width,background-color] duration-300",
                      i === pos
                        ? "w-14 bg-(--color-primary-bright)"
                        : "w-2.5 bg-(--fill-hover-strong)"
                    )}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 place-items-center">
            {disconnected ? null : (
              <div className="text-center">
                <div className="text-3xl font-bold text-(--text-secondary)">
                  {!data
                    ? "Memuat papan…"
                    : "Belum ada fleet yang bisa ditampilkan"}
                </div>
                <div className="mt-2 text-xl text-(--text-tertiary)">
                  {!data
                    ? " "
                    : "Pilih fleet untuk layar ini di menu Display Fleet."}
                </div>
              </div>
            )}
          </div>
        )
      ) : page ? (
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
