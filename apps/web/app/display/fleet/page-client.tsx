"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Ban,
  Bus,
  Check,
  CheckCircle2,
  CircleHelp,
  Clock3,
  Hourglass,
  Pickaxe,
  Repeat2,
  Truck,
  UserX,
  X,
  type LucideIcon,
} from "lucide-react";

import {
  FLEETS_PER_PAGE,
  isMonitorLayout,
  SHIFT_KIND_LABELS,
  SLIDE_COLS,
  SLIDE_ROWS,
  SLIDE_SIZE,
  SPARE_DEVICE_NAME,
  SUPPORT_DEVICE_NAME,
  type CardLayout,
} from "@universe/contracts";

import { isStatus } from "@/lib/api";
import {
  fleetDisplayQueryOptions,
  fleetPhotoUrl,
  type FleetDisplayFleet,
  type FleetDisplayUnit,
} from "@/lib/queries/fleet-display";
import { cn } from "@/lib/utils";

import { DisplayShell } from "../_components/display-shell";
import { DisplayBadge, type DisplayTone } from "../_components/display-table";
import { OperatorFace } from "../_components/operator-face";

/**
 * The same twelve cells as a slide, in the shape a half-screen panel wants.
 *
 * Four by three rather than the slide's six by two, and the reason is that a
 * portrait card is sized by whichever of its cell's dimensions runs out first.
 * A panel is about half as wide as the screen and nearly as tall, so six
 * columns would starve the cards of width while leaving height unused; four
 * columns spend the panel's shape instead of fighting it.
 */
const MONITOR_COLS = 4;
const MONITOR_ROWS = SLIDE_SIZE / MONITOR_COLS;
/*
 * A quarter of a `monitor-4` is the other way round: as wide as a `monitor-2`
 * panel but half its height, so it takes the slideshow's own six-by-two — the
 * shape a wide, short box wants — and the cards stay portrait.
 */
const DENSE_COLS = SLIDE_COLS;
const DENSE_ROWS = SLIDE_ROWS;

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
 * The FTW verdict, as a badge the person it is about can act on.
 *
 * Not collapsed to pass/not-pass, and the reason is the provisional window:
 * before the board is generated the wall shows the standing plan, so the
 * operator reading it may well be one savera has already refused. "Belum FTW"
 * would send them to fill in a form they already filled in, and up onto a unit
 * they must not take — the exact opposite of what the screen is for.
 *
 * `not-required` renders nothing at all rather than a green badge: the unit
 * never asked for FTW, and a reassuring mark standing for a check nobody made
 * is worse than silence.
 */
/**
 * A readiness chip as the card draws it: an icon and a short word, the way the
 * owner's reference study draws them (2026-09-22). The state is carried by
 * the icon and the colour together; `label` is the full wording, kept as the
 * icon's accessible name and the chip's identity.
 */
type Chip = {
  tone: DisplayTone;
  icon: LucideIcon;
  text: string;
  label: string;
};

const FTW_BADGE: Record<NonNullable<FleetDisplayUnit["ftw"]>, Chip | null> = {
  pass: { tone: "success", icon: Check, text: "FTW", label: "Lolos FTW" },
  missing: {
    tone: "neutral",
    icon: Hourglass,
    text: "FTW",
    label: "Belum FTW",
  },
  fail: { tone: "danger", icon: X, text: "FTW", label: "Tidak lolos FTW" },
  late: { tone: "warning", icon: Clock3, text: "FTW", label: "FTW terlambat" },
  unreadable: {
    tone: "warning",
    icon: CircleHelp,
    text: "FTW",
    label: "FTW tak terbaca",
  },
  "not-required": null,
};

/**
 * Which of the shift's two gates have already shut, served with the board.
 *
 * The two badges below are the only things on this wall that mean different
 * things at different hours, and this is what tells them which hour it is.
 */
type Gates = { ftw: boolean; finger: boolean };

/**
 * "Belum" while there is still time, "Tidak" once there is not.
 *
 * One missing reading, two things worth saying. At 04:10 an operator with no
 * FTW row simply has not got to it, and grey is a to-do list. At 06:00 the
 * same empty row is a person who never filed one and whose unit the board has
 * already handed to somebody else — and a screen still saying "Belum" there is
 * quietly wrong, because it describes a wait that ended an hour ago.
 *
 * Only the empty case moves. A refusal, a late upload and an unreadable one
 * are facts about the morning whatever time it is read, and they keep the
 * colours they had.
 */
