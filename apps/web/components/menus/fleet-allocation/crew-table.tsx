"use client";

import * as React from "react";

import {
  rosterCodeKind,
  SHIFT_KIND_LABELS,
  type RosterCode,
} from "@universe/contracts";

import { useI18n, type Dict } from "@/lib/i18n";
import type { PlanBoard } from "@/lib/queries/fleet-allocation";
import { rosterCodeLabel } from "@/lib/roster-data";
import { Badge } from "@/components/ui/badge";
import { Pagination, usePagination } from "@/components/ui/pagination";
import {
  FootSum,
  Panel,
  PanelFoot,
  Toolbar,
  ToolbarTitle,
} from "@/components/ui/panel";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { CheckFilter } from "./check-filter";

/** One operator, as a row states them. */
export type CrewMember = {
  nik: string;
  name: string;
  departmentName: string;
  /** SIMPER codes held, by name — the same set a unit is matched on. */
  skills: string[];
  /** Today's roster code, or null when the roster does not know them. */
  rosterCode: RosterCode | null;
};

/**
 * One row of the crew list: a unit with its standing operators, or a spare.
 *
 * A row is a **unit**, not a person (owner, 2026-09-16). The table has to
 * agree with the fleet setting and with the board above it, and only a
 * unit-shaped row can: a person-shaped one dropped a whole machine from the
 * list the moment both its operators were on leave — which is exactly the
 * machine somebody opens this screen to find. Spares hold nothing, so they
 * keep one row each, marked SPARE in the unit column the way their slip reads.
 */
export type CrewRow = {
  key: string;
  /** Null for a spare — the one row kind that is about a person. */
  unitCode: string | null;
  fleetLeader: string | null;
  /**
   * Crewed without a formation — a dozer, a water truck, a spare digger.
   *
   * Separate from `fleetLeader` being null, which covers two different units:
   * a support machine, and one the fleet setting left out of every formation.
   * The board names them apart, so the table does too.
   */
  fleetSupport: boolean;
  /**
   * Whether allocation is about this machine at all.
   *
   * The same rule the engine and the provisional wall apply: active, not
   * broken down, and either in a formation or flagged support. A unit outside
   * it keeps its row — the fleet setting gave it an answer and a machine
   * should not go quiet unnoticed — but it is never called empty, because
   * nobody will ever be sent to fill it (see `fleet-scope.ts`).
   */
  inAllocation: boolean;
  area: string | null;
  /** A unit holds 0–2 of them; a spare row holds exactly himself. */
  crew: CrewMember[];
};

/** Whether today's code puts them on a shift at all. */
function works(code: RosterCode | null): boolean {
  if (!code) return false;
  const kind = rosterCodeKind(code);
  return kind === "day" || kind === "night";
}

/** Sentinels for the two groups of units that carry no leader code. */
const SUPPORT = "~support";
const NO_FLEET = "~none";

/** What the fleet filter matches a row on. */
function fleetKeyOf(row: CrewRow): string | null {
  if (row.fleetLeader) return row.fleetLeader;
  if (!row.unitCode) return null;
  return row.fleetSupport ? SUPPORT : NO_FLEET;
}

/** Whether the roster puts this operator on the shift being prepared. */
function onShift(member: CrewMember, shift: string): boolean {
  if (!member.rosterCode) return false;
  return shift === "all"
    ? works(member.rosterCode)
    : rosterCodeKind(member.rosterCode) === shift;
}

/**
 * A unit nobody will drive on the shift being prepared.
 *
 * Judged against that shift rather than against the day as a whole, because
 * that is the question: a unit whose only working operator is on nights is
 * just as empty at the morning muster as one whose crew is all on leave. With
 * "Semua shift" chosen it widens back to nobody working at all.
 */
function vacant(row: CrewRow, shift: string): boolean {
  return row.inAllocation && !row.crew.some((c) => onShift(c, shift));
}

/**
 * Which shift the table opens on (owner, 2026-09-16).
 *
 * Whoever opens this screen is preparing the shift they are standing in, and
 * the answer is on the clock: before noon the day shift is the one being
 * mustered, after it the night one. Read once at mount, like the date filter
 * on the Actual tab — a table that re-filtered itself at 12:00 under a reader
 * who was mid-scroll would be worse than one that is briefly stale.
 */
