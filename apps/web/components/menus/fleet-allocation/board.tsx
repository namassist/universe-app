"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload, UserPlus } from "lucide-react";

import { api, errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
  planBoardKey,
  planBoardQueryOptions,
  planCandidatesKey,
  planCandidatesQueryOptions,
  type PlanBoard,
} from "@/lib/queries/fleet-allocation";
import { cn } from "@/lib/utils";
import { Avatar, initialsOf } from "@/components/ui/avatar";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogIcon,
  DialogTitle,
} from "@/components/ui/dialog";
import { Pagination } from "@/components/ui/pagination";
import {
  FootSum,
  Panel,
  PanelFoot,
  Toolbar,
  ToolbarGroup,
  ToolbarTitle,
} from "@/components/ui/panel";
import { SearchInput } from "@/components/ui/search-input";
import { Segmented, SegmentedButton } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";

import { CheckFilter } from "./check-filter";
import {
  ACTUAL_UNITS,
  CANDIDATES,
  FLEET_OPTIONS,
  ftwBadge,
  siteClock,
  SPARE_INIT,
  type BoardUnit,
  type Candidate,
  type Slot,
  type SpareRow,
} from "./data";

const FA_PLAN_MAX_OPS = 2;

/**
 * The no-fleet entry's value in the formation filter.
 *
 * Not a fleet id, because it is not a fleet — it is every active unit that
 * belongs to no formation. On PLAN it is a real destination: a standing
 * pairing is a fact about a person and a machine whether or not that machine
 * is in a formation today. On ACTUAL there is nothing behind it, because the
 * engine allocates formations only, so the option is not offered there.
 */
const NO_FLEET = "no-fleet";
/**
 * Crewed without a formation — the entry Fleet Setting calls Fleet support.
 *
 * Its own option because "no fleet" was two answers in one: a dozer somebody
 * has to crew, and a forklift nobody does. This board carries the whole active
 * register, so both were sitting in the same list.
 */
const SUPPORT = "support";
/**
 * Every formation at once — and support, which is one of them.
 *
 * Added on 2026-09-04 at the owner's request: the board deliberately showed
 * one formation at a time, which answers "how is fleet X crewed" but never
 * "which units are still without an operator" — the question the unallocated
 * filter is actually asked, and one that cannot be answered eleven formations
 * at a time.
 *
 * It is the union of the options *below* it, not literally every unit on the
 * board (owner, 2026-09-04). A unit Fleet Setting left out of every formation
 * has an entry of its own, and somebody asking for all the fleets is not
 * asking for the units that are in none — those do not take part in allocation
 * at all, and on this yard they outnumber the ones that do.
 */
const ALL_FLEETS = "all";

/**
 * Whether a unit belongs to whatever the formation filter currently names.
 *
 * `noFleetOffered` is what makes "all" safe to narrow: it excludes the
 * formationless only where they have an option of their own to be found under.
 * Where that option is not offered, "all" still means all, so no unit on the
 * board is left unreachable by every choice in the list.
 */
const inSelectedFleet = (
  unit: { fleet: { id: string } | null; fleetSupport?: boolean },
  active: string,
  noFleetOffered: boolean
) => {
  if (active === ALL_FLEETS)
    return !noFleetOffered || !!unit.fleet || !!unit.fleetSupport;
  if (active === SUPPORT) return !unit.fleet && !!unit.fleetSupport;
  /* A unit on this board with no formation *is* the no-fleet entry — the whole
     active register is here on PLAN, and "no fleet" is a place rather than a
     residual, because Fleet Setting decides it. Support units left it on
     2026-09-04, when they got an entry of their own. */
  if (active === NO_FLEET) return !unit.fleet && !unit.fleetSupport;
  return unit.fleet?.id === active;
};

/**
 * How many SIMPER codes a spare card shows before it gives up and counts.
 *
 * Six, because most of the register sits at or below it — the two big clusters
 * are two codes and six — while the tail runs to twenty-three, and one card
 * carrying twenty-three badges is several times the height of the cards beside
 * it. The full list is on the card's tooltip, and the filter above is the way
 * to ask about a code that is not shown.
 */
const SPARE_SKILL_BADGES = 6;

type Filter = "all" | "unalloc" | "alloc" | "issue";
type Kind = "bd" | "none" | "warn" | "dt" | "ok";

/** A dialog row — the static candidate shape plus the pair-shift flag the
 * server adds in plan mode. */
type DialogRow = Candidate & {
  sameShift?: boolean;
  deptOk?: boolean;
  skillOk?: boolean;
  expired?: boolean;
};

/**
 * "MINING OPERATION" → "MO", "PIT SERVICE AND DEVELOPMENT" → "PSD" — the
 * badge form of a department name, connector words dropped. The full name
 * rides on the badge's title so the abbreviation never has to be guessed at.
 */