function ftwBadge(unit: FleetDisplayUnit, gates: Gates): Chip | null {
  if (!unit.ftw) return null;
  /* Ban rather than the refusal's X: never filed is a different fact from
     filed and refused, and with the words gone the icon has to say which. */
  if (unit.ftw === "missing" && gates.ftw)
    return { tone: "danger", icon: Ban, text: "FTW", label: "Tidak FTW" };
  return FTW_BADGE[unit.ftw];
}

/**
 * The tap, as a time or its absence — green once it exists (owner,
 * 2026-09-02), and grey or red before that on the same rule as FTW above.
 *
 * The pair reads as one sentence: green is what is done, grey is what is still
 * owed, red is what is no longer coming. Green means "tapped", not "tapped in
 * time" — the wall holds the moment, not the verdict — and the deliberate
 * consequence is that a late arrival shows a green time. That is the
 * operator's own clock to read; the board is where lateness is decided.
 *
 * "Absen" rather than "tap", which is the word on the audit screen: this one
 * is read by people standing in the yard, and it should use theirs.
 */
function fingerBadge(unit: FleetDisplayUnit, gates: Gates): Chip {
  if (unit.tappedAt) {
    const at = unit.tappedAt.slice(0, 5);
    return { tone: "success", icon: Clock3, text: at, label: `Absen ${at}` };
  }
  /* The clock with an empty time: the colour says whether it is still owed
     (grey) or no longer coming (red). */
  return gates.finger
    ? { tone: "danger", icon: Clock3, text: "--:--", label: "Tidak Absen" }
    : { tone: "neutral", icon: Clock3, text: "--:--", label: "Belum Absen" };
}

/*
 * The slide's shape no longer depends on what is standing in it.
 *
 * It used to: the columns were computed from the unit count, so a formation of
 * five got five wide cards and a formation of fourteen got seven narrow ones.
 * That made a card a different size on every turn of the rotation, and the
 * crew watching for their own unit had to re-read the whole wall each time.
 *
 * Now every slide is `SLIDE_COLS` x `SLIDE_ROWS` — formations and support
 * alike — and one short of units fills the rest with blanks (owner,
 * 2026-09-04). A card is therefore one size for the life of the screen.
 */

/**
 * A card is portrait, because the photograph in it is.
 *
 * 3:4, and sized to whichever of the cell's two dimensions runs out first —
 * `min(100cqw, 75cqh)` — so the card is as large as its cell allows and never
 * spills out of it. Letting the grid stretch the card instead gave a different
 * aspect on every screen, and the operator's face, which is the part of this
 * wall that reads from six metres, was the thing being stretched.
 */
const PORTRAIT_CARD = "aspect-[3/4] w-[min(100cqw,75cqh)]";

/** What a group is called on screen. Support has no leader to be named after. */
const fleetTitle = (fleet: { kind: string; leaderCode: string | null }) =>
  fleet.kind === "support"
    ? SUPPORT_DEVICE_NAME
    : fleet.kind === "spare"
      ? SPARE_DEVICE_NAME
      : `Fleet ${fleet.leaderCode ?? "—"}`;

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
  /** Exactly one entry per cell of the grid; `null` is a cell held open. */
  cells: (FleetDisplayUnit | null)[];
  part: number;
  parts: number;
};

function paginate(fleets: FleetDisplayFleet[]): Page[] {
  return fleets.flatMap((fleet) => {
    const parts = Math.max(1, Math.ceil(fleet.units.length / SLIDE_SIZE));
    return Array.from({ length: parts }, (_, i) => {
      const units = fleet.units.slice(i * SLIDE_SIZE, (i + 1) * SLIDE_SIZE);
      return {
        key: `${fleet.id ?? "none"}-${i}`,
        fleet,
        /* Padded to a full grid rather than cut short: the empty cells are
           what keep the eleventh card in the same place whether the formation
           has eleven units or five. */
        cells: Array.from({ length: SLIDE_SIZE }, (_, j) => units[j] ?? null),
        part: i + 1,
        parts,
      };
    });
  });
}