function shiftNow(): string {
  return new Date().getHours() < 12 ? "day" : "night";
}

const memberOf = (person: {
  nik: string;
  name: string;
  departmentName: string;
  skills: string[];
  rosterCode: string | null;
}): CrewMember => ({
  nik: person.nik,
  name: person.name,
  departmentName: person.departmentName,
  skills: person.skills,
  rosterCode: (person.rosterCode as RosterCode | null) ?? null,
});

/**
 * The crew, from the composed PLAN board.
 *
 * Every unit the board carries is a row — including one nobody is paired to,
 * because the three readings of a formation (fleet setting, board, this
 * table) have to name the same machines. The spares follow, by name.
 */
export function crewRows(board: PlanBoard | undefined): CrewRow[] {
  if (!board) return [];
  const areaOf = new Map(board.fleets.map((f) => [f.id, f.area]));
  const units: CrewRow[] = board.units.map((unit) => ({
    key: `unit:${unit.code}`,
    unitCode: unit.code,
    fleetLeader: unit.fleet?.leaderCode ?? null,
    fleetSupport: unit.fleetSupport,
    inAllocation:
      unit.status !== "breakdown" && (unit.fleet !== null || unit.fleetSupport),
    area: unit.fleet ? (areaOf.get(unit.fleet.id) ?? null) : null,
    crew: unit.slots.map(memberOf),
  }));
  /* A unit outside every formation still belongs among the machines rather
     than among the spares. `~` sorts after every letter and digit, which puts
     it at the end of them without a second comparison. */
  const rank = (r: CrewRow) =>
    r.fleetLeader ?? (r.fleetSupport ? "~support" : "~none");
  units.sort(
    (a, b) =>
      rank(a).localeCompare(rank(b)) ||
      (a.unitCode ?? "").localeCompare(b.unitCode ?? "")
  );
  const spares: CrewRow[] = board.spares
    .map((s) => ({
      key: `spare:${s.nik}`,
      unitCode: null,
      fleetLeader: null,
      fleetSupport: false,
      inAllocation: false,
      area: null,
      crew: [memberOf(s)],
    }))
    .sort((a, b) => a.crew[0]!.name.localeCompare(b.crew[0]!.name));
  return [...units, ...spares];
}

/** How a fleet reads on screen: its leader's code, or the group's name. */
function fleetLabel(t: Dict, key: string): string {
  if (key === SUPPORT) return t.faSupport;
  if (key === NO_FLEET) return t.faCrewNoFleet;
  return key;
}

const Dash = () => (
  <span className="font-mono text-xs text-(--text-tertiary)">—</span>
);

/** The roster code as a badge — colour follows whether it is a working day. */
function RosterBadge({ t, code }: { t: Dict; code: RosterCode | null }) {
  if (!code) return <Dash />;
  const kind = rosterCodeKind(code);
  const shift = kind === "day" || kind === "night";
  return (
    <Badge
      variant={shift ? "success" : "warning"}
      title={rosterCodeLabel(t, code)}
      className="font-mono"
    >
      {code}
    </Badge>
  );
}

/**
 * The crew list under the PLAN board.
 *
 * It replaces the pool of spare cards, which showed only the half of the
 * workforce that holds nothing: a supervisor preparing a shift asks which
 * machine has who on it today, and half an answer to that sent them to the
 * board to reconstruct the other half by hand.
 *
 * Every filter is client-side over the board's own payload. The board already
 * carries the whole register and the whole pool, so a second, paginated
 * endpoint would only add a way for the two halves of one screen to disagree.
 */