const CONNECTORS = new Set(["and", "dan", "of", "the", "&"]);
function deptAbbrev(name: string): string {
  return name
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && !CONNECTORS.has(w.toLowerCase()))
    .map((w) => w[0]!.toUpperCase())
    .join("")
    .slice(0, 4);
}

const stBadge: Record<
  BoardUnit["status"],
  { variant: BadgeVariant; label: string }
> = {
  ready: { variant: "success", label: "Ready" },
  breakdown: { variant: "danger", label: "Breakdown" },
  standby: { variant: "warning", label: "Standby" },
};

/* ---------- Dialog alokasi operator ---------- */
function AllocDialog({
  unit,
  mode,
  rows: allRows,
  onClose,
  onAssign,
}: {
  unit: BoardUnit | null;
  mode: "plan" | "actual";
  rows: DialogRow[];
  onClose: () => void;
  onAssign: (nik: string, name: string) => void;
}) {
  const { t } = useI18n();
  const [sel, setSel] = React.useState<DialogRow | null>(null);
  const [q, setQ] = React.useState("");
  const [view, setView] = React.useState<"eligible" | "all">("eligible");

  const needle = q.trim().toLowerCase();
  const rows = allRows.filter((c) => {
    if (view === "eligible" && !c.eligible) return false;
    if (!needle) return true;
    return (
      c.name.toLowerCase().includes(needle) ||
      c.nik.toLowerCase().includes(needle)
    );
  });
  const eligibleN = allRows.filter((c) => c.eligible).length;

  return (
    <Dialog
      open={!!unit}
      onClose={onClose}
      labelledBy="fa-t"
      className="w-[min(560px,100%)]"
    >
      <DialogIcon variant="info">
        <UserPlus />
      </DialogIcon>
      <DialogTitle id="fa-t">
        {t.faAssignT} {unit?.code}
      </DialogTitle>
      <DialogBody>
        {t.faDlgB} <b>{eligibleN}</b> {t.faEligibleN}.
      </DialogBody>
      <div className="mt-4 flex items-center gap-2">
        <SearchInput
          className="min-w-0 flex-1"
          placeholder={t.searchOp}
          aria-label={t.searchOp}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Segmented role="group" aria-label={t.thStatus}>
          <SegmentedButton
            type="button"
            active={view === "eligible"}
            onClick={() => setView("eligible")}
          >
            {t.faFilterEligible}
          </SegmentedButton>
          <SegmentedButton
            type="button"
            active={view === "all"}
            onClick={() => setView("all")}
          >
            {t.segAll}
          </SegmentedButton>
        </Segmented>
      </div>
      <div className="mt-3 flex max-h-[46vh] min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {rows.map((c) => {
          const blocked = !c.eligible;
          let sub = c.simperJenis ? `SIMPER ${c.simperJenis}` : t.faKompNone;
          if (c.busyAt) sub += ` · ${t.faBusy} (${c.busyAt})`;
          if (c.here) sub += ` · ${t.faBusyHere}`;
          if (c.sameShift) sub += ` · ${t.faSameShift}`;
          // The explicit mismatches, so "disabled" always says why.
          if (c.deptOk === false) sub += ` · ${t.faDeptMismatch}`;
          if (c.skillOk === false) sub += ` · ${t.faSkillMismatch}`;
          if (c.expired) sub += ` · ${t.faSimperExpired}`;
          const ftw = mode === "actual" && c.ftw ? ftwBadge[c.ftw] : null;
          return (
            <div
              key={c.nik}
              role="button"
              aria-disabled={blocked || undefined}
              onClick={() => {
                if (!blocked) setSel(c);
              }}
              className={cn(
                "flex items-center gap-3 rounded-icon border border-transparent px-3 py-2",
                blocked
                  ? "cursor-not-allowed opacity-55"
                  : "cursor-pointer hover:bg-(--fill-hover)",
                sel?.nik === c.nik &&
                  "border-[rgba(0,212,255,.4)] bg-[rgba(0,212,255,.1)]"
              )}
            >
              <Avatar className="size-[30px] text-[11px]">
                {initialsOf(c.name)}
              </Avatar>
              <div className="min-w-0 flex-1">
                <b className="block truncate text-[13px] font-semibold">
                  {c.name}
                  <span className="ml-1.5 font-mono text-xs font-normal text-(--text-tertiary)">
                    {c.nik}
                  </span>
                </b>
                <span className="text-xs text-(--text-tertiary)">{sub}</span>
              </div>
              {c.departmentName ? (
                <Badge variant="accent" title={c.departmentName}>
                  {deptAbbrev(c.departmentName)}
                </Badge>
              ) : null}
              {c.complement ? (
                <Badge variant="info" title={t.faComplement}>
                  {t.faComplement}
                </Badge>
              ) : null}
              {ftw ? (
                <Badge variant={ftw.variant} dot>
                  {t[ftw.labelKey]}
                </Badge>
              ) : null}
            </div>
          );
        })}
        {!rows.length ? (
          <p className="px-3 py-6 text-center text-sm text-(--text-tertiary)">
            {t.faNoMatch}
          </p>
        ) : null}
      </div>
      <DialogActions>
        <Button variant="ghost" onClick={onClose}>
          {t.btnCancel}
        </Button>
        <Button
          disabled={!sel}
          onClick={() => {
            if (sel) onAssign(sel.nik, sel.name);
          }}
        >
          {t.faAssign}
          {sel ? ` — ${sel.name.split(/\s+/).slice(0, 2).join(" ")}` : ""}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Server board units, in the shape the cards render. */