/** How the seat is filled — Plan, Spare, Manual or Kosong — as a badge. */
function SeatBadge({
  unit,
  compact,
}: {
  unit: FleetDisplayUnit;
  compact: boolean;
}) {
  const { tone, label } = toneOf(unit);
  return (
    <DisplayBadge
      tone={tone}
      className={cn(
        "flex-none gap-1.5 py-0.5 [&>span]:size-2",
        compact ? "px-1.5 text-[11px]" : "px-2.5 text-sm"
      )}
    >
      {label}
    </DisplayBadge>
  );
}

/**
 * What a card says, in the order it is read: the unit and how its seat is
 * filled, then who is in it, where they work, and what they still owe.
 *
 * One definition for both card layouts, so choosing a look on the Display
 * menu can never change what the wall says — only where it sits.
 */
function CardDetails({
  unit,
  gates,
  compact,
  dense,
  showArea,
  cardLayout,
}: {
  unit: FleetDisplayUnit;
  gates: Gates;
  compact: boolean;
  dense: boolean;
  showArea: boolean;
  cardLayout: CardLayout;
}) {
  return (
    <div className="min-w-0">
      {/* On a Monitor 4 card the code has the row to itself (owner,
          2026-09-22): sharing it with the seat badge cut "DT4012" to "DT4…",
          and the code is the one thing the card exists to say. The badge sits
          in the photo's top-right corner instead (see `UnitCard`), where it
          costs no row. A Monitor 2 card is wide enough for both. */}
      <div className="flex items-center justify-between gap-2">
        {/* The unit code is what the yard looks for, so it leads either way.
            Cyan over the photograph, as the overlay's identifier line is;
            plain on the identity card, where the cyan is the rule above it. */}
        <b
          className={cn(
            "min-w-0 truncate font-mono font-bold tabular-nums",
            cardLayout === "overlay" && "text-(--color-primary-bright)",
            compact ? "text-[15px]" : "text-[22px]"
          )}
          title={unit.unitCode}
        >
          {unit.unitCode}
        </b>
        {dense ? null : <SeatBadge unit={unit} compact={compact} />}
      </div>
      {/* An empty seat on a Monitor 4 card says nothing more here: the red
          badge and the empty-seat mark already said it, and the words were
          being truncated to "Belum ada…" anyway. */}
      {unit.employeeName || !dense ? (
        <div
          className={cn(
            "mt-0.5 line-clamp-1 leading-tight font-bold",
            compact ? "text-[14px]" : "text-[21px]"
          )}
        >
          {unit.employeeName ?? "Belum ada operator"}
        </div>
      ) : null}
      {/* The area gets a line of its own: it is prose, and long enough
          ("PANEL EAST - UTARA BAWAH") that sharing a row with the badges
          would push them onto a second one anyway. */}
      {showArea ? (
        <div
          className={cn(
            "mt-1 flex min-w-0 items-center gap-1.5 font-bold text-(--badge-warning-text)",
            compact ? "text-[11px]" : "text-[15px]"
          )}
        >
          <Pickaxe
            className={cn("flex-none", compact ? "size-3" : "size-3.5")}
          />
          <span className="truncate">{unit.unitArea ?? "—"}</span>
        </div>
      ) : null}
      {/* The bus and the two readiness verdicts, on one row.
          The NIK left it on 2026-09-04: the card carries the operator's
          photograph and their name, and a number identifying somebody
          already looking out of the card is height a quadrant on a monitor
          wall does not have to spare. It is still fetched — the photo is
          addressed by it.

          `items-center`, not `items-baseline` — a pill has no baseline to
          share with what sits beside it, and aligning to one sits it low.

          The badges matter most before the board exists. Between a shift's
          changeover and `spare-validate` the wall shows the standing plan,
          and for the operator walking to the gate "Belum FTW" and "Belum
          Absen" are the whole of what they still owe. Once the gates shut
          they turn red and reword themselves — see `ftwBadge`. */}
      <div
        className={cn(
          "mt-1 flex min-w-0 flex-wrap items-center font-mono text-(--text-secondary) tabular-nums",
          dense
            ? "gap-0.5 text-[11px]"
            : compact
              ? "gap-1 text-[11px]"
              : "gap-1.5 text-base"
        )}
      >
        {/* Absent rather than dashed: a unit with no vehicle recorded is
            not the same statement as one whose vehicle is unknown, and on a
            wall read at ten metres a dash is only noise. */}
        {unit.busCode ? (
          <DisplayBadge
            tone="info"
            className={cn(
              "flex-none gap-1 py-0 font-mono [&>span]:hidden",
              dense
                ? "px-1 text-[10px]"
                : compact
                  ? "px-1.5 text-[10px]"
                  : "px-2 text-[13px]"
            )}
          >
            <Bus className={compact ? "size-2.5" : "size-3"} />
            {unit.busCode}
          </DisplayBadge>
        ) : null}
        {/* Only where there is somebody they are about: an idle unit is
            already saying the one thing it has to say. */}
        {unit.employeeName
          ? [ftwBadge(unit, gates), fingerBadge(unit, gates)]
              .filter((badge): badge is Chip => !!badge)
              .map((badge) => (
                <DisplayBadge
                  key={badge.label}
                  tone={badge.tone}
                  className={cn(
                    /* The icon replaces the tone dot, as on the bus chip. */
                    "flex-none gap-1 py-0 font-mono [&>span]:hidden",
                    dense
                      ? "px-1 text-[10px]"
                      : compact
                        ? "px-1.5 text-[10px]"
                        : "px-2 text-[13px]"
                  )}
                >
                  <badge.icon
                    role="img"
                    aria-label={badge.label}
                    strokeWidth={3}
                    className={compact ? "size-2.5" : "size-3"}
                  />
                  {badge.text}
                </DisplayBadge>
              ))
          : null}
      </div>
    </div>
  );
}