export function CrewTable({ board }: { board: PlanBoard | undefined }) {
  const { t } = useI18n();
  const all = React.useMemo(() => crewRows(board), [board]);

  const [q, setQ] = React.useState("");
  const [deptF, setDeptF] = React.useState("all");
  const [fleetF, setFleetF] = React.useState("all");
  const [kindF, setKindF] = React.useState("all");
  const [shiftF, setShiftF] = React.useState(shiftNow);
  const [vacantF, setVacantF] = React.useState("all");
  const [skillF, setSkillF] = React.useState<string[]>([]);

  /* Each filter offers what the data holds and nothing else: an option that
     can only ever return zero rows is a promise the table cannot keep. */
  const everyone = React.useMemo(() => all.flatMap((r) => r.crew), [all]);
  const depts = React.useMemo(
    () => [...new Set(everyone.map((c) => c.departmentName))].sort(),
    [everyone]
  );
  const skills = React.useMemo(
    () => [...new Set(everyone.flatMap((c) => c.skills))].sort(),
    [everyone]
  );
  /* Formations by leader code, then the two groups the board also offers —
     support and no-fleet — each only when such a unit exists. */
  const fleets = React.useMemo(() => {
    const leaders = [
      ...new Set(all.map((r) => r.fleetLeader).filter(Boolean)),
    ].sort() as string[];
    const rest: string[] = [];
    if (all.some((r) => r.unitCode && !r.fleetLeader && r.fleetSupport))
      rest.push(SUPPORT);
    if (all.some((r) => r.unitCode && !r.fleetLeader && !r.fleetSupport))
      rest.push(NO_FLEET);
    return [...leaders, ...rest];
  }, [all]);

  const needle = q.trim().toLowerCase();
  const shown = React.useMemo(
    () =>
      all.filter((r) => {
        if (kindF === "held" && !r.unitCode) return false;
        if (kindF === "spare" && r.unitCode) return false;
        if (fleetF !== "all" && fleetKeyOf(r) !== fleetF) return false;
        /* The shift never removes a unit — it only decides which operator
           counts as present, and so whether the unit reads as empty. Removing
           it was the first version's mistake: a unit whose day operator is on
           leave vanished from the morning list, which is precisely the unit
           the morning list is for. A spare is a person, though, so for him
           the shift still filters. */
        if (!r.unitCode && !onShift(r.crew[0]!, shiftF)) return false;
        if (vacantF === "vacant" && !vacant(r, shiftF)) return false;
        if (deptF !== "all" && !r.crew.some((c) => c.departmentName === deptF))
          return false;
        /* Any, not all: a unit asks for one code, so an operator holding any
           of the ticked ones answers the question being asked. */
        if (
          skillF.length &&
          !r.crew.some((c) => skillF.some((code) => c.skills.includes(code)))
        )
          return false;
        if (!needle) return true;
        /* The unit code searches too — "DT4017" is how somebody asks after a
           machine whose operators they do not know by name. */
        return (
          Boolean(r.unitCode?.toLowerCase().includes(needle)) ||
          r.crew.some(
            (c) =>
              c.name.toLowerCase().includes(needle) ||
              c.nik.toLowerCase().includes(needle)
          )
        );
      }),
    [all, deptF, fleetF, kindF, shiftF, vacantF, skillF, needle]
  );

  const idle = shown.filter((r) => vacant(r, shiftF)).length;
  const pg = usePagination(shown, "25");

  return (
    <Panel>
      <Toolbar className="mb-2">
        <ToolbarTitle>
          {t.faCrewTitle} ({shown.length}/{all.length})
        </ToolbarTitle>
      </Toolbar>
      {/* A row of its own, as wide as the table under it.
          Squeezed into the toolbar beside the title, seven controls collapsed
          into a huddle at the right edge and each read as narrow as its
          longest word allowed. Here they share the width evenly — the search
          taking two shares, because a name is longer than any option.

          Left to right the question narrows, and the two subjects stay apart:
          first the people (who, when, which permits), then the machines
          (formation, condition). The search sits last, where every other
          toolbar in the app keeps it.

          `autoComplete="off"` on each select is load-bearing: a native select
          keeps its previous value across a reload (the browser restores form
          state), so the table would open filtered by whatever the last reader
          chose, with nothing on screen saying so. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select
          autoComplete="off"
          aria-label={t.faCrewKindAll}
          wrapperClassName="min-w-[150px] flex-1"
          className="h-10 pr-9"
          value={kindF}
          onChange={(e) => setKindF(e.target.value)}
        >
          <option value="all">{t.faCrewKindAll}</option>
          <option value="held">{t.faCrewHeld}</option>
          <option value="spare">{t.faCrewSpare}</option>
        </Select>
        <Select
          autoComplete="off"
          aria-label={t.faCrewShiftAll}
          wrapperClassName="min-w-[150px] flex-1"
          className="h-10 pr-9"
          value={shiftF}
          onChange={(e) => setShiftF(e.target.value)}
        >
          <option value="all">{t.faCrewShiftAll}</option>
          <option value="day">{SHIFT_KIND_LABELS.day}</option>
          <option value="night">{SHIFT_KIND_LABELS.night}</option>
        </Select>
        {/* Vacancy is its own control now that the shift no longer removes
              units: the two read together as one sentence — "the morning
              shift, only the units nobody is on". */}
        <Select
          autoComplete="off"
          aria-label={t.faCrewVacantAll}
          wrapperClassName="min-w-[150px] flex-1"
          className="h-10 pr-9"
          value={vacantF}
          onChange={(e) => setVacantF(e.target.value)}
        >
          <option value="all">{t.faCrewVacantAll}</option>
          <option value="vacant">{t.faCrewVacantOnly}</option>
        </Select>
        <CheckFilter
          className="min-w-[150px] flex-1"
          label={t.faSkillFilter}
          options={skills.map((code) => ({ value: code, label: code }))}
          value={skillF}
          onChange={setSkillF}
        />
        {depts.length ? (
          <Select
            autoComplete="off"
            aria-label={t.faDeptAll}
            wrapperClassName="min-w-[150px] flex-1"
            className="h-10 pr-9"
            value={deptF}
            onChange={(e) => setDeptF(e.target.value)}
          >
            <option value="all">{t.faDeptAll}</option>
            {depts.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        ) : null}
        {fleets.length ? (
          <Select
            autoComplete="off"
            aria-label={t.faFleetAll}
            wrapperClassName="min-w-[150px] flex-1"
            className="h-10 pr-9"
            value={fleetF}
            onChange={(e) => setFleetF(e.target.value)}
          >
            <option value="all">{t.faFleetAll}</option>
            {fleets.map((f) => (
              <option key={f} value={f}>
                {fleetLabel(t, f)}
              </option>
            ))}
          </Select>
        ) : null}
        <SearchInput
          className="min-w-[220px] flex-[2]"
          placeholder={t.faCrewSearch}
          aria-label={t.faCrewSearch}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {/* The date is stated because the roster column changes at midnight: a
          tab left open overnight would otherwise present yesterday's crew as
          today's, with nothing on screen to give it away. */}
      <p className="mb-4 text-xs text-(--text-tertiary)">
        {t.faCrewSub}{" "}
        <b className="font-mono text-(--text-secondary)">
          {board?.date ?? "—"}
        </b>
        {idle ? (
          <>
            {" · "}
            <b className="text-(--color-danger-text)">{idle}</b> {t.faCrewIdle}
          </>
        ) : null}
      </p>
      {pg.rows.length ? (
        <div className="overflow-x-auto">
          <Table className="min-w-[980px]">
            <TableHeader>
              <tr>
                <TableHead>{t.faCrewThOp}</TableHead>
                <TableHead>{t.faCrewThDept}</TableHead>
                <TableHead className="w-[280px]">{t.faSkillFilter}</TableHead>
                <TableHead>{t.faCrewThRoster}</TableHead>
                <TableHead>{t.faCrewThFleet}</TableHead>
                <TableHead>{t.faCrewThUnit}</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {pg.rows.map((r) => (
                <UnitRows key={r.key} t={t} row={r} shift={shiftF} />
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="text-sm text-(--text-tertiary)">
          {all.length ? t.faNoMatch : t.faCrewEmpty}
        </p>
      )}
      <PanelFoot>
        <FootSum>
          {t.attSumA} <b>{pg.range}</b> {t.attSumB} <b>{pg.total}</b>{" "}
          {t.faCrewSumB}
        </FootSum>
        <Pagination
          page={pg.page}
          pageCount={pg.pageCount}
          onPage={pg.setPage}
          per={pg.per}
          perOptions={["25", "50", "100"]}
          onPer={pg.setPer}
        />
      </PanelFoot>
    </Panel>
  );
}

/**
 * One row — as one `<tr>` per operator, with the unit's own cells merged
 * across them.
 *
 * `rowSpan` rather than two names stacked inside one cell: each operator has
 * to line up with his own department, permits and roster code, and stacked
 * text in four separate cells drifts out of line the moment one name wraps. A
 * unit nobody is paired to still renders its row — that is the whole point of
 * the unit being the row.
 */
function UnitRows({ t, row, shift }: { t: Dict; row: CrewRow; shift: string }) {
  const lines = Math.max(1, row.crew.length);
  const fleetKey = fleetKeyOf(row);
  const unitCells = (
    <>
      <TableCell rowSpan={lines} className="whitespace-nowrap">
        {/* Never a dash for a unit: "no fleet" and "fleet support" are both
            settings somebody chose, and reading them as an absence hides that
            the fleet setting has an answer for this machine. */}
        {fleetKey ? (
          <b
            className={row.fleetLeader ? "font-mono" : "text-xs font-semibold"}
          >
            {fleetLabel(t, fleetKey)}
          </b>
        ) : (
          <Dash />
        )}
        {row.area ? (
          <span className="block text-xs text-(--text-tertiary)">
            {row.area}
          </span>
        ) : null}
      </TableCell>
      <TableCell rowSpan={lines} className="whitespace-nowrap">
        {row.unitCode ? (
          <>
            <b className="font-mono">{row.unitCode}</b>
            {/* The unit is crewed, but today nobody on it works: this is the
                vacancy the board cannot show, because there they are all
                still paired to it. */}
            {vacant(row, shift) ? (
              <Badge variant="danger" className="ml-2">
                {t.faCrewVacant}
              </Badge>
            ) : null}
            {/* Said out loud rather than left as the absence of the badge
                above: without it a broken or unformed machine with its whole
                crew on leave reads as quietly fine. */}
            {row.inAllocation ? null : (
              <Badge
                variant="neutral"
                className="ml-2"
                title={t.faCrewOutsideHint}
              >
                {t.faCrewOutside}
              </Badge>
            )}
          </>
        ) : (
          <Badge variant="neutral">{t.faCrewSpare}</Badge>
        )}
      </TableCell>
    </>
  );

  if (!row.crew.length)
    return (
      <TableRow>
        <TableCell colSpan={4} className="text-(--text-tertiary)">
          {t.faCrewNoCrew}
        </TableCell>
        {unitCells}
      </TableRow>
    );

  return (
    <>
      {row.crew.map((c, i) => (
        <TableRow key={c.nik}>
          <TableCell>
            <b
              className="block truncate text-[13px] font-semibold"
              title={c.name}
            >
              {c.name}
            </b>
            <span className="block font-mono text-xs text-(--text-tertiary)">
              {c.nik}
            </span>
          </TableCell>
          {/* The department is a column rather than a badge beside the name:
              it is one of the things this table is filtered by, and a filtered
              column reads down the page. */}
          <TableCell>
            <span
              className="block max-w-[190px] truncate text-xs"
              title={c.departmentName}
            >
              {c.departmentName}
            </span>
          </TableCell>
          <TableCell>
            {c.skills.length ? (
              <span
                className="flex max-w-[280px] flex-wrap gap-1"
                title={c.skills.join(" · ")}
              >
                {c.skills.map((code) => (
                  <span
                    key={code}
                    className="rounded-chip border border-(--badge-info-border) bg-(--badge-info-fill) px-1.5 py-px font-mono text-[10px] leading-4 font-semibold text-(--color-primary-bright)"
                  >
                    {code}
                  </span>
                ))}
              </span>
            ) : (
              <Dash />
            )}
          </TableCell>
          <TableCell>
            <RosterBadge t={t} code={c.rosterCode} />
          </TableCell>
          {i === 0 ? unitCells : null}
        </TableRow>
      ))}
    </>
  );
}