function toBoardUnits(board: PlanBoard | undefined): BoardUnit[] {
  return (board?.units ?? []).map((u) => ({
    code: u.code,
    brand: u.brandName,
    status: u.status,
    simperCode: u.simperCodeName,
    requiresFtw: u.requiresFtw,
    departmentName: u.departmentName,
    fleet: u.fleet ? { id: u.fleet.id, digger: u.fleet.leaderCode } : null,
    fleetSupport: u.fleetSupport,
    slots: u.slots.map((s) => ({
      nik: s.nik,
      name: s.name,
      ...(s.simperTypeName ? { simperJenis: s.simperTypeName } : {}),
    })),
  }));
}

/* ---------- Papan kartu unit (PLAN live / detail ACTUAL statis) ---------- */
export function AllocBoard({
  mode,
  canManage,
  generatedAt,
  createdAt,
}: {
  mode: "plan" | "actual";
  canManage: boolean;
  /** header ACTUAL — jejak waktu dokumen */
  generatedAt?: string | null;
  createdAt?: string;
}) {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const router = useRouter();

  // PLAN reads the server; ACTUAL stays the static port until its own
  // change lands the generation engine.
  const planQ = useQuery({
    ...planBoardQueryOptions(),
    enabled: mode === "plan",
  });
  const [localUnits, setLocalUnits] = React.useState<BoardUnit[]>(() =>
    mode === "plan"
      ? []
      : ACTUAL_UNITS.map((u) => ({ ...u, slots: [...u.slots] }))
  );
  const units = React.useMemo(
    () => (mode === "plan" ? toBoardUnits(planQ.data) : localUnits),
    [mode, planQ.data, localUnits]
  );

  const spare: SpareRow[] = React.useMemo(
    () =>
      mode === "plan"
        ? (planQ.data?.spares ?? []).map((s) => ({
            nik: s.nik,
            name: s.name,
            departmentName: s.departmentName,
            skills: s.skills,
          }))
        : SPARE_INIT,
    [mode, planQ.data]
  );
  /* Each formation carries its work area. The cards no longer do: an area is
     one fact about a fleet, and repeating it on all sixty of its units said it
     sixty times without saying anything the sixty-first did not. */
  const fleetOptions = React.useMemo(
    () =>
      mode === "plan"
        ? (planQ.data?.fleets ?? []).map((f) => ({
            id: f.id,
            digger: f.leaderCode,
            area: f.area,
          }))
        : FLEET_OPTIONS,
    [mode, planQ.data]
  );

  const [spareQ, setSpareQ] = React.useState("");
  const [spareDeptF, setSpareDeptF] = React.useState("all");
  /* SIMPER codes are a *set*, not a single choice: an operator holds several,
     and someone browsing the pool is asking "who can drive this", which more
     than one code can answer. Empty means no restriction. */
  const [spareSkillF, setSpareSkillF] = React.useState<string[]>([]);
  const [sparePage, setSparePage] = React.useState(1);
  const [sparePer, setSparePer] = React.useState("12");
  const [filter, setFilter] = React.useState<Filter>("all");
  /* Empty until someone chooses, rather than a fleet id nobody picked. The
     board always shows exactly one formation now — there is no "all" to fall
     back to — so the choice is *derived* below instead of guessed at here,
     which also survives the formation list arriving after the first render. */
  const [fleetF, setFleetF] = React.useState("");
  const [q, setQ] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [per, setPer] = React.useState("6");
  const [allocFor, setAllocFor] = React.useState<BoardUnit | null>(null);

  /**
   * The formation actually on screen.
   *
   * Derived rather than stored, so nothing has to run after the fleet list
   * arrives: until the operator picks something — and if their pick stops
   * existing, as it does when a fleet is disbanded — the board falls back to
   * the first formation Fleet Setting offers, and to the no-fleet entry when
   * there are no formations at all.
   */
  const noFleetOffered = mode === "plan";
  /* Only when the site actually has support units — an option that filters to
     nothing is a question with no answer behind it. */
  const supportOffered = noFleetOffered && units.some((u) => u.fleetSupport);
  const activeFleet =
    fleetF === ALL_FLEETS ||
    (noFleetOffered && fleetF === NO_FLEET) ||
    (supportOffered && fleetF === SUPPORT) ||
    fleetOptions.some((f) => f.id === fleetF)
      ? fleetF
      : (fleetOptions[0]?.id ?? (noFleetOffered ? NO_FLEET : ""));

  const canEdit = mode === "plan" && canManage;
  /* intervensi manual terbatas: pasca-generate, slot kosong saja */
  const canIntervene = mode === "actual" && canManage && !!generatedAt;

  const invalidatePlan = (unitCode: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: planBoardKey }),
      queryClient.invalidateQueries({
        queryKey: planCandidatesKey(unitCode),
      }),
    ]);

  const assignM = useMutation({
    mutationFn: async (input: {
      unitCode: string;
      nik: string;
      name: string;
    }) => {
      const result = await api.v1["fleet-allocation"].plan.slots.post({
        unitCode: input.unitCode,
        nik: input.nik,
      });
      if (result.error) throw result.error;
      return result.data;
    },
    onSuccess: async (_d, input) => {
      await invalidatePlan(input.unitCode);
      pushToast("success", `${input.name} → ${input.unitCode}`, t.faToastDoD);
      setAllocFor(null);
    },
    onError: (error) =>
      pushToast("error", t.faAssign, errorMessage(error, t.loginErr)),
  });

  const releaseM = useMutation({
    mutationFn: async (input: {
      unitCode: string;
      nik: string;
      name: string;
    }) => {
      const { error } = await api.v1["fleet-allocation"].plan
        .slots({ unitCode: input.unitCode })({ nik: input.nik })
        .delete();
      if (error) throw error;
    },
    onSuccess: async (_d, input) => {
      await invalidatePlan(input.unitCode);
      pushToast(
        "info",
        `${input.name} ${t.faToastRelT} ${input.unitCode}`,
        t.faToastRelD
      );
    },
    onError: (error) =>
      pushToast("error", t.faRelease, errorMessage(error, t.loginErr)),
  });

  // The dialog's candidates: served per unit in plan mode, static in actual.
  const candidatesQ = useQuery({
    ...planCandidatesQueryOptions(allocFor?.code ?? ""),
    enabled: mode === "plan" && !!allocFor,
  });
  const dialogRows: DialogRow[] = React.useMemo(() => {
    if (mode !== "plan") return CANDIDATES;
    return (candidatesQ.data ?? []).map((c) => ({
      nik: c.nik,
      name: c.name,
      ...(c.simperTypeName ? { simperJenis: c.simperTypeName } : {}),
      departmentName: c.departmentName,
      eligible: c.eligible,
      ...(c.busyAt ? { busyAt: c.busyAt } : {}),
      ...(c.rosterShift
        ? {
            rosterShift: (c.rosterShift === "day" ? "pagi" : "malam") as
              "pagi" | "malam",
          }
        : {}),
      sameShift: c.sameShift,
      deptOk: c.deptOk,
      skillOk: c.skillOk,
      expired: c.expired,
    }));
  }, [mode, candidatesQ.data]);

  function kindOf(u: BoardUnit): Kind {
    if (mode === "plan") return u.slots.length ? "ok" : "none";
    if (u.status === "breakdown") return "bd";
    if (u.downtime) return "dt";
    const s = u.slots[0];
    if (!s) return "none";
    if (s.gugur) return "warn";
    return "ok";
  }

  const needle = q.trim().toLowerCase();
  const allFiltered = units.filter((u) => {
    if (!inSelectedFleet(u, activeFleet, noFleetOffered)) return false;
    const kind = kindOf(u);
    if (filter === "unalloc" && u.slots.length) return false;
    if (filter === "alloc" && !u.slots.length) return false;
    if (filter === "issue" && kind !== "bd" && kind !== "dt" && kind !== "warn")
      return false;
    if (!needle) return true;
    return (
      u.code.toLowerCase().includes(needle) ||
      u.slots.some((s) => s.name.toLowerCase().includes(needle))
    );
  });
  const perN = Number(per);
  const filtered = allFiltered.length;
  const pageCount = Math.max(1, Math.ceil(filtered / perN));
  const cur = Math.min(page, pageCount);
  const cards = allFiltered.slice((cur - 1) * perN, cur * perN);
  const range = filtered
    ? `${(cur - 1) * perN + 1}–${(cur - 1) * perN + cards.length}`
    : "0";

  /* Counted over the selected formation, not over `units`: PLAN now carries
     the whole active register, and a total of 447 beside a screen showing one
     eight-unit fleet describes nothing anybody is looking at. `q` and the
     status filter are deliberately not applied — the summary is about the
     formation, not about the search. */
  const inSelection = units.filter((u) =>
    inSelectedFleet(u, activeFleet, noFleetOffered)
  );
  const summary = {
    allocated: inSelection.filter((u) => u.slots.length).length,
    total: inSelection.length,
    downtime: inSelection.filter((u) => u.downtime).length,
  };

  /** Null while every fleet is on screen — there is no single area to name. */
  /** Null on the no-fleet entry: it belongs to no formation and so to no area. */
  const selectedArea =
    fleetOptions.find((f) => f.id === activeFleet)?.area ?? null;

  function assign(unit: BoardUnit, nik: string, name: string) {
    if (mode === "plan") {
      assignM.mutate({ unitCode: unit.code, nik, name });
      return;
    }
    // ACTUAL: intervensi manual, masih statis sampai engine-nya ada.
    setLocalUnits((prev) =>
      prev.map((u) =>
        u.code === unit.code && u.slots.length < FA_PLAN_MAX_OPS
          ? {
              ...u,
              slots: [
                ...u.slots,
                {
                  nik,
                  name,
                  simperJenis: "BII",
                  via: "manual" as const,
                  ftw: "fit" as const,
                },
              ],
            }
          : u
      )
    );
    setAllocFor(null);
    pushToast(
      "success",
      t.faIntToastT,
      `${name} → ${unit.code}. ${t.faIntToastD}`
    );
  }

  function releasePlan(unit: BoardUnit, nik: string, name: string) {
    releaseM.mutate({ unitCode: unit.code, nik, name });
  }

  /** The departments the spare pool spans — the filter offers what exists. */
  const spareDepts = React.useMemo(
    () =>
      [
        ...new Set(spare.map((s) => s.departmentName).filter(Boolean)),
      ].sort() as string[],
    [spare]
  );

  /** The SIMPER codes the pool actually holds — offering more would be lying. */
  const spareSkills = React.useMemo(
    () => [...new Set(spare.flatMap((s) => s.skills ?? []))].sort(),
    [spare]
  );

  const spareNeedle = spareQ.trim().toLowerCase();
  const spareShown = spare.filter((s) => {
    if (spareDeptF !== "all" && s.departmentName !== spareDeptF) return false;
    /* Any, not all: a unit asks for one code, so an operator holding any of
       the ticked ones is a candidate. Requiring all of them would answer a
       question nobody is asking. */
    if (
      spareSkillF.length &&
      !spareSkillF.some((code) => s.skills?.includes(code))
    )
      return false;
    if (!spareNeedle) return true;
    return (
      s.name.toLowerCase().includes(spareNeedle) ||
      s.nik.toLowerCase().includes(spareNeedle)
    );
  });

  /* Paged, because the pool is the whole allocatable workforce minus whoever
     is paired — hundreds of cards on a screen whose subject is the units
     above it. Clamped during render so a filter that shortens the list cannot
     leave the view on a page that no longer exists. */
  const sparePerN = Number(sparePer);
  const sparePageCount = Math.max(1, Math.ceil(spareShown.length / sparePerN));
  const spareCur = Math.min(sparePage, sparePageCount);
  const sparePageRows = spareShown.slice(
    (spareCur - 1) * sparePerN,
    spareCur * sparePerN
  );
  const spareRange = spareShown.length
    ? `${(spareCur - 1) * sparePerN + 1}–${(spareCur - 1) * sparePerN + sparePageRows.length}`
    : "0";

  return (
    <>
      {/* The board's own reading, on its own line. It is a caption for what
          follows rather than one more control, and putting it back in the
          control row is what forced the controls into a single right-aligned
          huddle in the first place. */}
      <div>
        <span className="text-sm text-(--text-secondary)">
          <b className="font-semibold text-(--text-primary)">
            {summary.allocated}
          </b>{" "}
          {t.faAllocOf}{" "}
          <b className="font-semibold text-(--text-primary)">{summary.total}</b>{" "}
          {t.faAllocUnits}
          {/* Once a formation is chosen every card on screen shares its area,
              so it is stated once, here, instead of on each of them. */}
          {selectedArea ? (
            <>
              {" · "}
              <b className="font-semibold text-(--text-primary)">
                {selectedArea}
              </b>
            </>
          ) : null}
          {mode === "plan" ? (
            <> · {t.faPlanHint}</>
          ) : (
            <>
              {" · "}
              {t.faCreatedAt}{" "}
              <b className="font-mono font-semibold text-(--text-primary)">
                {createdAt ?? "—"}
              </b>
              {generatedAt ? (
                <>
                  {" · "}
                  <b className="font-semibold text-(--color-danger-text)">
                    {summary.downtime}
                  </b>{" "}
                  {t.faDowntime.toLowerCase()} · {t.faGenAt}{" "}
                  <b className="font-mono font-semibold text-(--text-primary)">
                    {generatedAt}
                  </b>
                </>
              ) : (
                <> · {t.faNotGenYet}</>
              )}
            </>
          )}
        </span>
      </div>

      {/* Two groups, pushed apart. On the left the controls that decide *which*
          units the board is about — the allocation tabs, the formation, and the
          import that changes the set itself. On the right the search, which
          narrows whatever those three settled on. Grouping them by what they do
          is what makes the split readable; a single right-aligned row of four
          unrelated controls was not. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented role="group" aria-label="Filter alokasi">
            {(
              [
                ["all", t.segAll],
                ["unalloc", t.faFUnalloc],
                ["alloc", t.faFAlloc],
                ["issue", t.faFIssue],
              ] as [Filter, string][]
            ).map(([f, label]) => (
              <SegmentedButton
                key={f}
                active={filter === f}
                onClick={() => {
                  setFilter(f);
                  setPage(1);
                }}
              >
                {label}
              </SegmentedButton>
            ))}
          </Segmented>
          {/* What Fleet Setting holds: its formations, its support entry, its
              no-fleet entry — and, at the top, every formation at once. Each
              option is something someone configured, so choosing one names a
              decision rather than a leftover; "all" names all of those
              decisions and, deliberately, not the units left out of them. */}
          <Select
            aria-label="Filter fleet"
            wrapperClassName="w-auto"
            className="h-10 w-auto pr-9"
            value={activeFleet}
            onChange={(e) => {
              setFleetF(e.target.value);
              setPage(1);
            }}
          >
            <option value={ALL_FLEETS}>{t.faFleetAll}</option>
            {/* The area rides on the option, so it is in front of you at the
                moment you choose a formation — and the closed select goes on
                stating it for the one you picked. */}
            {fleetOptions.map((f) => (
              <option key={f.id} value={f.id}>
                Fleet {f.digger} — {f.area}
              </option>
            ))}
            {/* PLAN only: on ACTUAL the board carries its own groups, and the
                filter is built from those instead. */}
            {supportOffered ? (
              <option value={SUPPORT}>{t.faSupport}</option>
            ) : null}
            {noFleetOffered ? (
              <option value={NO_FLEET}>{t.faNoFleet}</option>
            ) : null}
          </Select>
          {canEdit ? (
            <Button
              variant="secondary"
              className="h-10"
              onClick={() => router.push("/fleet-allocation/import")}
            >
              <Upload />
              {t.upImport}
            </Button>
          ) : null}
        </div>
        <SearchInput
          className="w-55"
          placeholder={t.searchUnit}
          aria-label={t.searchUnit}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
        {cards.map((u) => {
          const kind = kindOf(u);
          const slot: Slot | undefined = u.slots[0];
          const st = stBadge[u.status];
          return (
            <div
              key={u.code}
              className={cn(
                "flex flex-col gap-4 rounded-card p-5 glass-card",
                (kind === "warn" || kind === "dt") &&
                  "border-[rgba(252,60,59,.45)] shadow-[0_0_20px_rgba(252,60,59,.18),0_20px_80px_rgba(0,0,0,.5)]"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <b className="text-base font-bold">{u.code}</b>
                  <span className="mt-px block truncate text-xs text-(--text-tertiary)">
                    {u.brand}
                  </span>
                </div>
                <Badge variant={st.variant} dot>
                  {st.label}
                </Badge>
              </div>

              {/* What the machine demands of whoever is paired to it, in the
                  order it is checked: whose department owns it, what permit it
                  takes, and whether it needs a Fit To Work.

                  The formation is not among them (owner, 2026-08-31). It is how
                  the board is *narrowed*, not something read off one card — the
                  dropdown above already says which fleet is on screen, and
                  repeating it on every card in that fleet only crowded out the
                  three facts that differ between them. */}
              <div className="flex flex-wrap items-center gap-2">
                {/* Which department may operate it — GLOBAL means anyone. */}
                {u.departmentName ? (
                  <Badge variant="accent" title={u.departmentName}>
                    {deptAbbrev(u.departmentName)}
                  </Badge>
                ) : mode === "plan" ? (
                  <Badge variant="neutral">{t.faGlobalUnit}</Badge>
                ) : null}
                {u.simperCode ? (
                  <Badge variant="neutral">{u.simperCode}</Badge>
                ) : null}
                {u.requiresFtw ? <Badge variant="warning">FTW</Badge> : null}
              </div>

              {mode === "plan" ? (
                <div className="flex flex-col gap-2">
                  {u.slots.map((s) => (
                    <div
                      key={s.nik}
                      className="flex items-center gap-3 rounded-icon border border-(--divider) bg-(--fill-subtle) p-3"
                    >
                      <Avatar className="text-xs">{initialsOf(s.name)}</Avatar>
                      <div className="min-w-0 flex-1">
                        <b className="block truncate text-[13px] font-semibold">
                          {s.name}
                        </b>
                        <span className="font-mono text-xs text-(--text-tertiary)">
                          {s.nik}
                          {s.simperJenis ? ` · ${s.simperJenis}` : ""}
                        </span>
                      </div>
                      {canEdit ? (
                        <button
                          type="button"
                          onClick={() => releasePlan(u, s.nik, s.name)}
                          className="cursor-pointer text-xs font-semibold text-(--text-tertiary) hover:text-(--color-danger-text)"
                        >
                          {t.faRelease}
                        </button>
                      ) : null}
                    </div>
                  ))}
                  {!u.slots.length ? (
                    <div className="flex min-h-[62px] items-center justify-center rounded-icon border border-dashed border-(--divider) bg-(--fill-subtle) p-3 text-[13px] text-(--text-tertiary)">
                      {t.faNoOp}
                    </div>
                  ) : null}
                </div>
              ) : kind === "bd" ? (
                <div>
                  <div className="flex min-h-[62px] items-center justify-center rounded-icon border border-dashed border-(--divider) bg-(--fill-subtle) p-3 text-[13px] text-(--text-tertiary)">
                    {t.faBdNoAlloc}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant="danger" dot>
                      {t.faBdFix}
                    </Badge>
                  </div>
                </div>
              ) : kind === "dt" ? (
                <div>
                  <div className="flex min-h-[62px] items-center justify-center rounded-icon border border-dashed border-[rgba(252,60,59,.45)] bg-(--fill-subtle) p-3 text-[13px] text-(--text-tertiary)">
                    {t.faNoOp}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant="danger" dot>
                      {t.faDowntime}
                    </Badge>
                  </div>
                </div>
              ) : slot ? (
                <div>
                  <div className="flex items-center gap-3 rounded-icon border border-(--divider) bg-(--fill-subtle) p-3">
                    <Avatar className="text-xs">{initialsOf(slot.name)}</Avatar>
                    <div className="min-w-0 flex-1">
                      <b className="block truncate text-[13px] font-semibold">
                        {slot.name}
                      </b>
                      <span className="font-mono text-xs text-(--text-tertiary)">
                        {slot.nik}
                      </span>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant="info">
                      {slot.simperJenis
                        ? `SIMPER ${slot.simperJenis}`
                        : t.faKompNone}
                    </Badge>
                    {kind === "warn" ? (
                      <Badge
                        variant={slot.gugur === "cuti" ? "warning" : "danger"}
                        dot
                      >
                        {slot.gugur === "cuti"
                          ? t.faGugurCuti
                          : slot.gugur === "absen"
                            ? t.faGugurAbsen
                            : t.faGugurFtw}
                      </Badge>
                    ) : slot.via === "manual" ? (
                      <Badge variant="warning" dot>
                        {t.faIntervene}
                        {slot.at ? ` · ${siteClock(slot.at)}` : ""}
                      </Badge>
                    ) : slot.via === "spare" ? (
                      <Badge variant="warning" dot>
                        {t.faViaSpare}
                        {slot.replacedName
                          ? ` · ${t.faReplaces} ${slot.replacedName}`
                          : ""}
                      </Badge>
                    ) : (
                      (() => {
                        const ftw = ftwBadge[slot.ftw ?? "belum"];
                        return (
                          <Badge variant={ftw.variant} dot>
                            {t[ftw.labelKey]}
                          </Badge>
                        );
                      })()
                    )}
                  </div>
                </div>
              ) : (
                <div>
                  <div className="flex min-h-[62px] items-center justify-center rounded-icon border border-dashed border-(--divider) bg-(--fill-subtle) p-3 text-[13px] text-(--text-tertiary)">
                    {t.faNoOp}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant="neutral" dot>
                      {t.faIdle}
                    </Badge>
                  </div>
                </div>
              )}

              {mode === "actual" && kind === "warn" ? (
                <p className="text-xs leading-[1.4] text-(--color-danger-text)">
                  {t.faWarnNote}
                </p>
              ) : mode === "actual" && kind === "dt" ? (
                <p className="text-xs leading-[1.4] text-(--color-danger-text)">
                  {t.faDowntimeNote}
                </p>
              ) : null}

              {canEdit ? (
                <div className="mt-auto flex gap-2">
                  {u.slots.length < FA_PLAN_MAX_OPS ? (
                    <Button
                      className="h-[34px] flex-1 text-[13px]"
                      variant={u.slots.length ? "secondary" : "primary"}
                      onClick={() => setAllocFor(u)}
                    >
                      {u.slots.length ? t.faAddOp : t.faAssign}
                    </Button>
                  ) : null}
                </div>
              ) : canIntervene && (kind === "dt" || kind === "none") ? (
                <div className="mt-auto flex gap-2">
                  <Button
                    className="h-[34px] flex-1 text-[13px]"
                    onClick={() => setAllocFor(u)}
                  >
                    {t.faIntervene}
                  </Button>
                </div>
              ) : kind === "bd" ? (
                <div className="mt-auto flex gap-2">
                  <Button
                    variant="secondary"
                    className="h-[34px] flex-1 text-[13px]"
                    onClick={() => router.push(`/unit-status`)}
                  >
                    {t.faGoStatus}
                  </Button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <Panel className="px-6 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <FootSum>
            {t.attSumA} <b>{range}</b> {t.attSumB} <b>{filtered}</b> {t.udbSumB}
          </FootSum>
          <Pagination
            page={cur}
            pageCount={pageCount}
            onPage={setPage}
            per={per}
            perOptions={["6", "12", "24", "48"]}
            onPer={(v) => {
              setPer(v);
              setPage(1);
            }}
          />
        </div>
      </Panel>

      {/* pool spare — operator kompeten yang belum dapat unit */}
      <Panel>
        <Toolbar className="mb-2">
          <ToolbarTitle>
            {t.faSpareTitle} ({spareShown.length}/{spare.length})
          </ToolbarTitle>
          <ToolbarGroup>
            {spareDepts.length ? (
              <Select
                aria-label={t.faDeptAll}
                wrapperClassName="w-auto"
                className="h-10 w-auto pr-9"
                value={spareDeptF}
                onChange={(e) => {
                  setSpareDeptF(e.target.value);
                  setSparePage(1);
                }}
              >
                <option value="all">{t.faDeptAll}</option>
                {spareDepts.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            ) : null}
            <CheckFilter
              label={t.faSkillFilter}
              options={spareSkills.map((code) => ({
                value: code,
                label: code,
              }))}
              value={spareSkillF}
              onChange={(next) => {
                setSpareSkillF(next);
                setSparePage(1);
              }}
            />
            <SearchInput
              className="w-[240px]"
              placeholder={t.searchOp}
              aria-label={t.searchOp}
              value={spareQ}
              onChange={(e) => {
                setSpareQ(e.target.value);
                setSparePage(1);
              }}
            />
          </ToolbarGroup>
        </Toolbar>
        <p className="mb-4 text-xs text-(--text-tertiary)">
          {t.faSpareSub} {t.faSpareAuto}
        </p>
        {!spareShown.length ? (
          <p className="text-sm text-(--text-tertiary)">
            {spareQ.trim() ? t.faNoMatch : t.faSpareEmpty}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
              {sparePageRows.map((r) => (
                <div
                  key={r.nik}
                  className="flex items-center gap-3 rounded-icon border border-(--divider) bg-(--fill-subtle) p-3"
                >
                  <Avatar className="flex-none text-xs">
                    {initialsOf(r.name)}
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <b
                      className="block truncate text-[13px] font-semibold"
                      title={r.name}
                    >
                      {r.name}
                    </b>
                    <span className="block truncate font-mono text-xs text-(--text-tertiary)">
                      {r.nik}
                    </span>
                    {/* Smaller than the department badge on purpose: the
                        department says who this operator belongs to, the codes
                        say what they may drive. Several of the second fit on a
                        card only if each is slighter than the one of the
                        first, and the codes are read as a set rather than
                        one at a time. */}
                    {r.skills?.length ? (
                      <span
                        className="mt-1 flex flex-wrap gap-1"
                        title={r.skills.join(" · ")}
                      >
                        {r.skills.slice(0, SPARE_SKILL_BADGES).map((code) => (
                          <span
                            key={code}
                            className="rounded-chip border border-(--badge-info-border) bg-(--badge-info-fill) px-1.5 py-px font-mono text-[10px] leading-4 font-semibold text-(--color-primary-bright)"
                          >
                            {code}
                          </span>
                        ))}
                        {r.skills.length > SPARE_SKILL_BADGES ? (
                          <span className="px-0.5 font-mono text-[10px] leading-4 text-(--text-tertiary)">
                            +{r.skills.length - SPARE_SKILL_BADGES}
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                  </div>
                  {r.departmentName ? (
                    <Badge
                      variant="accent"
                      title={r.departmentName}
                      className="flex-none self-start"
                    >
                      {deptAbbrev(r.departmentName)}
                    </Badge>
                  ) : null}
                </div>
              ))}
            </div>
            {/* Only once there is more than a page of them: a pager under six
                cards is a control that does nothing. */}
            {spareShown.length > sparePerN || sparePageCount > 1 ? (
              <PanelFoot>
                <FootSum>
                  {t.attSumA} <b>{spareRange}</b> {t.attSumB}{" "}
                  <b>{spareShown.length}</b> {t.faSpareSumB}
                </FootSum>
                <Pagination
                  page={spareCur}
                  pageCount={sparePageCount}
                  onPage={setSparePage}
                  per={sparePer}
                  perOptions={["12", "24", "48"]}
                  onPer={(value) => {
                    setSparePer(value);
                    setSparePage(1);
                  }}
                />
              </PanelFoot>
            ) : null}
          </>
        )}
      </Panel>

      {canEdit || canIntervene ? (
        <AllocDialog
          key={allocFor?.code ?? "none"}
          unit={allocFor}
          mode={mode}
          rows={dialogRows}
          onClose={() => setAllocFor(null)}
          onAssign={(nik, name) => {
            if (allocFor) assign(allocFor, nik, name);
          }}
        />
      ) : null}
    </>
  );
}