function UnitCard({
  unit,
  provisional,
  gates,
  /**
   * A quadrant on a monitor wall, not the whole screen. Everything shrinks
   * together — the code, the name, the padding — because a card that kept its
   * slideshow type would push the name out and leave the unit unlabelled,
   * which is the one thing the card exists to say.
   */
  compact = false,
  /** A Monitor 4 card — smaller again than a Monitor 2 one. */
  dense = false,
  /**
   * Show where this unit is working.
   *
   * Only the support wall asks for it. A formation's members all work the one
   * place its header already names, so putting it on the cards would say it
   * sixty times over. Support has no such header — its machines are scattered,
   * and where to walk to is the question that screen exists to answer.
   *
   * The **bus is on every card**, on both walls (owner, 2026-09-04). It is a
   * fact about a unit now, not about a formation: two units of one fleet
   * legitimately ride different vehicles, and a header can only ever speak for
   * the case where they do not.
   */
  showArea = false,
  /**
   * The screen's chosen look (owner, 2026-09-22), set per device on the
   * Display menu. Both are portrait, so the wall's 3:4 cells hold either.
   */
  cardLayout,
  className,
}: {
  unit: FleetDisplayUnit;
  provisional: boolean;
  gates: Gates;
  compact?: boolean;
  dense?: boolean;
  showArea?: boolean;
  cardLayout: CardLayout;
  className?: string;
}) {
  const { tone } = toneOf(unit);
  /* The operator: their photograph, their initials, or the empty-seat mark.
     It fills whatever box it is given — the whole card on the overlay, the
     upper part on the identity card. */
  const face = unit.employeeName ? (
    <OperatorFace
      name={unit.employeeName}
      src={fleetPhotoUrl(unit)}
      compact={compact}
      /* A Monitor 4 identity photo is a short, wide box, and pinned to its
         top edge it showed foreheads. Framed lower, it shows the face. */
      imgClassName={
        dense && cardLayout === "identity" ? "object-[center_30%]" : undefined
      }
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
  );
  /* On a Monitor 4 card the seat badge rides the photo's top-right corner, so
     the unit code keeps its own row without the badge costing another one. */
  const cornerSeat = dense ? (
    <div className="absolute top-1 right-1 z-10">
      <SeatBadge unit={unit} compact />
    </div>
  ) : null;
  const details = (
    <CardDetails
      unit={unit}
      gates={gates}
      compact={compact}
      dense={dense}
      showArea={showArea}
      cardLayout={cardLayout}
    />
  );

  return (
    <div
      className={cn(
        "relative min-w-0 overflow-hidden rounded-card border border-(--glass-2-border)",
        cardLayout === "identity" && "flex flex-col bg-(--overlay-fill)",
        className,
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
      {cardLayout === "identity" ? (
        <>
          {/* Identity: the face takes the top of the card and is never
              covered, then a cyan rule, then the facts on the card's own
              surface. The photo gives up height to the details rather than
              the other way round, so a support card's extra area line never
              pushes the badges out. */}
          <div className="relative min-h-0 flex-1">
            {face}
            {cornerSeat}
          </div>
          <div
            className={cn(
              "flex-none border-t-2 border-(--color-primary-bright)",
              compact ? "px-2 py-1.5" : "px-3.5 py-2.5"
            )}
          >
            {details}
          </div>
        </>
      ) : (
        <>
          {/* Overlay: the photograph fills the card and everything
              is read in one block over its lower edge, under a single fade
              into the wall's own surface — the top of the face stays clear. */}
          {face}
          <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_30%,var(--overlay-fill)_76%)]" />
          <div
            className={cn(
              "absolute inset-x-0 bottom-0",
              compact ? "p-2" : "p-3.5"
            )}
          >
            {details}
          </div>
          {cornerSeat}
        </>
      )}
    </div>
  );
}

/**
 * One formation on a monitor wall: its own header, its own badges, its own
 * cards.
 *
 * The same twelve cells a slide holds, in four columns instead of six, with
 * the ones no unit reaches held open. That is what keeps a card the same size
 * in every panel and on every turn — the column count used to follow the size
 * of the formation, so a five-unit fleet and a fourteen-unit one drew cards of
 * two different widths side by side.
 *
 * A group larger than twelve widens the grid rather than losing its tail: a
 * panel shows one formation whole and has no second page to spill onto, and
 * the wall's promise is that an idle unit is never summarised away.
 *
 * Cards here are smaller than on a single-fleet wall. What decides legibility
 * is not the pixel count but the physical size of the panel: on an 80-inch TV,
 * 1920 px spans 177 cm, so 1 px is 0.92 mm — a 180 px card is ~16.5 cm wide
 * and a 15 px name ~1.4 cm tall. The operator's photograph is the part that
 * survives shrinking best, because a face is recognised rather than read.
 */
function FleetQuadrant({
  fleet,
  provisional,
  gates,
  cardLayout,
  dense = false,
  className,
  style,
}: {
  fleet: FleetDisplayFleet;
  provisional: boolean;
  gates: Gates;
  cardLayout: CardLayout;
  /** A quarter of a `monitor-4` rather than a half of a `monitor-2`. */
  dense?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const baseCols = dense ? DENSE_COLS : MONITOR_COLS;
  const rows = dense ? DENSE_ROWS : MONITOR_ROWS;
  /* A panel does not paginate — it is one formation, whole — so a group larger
     than the grid widens the grid rather than losing its tail. Only the
     support group ever gets there; a formation holds at most eleven, and its
     twelfth cell is held open like a slide's. */
  const overflowing = fleet.units.length > SLIDE_SIZE;
  const cols = overflowing ? Math.ceil(fleet.units.length / rows) : baseCols;
  const cells: (FleetDisplayUnit | null)[] = overflowing
    ? fleet.units
    : Array.from({ length: SLIDE_SIZE }, (_, i) => fleet.units[i] ?? null);

  return (
    <div
      style={style}
      className={cn(
        "flex min-h-0 flex-col gap-2.5 rounded-card border border-(--glass-2-border) bg-(--glass-2-fill) px-4.5 py-3.5",
        /* A quarter is half a panel's height; its heading gives some back. */
        dense && "gap-1.5 px-3 py-2",
        /* The quadrant itself goes red when someone in it is missing, so an
           empty seat is visible before anyone reads a single card. */
        fleet.idle > 0 && !provisional && "border-[rgba(252,60,59,.45)]",
        className
      )}
    >
      <div className="flex flex-none items-baseline gap-3">
        {/* The formation's name is its digger, everywhere in this app — an
            ordinal would be a vocabulary the yard does not use. */}
        <b
          className={cn(
            "truncate font-mono text-[26px] leading-none font-bold",
            dense && "text-[20px]"
          )}
        >
          {fleetTitle(fleet)}
        </b>
        <span
          className={cn(
            "ml-auto truncate text-[17px] text-(--text-secondary)",
            dense && "text-[14px]"
          )}
        >
          {fleet.area ?? "—"}
        </span>
      </div>

      <div className="flex flex-none flex-wrap items-center gap-2">
        {/* The leader names the formation; the support group is led by none.

            The bus only when the whole formation rides it — since transport
            went per unit a header can no longer speak for all of them, and a
            dash there would say "no bus" about a fleet where every card names
            one. When they differ the cards are the answer. */}
        {fleet.kind === "fleet" ? (
          <>
            {fleet.busCode ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border border-(--badge-info-border) bg-(--badge-info-fill) px-3 py-0.5 text-[16px] font-bold text-(--color-primary-bright)",
                  dense && "px-2.5 text-[13px]"
                )}
              >
                <Bus className="size-4" />
                {fleet.busCode}
              </span>
            ) : null}
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border border-(--badge-warning-border) bg-(--badge-warning-fill) px-3 py-0.5 text-[16px] font-bold text-(--badge-warning-text)",
                dense && "px-2.5 text-[13px]"
              )}
            >
              <Pickaxe className="size-4" />
              {fleet.leaderCode}
            </span>
          </>
        ) : null}
        <span
          className={cn(
            "rounded-full border border-(--badge-neutral-border) bg-(--badge-neutral-fill) px-3 py-0.5 text-[16px] font-semibold text-(--badge-neutral-text)",
            dense && "px-2.5 text-[13px]"
          )}
        >
          {fleet.total} unit · {fleet.crewed} siap
          {fleet.idle ? ` · ${fleet.idle} kosong` : ""}
          {fleet.substituted ? ` · ${fleet.substituted} spare` : ""}
        </span>
      </div>

      <div
        className="grid min-h-0 flex-1 gap-2"
        style={{
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
        }}
      >
        {cells.map((u, i) => (
          <div
            key={u?.unitId ?? `kosong-${i}`}
            className="[container-type:size] grid min-h-0 min-w-0 place-items-center"
          >
            {u ? (
              <UnitCard
                unit={u}
                provisional={provisional}
                gates={gates}
                compact
                dense={dense}
                cardLayout={cardLayout}
                className={PORTRAIT_CARD}
              />
            ) : (
              <BlankCard className={PORTRAIT_CARD} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * A cell of the grid with no unit behind it.
 *
 * Not the same thing as an idle unit, and it must not look like one: an empty
 * seat is red and alarming because it costs money by the hour, while this is
 * simply a formation smaller than the grid. So it says nothing at all — no
 * code, no icon, no word — and is drawn faintly enough that the eye passes
 * over it while the grid keeps its shape.
 */
function BlankCard({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "rounded-card border border-dashed border-(--divider) bg-[rgba(255,255,255,.015)]",
        className
      )}
    />
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
/** Between panels, so the turn sweeps across them instead of snapping. */
const STAGGER_MS = 70;
/** How long a page takes to close and to open, its last panel included. */
const closeTotal = (perPage: number) =>
  FLIP_OUT_MS + STAGGER_MS * (perPage - 1);
const openTotal = (perPage: number) => FLIP_IN_MS + STAGGER_MS * (perPage - 1);
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
  const isMonitor = data ? isMonitorLayout(data.layout) : false;
  /* Two formations a page, or four — the screen's own choice. */
  const perPage = FLEETS_PER_PAGE[data?.layout ?? "slideshow"];
  const dense = data?.layout === "monitor-4";
  const CLOSE_TOTAL = closeTotal(perPage);
  const OPEN_TOTAL = openTotal(perPage);
  const cardLayout: CardLayout = data?.cardLayout ?? "overlay";
  /* Both false until the first response lands, which is the same thing the
     badges say when the timeline cannot name a gate: nothing has closed yet,
     so nothing is written off yet. */
  const gates: Gates = {
    ftw: data?.ftwClosed ?? false,
    finger: data?.fingerClosed ?? false,
  };

  const pages = React.useMemo(
    () => paginate(data?.fleets ?? []),
    [data?.fleets]
  );

  /**
   * A monitor's pages: the formations it was given, in the order it was given
   * them, two or four to a screen.
   *
   * A monitor is not a smaller slideshow — it is a slideshow whose subject is
   * several formations instead of one. A `monitor-4` given nine turns three
   * pages at the same dwell, so the control room keeps the breadth without
   * giving up any of the pits it supervises.
   */
  const monPages = React.useMemo(() => {
    const fleets = data?.fleets ?? [];
    const count = Math.max(1, Math.ceil(fleets.length / perPage));
    return Array.from({ length: count }, (_, i) =>
      fleets.slice(i * perPage, i * perPage + perPage)
    ).filter((page) => page.length);
  }, [data?.fleets, perPage]);

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
   * A monitor turns differently, and it has to: its panels sliding together
   * reads as the whole screen jumping, where panels flipping in place
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
  }, [isMonitor, phase, turns, holdMs, CLOSE_TOTAL, OPEN_TOTAL]);

  /* Clamped during render, not corrected in an effect: fixing the index in an
     effect means one render uses a page outside the range, and the wall blinks
     empty before showing the right thing. */
  const pos = turns ? idx % turns : 0;
  const page = pages[pos];

  /* Always a full page of slots. The blanks on the last page are rendered
     rather than dropped so that a formation keeps its position from one turn
     to the next. */
  const slots = React.useMemo(() => {
    const shown = monPages[pos] ?? [];
    return Array.from({ length: perPage }, (_, i) => shown[i] ?? null);
  }, [monPages, pos, perPage]);
  const shownCount = monPages[pos]?.length ?? 0;

  const flipClass =
    phase === "closing"
      ? "display-flip [animation:kflip-out_360ms_cubic-bezier(.4,0,.9,.3)_both]"
      : phase === "opening"
        ? "display-flip [animation:kflip-in_440ms_cubic-bezier(.12,.72,.3,1)_both]"
        : undefined;

  /* A monitor is headed by the screen's own name — it shows several formations,
     so no one of them can name it, and the name is what the control room calls
     the wall. A slideshow is headed by the formation on the glass. `?name=` is
     the preview's stand-in for a paired TV's registered name. */
  const screenName = data?.deviceName ?? params.get("name");
  const shiftLabel = data?.shift ? SHIFT_KIND_LABELS[data.shift] : null;
  const title = isMonitor
    ? (screenName ?? "Alokasi Aktual")
    : page
      ? fleetTitle(page.fleet)
      : "Alokasi Aktual";
  /* Site-wide counts belong to a slideshow, whose header is about the one
     formation on the glass. A monitor's header would be about several, so it
     drops the tiles entirely and each quadrant carries its own numbers —
     which also gives the cards back the height the tiles were taking. */
  const stats = isMonitor
    ? []
    : /* The spare wall counts people, not seats: one number is the answer. */
      page?.fleet.kind === "spare"
      ? [
          {
            icon: <Repeat2 className="text-(--badge-warning-text)" />,
            iconClass:
              "bg-(--badge-warning-fill) border-(--badge-warning-border)",
            value: String(page.fleet.total),
            label: "Operator Spare",
          },
        ]
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
            iconClass:
              "bg-(--badge-danger-fill) border-(--badge-danger-border)",
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
              is coming round shortly — without it the wall reads as
              formations changing on their own. */}
          {isMonitor ? (
            data?.fleets.length ? (
              <span className="truncate">
                Halaman <b className="text-(--text-primary)">{pos + 1}</b>/
                {turns}
                <span className="mx-3 text-(--text-tertiary)">|</span>
                fleet {pos * perPage + 1}–{pos * perPage + shownCount} dari{" "}
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
              className={cn(
                "grid min-h-0 flex-1 grid-cols-2 gap-6 perspective-[2200px]",
                dense ? "grid-rows-2 gap-4" : "grid-rows-1"
              )}
            >
              {slots.map((f, i) =>
                f ? (
                  <FleetQuadrant
                    key={f.id}
                    fleet={f}
                    provisional={data?.provisional ?? false}
                    gates={gates}
                    cardLayout={cardLayout}
                    dense={dense}
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
            gridTemplateColumns: `repeat(${SLIDE_COLS}, minmax(0,1fr))`,
            gridTemplateRows: `repeat(${SLIDE_ROWS}, minmax(0,1fr))`,
          }}
        >
          {/* Each cell is its own size container, and the card inside is sized
              against it rather than stretched to fill it — that is what keeps
              the card portrait whatever shape the cell turns out to be. The
              card is centred in the slack that leaves. */}
          {page.cells.map((u, i) => (
            <div
              key={u?.unitId ?? `kosong-${i}`}
              className="[container-type:size] grid min-h-0 min-w-0 place-items-center"
            >
              {u ? (
                <UnitCard
                  unit={u}
                  provisional={data?.provisional ?? false}
                  gates={gates}
                  showArea={page.fleet.kind === "support"}
                  cardLayout={cardLayout}
                  className={PORTRAIT_CARD}
                />
              ) : (
                <BlankCard className={PORTRAIT_CARD} />
              )}
            </div>
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
