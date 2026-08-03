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
  Toolbar,
  ToolbarGroup,
  ToolbarTitle,
} from "@/components/ui/panel";
import { SearchInput } from "@/components/ui/search-input";
import { Segmented, SegmentedButton } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";

import {
  ACTUAL_UNITS,
  CANDIDATES,
  FLEET_OPTIONS,
  ftwBadge,
  SPARE_INIT,
  type BoardUnit,
  type Candidate,
  type Slot,
  type SpareRow,
} from "./data";

const FA_PLAN_MAX_OPS = 2;

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
    model: u.modelName,
    brand: u.brandName,
    loc: u.location ?? "—",
    status: u.status,
    departmentName: u.departmentName,
    fleet: u.fleet
      ? { id: u.fleet.id, digger: u.fleet.diggerCode, area: u.fleet.area }
      : null,
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
          }))
        : SPARE_INIT,
    [mode, planQ.data]
  );
  const fleetOptions = React.useMemo(
    () =>
      mode === "plan"
        ? (planQ.data?.fleets ?? []).map((f) => ({
            id: f.id,
            digger: f.diggerCode,
          }))
        : FLEET_OPTIONS,
    [mode, planQ.data]
  );

  const [spareQ, setSpareQ] = React.useState("");
  const [spareDeptF, setSpareDeptF] = React.useState("all");
  const [filter, setFilter] = React.useState<Filter>("all");
  const [fleetF, setFleetF] = React.useState("all");
  const [q, setQ] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [per, setPer] = React.useState("6");
  const [allocFor, setAllocFor] = React.useState<BoardUnit | null>(null);

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
    if (fleetF === "support" && u.fleet) return false;
    if (fleetF !== "all" && fleetF !== "support" && u.fleet?.id !== fleetF)
      return false;
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

  const summary = {
    allocated: units.filter((u) => u.slots.length).length,
    total: units.length,
    downtime: units.filter((u) => u.downtime).length,
  };

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

  const spareNeedle = spareQ.trim().toLowerCase();
  const spareShown = spare.filter((s) => {
    if (spareDeptF !== "all" && s.departmentName !== spareDeptF) return false;
    if (!spareNeedle) return true;
    return (
      s.name.toLowerCase().includes(spareNeedle) ||
      s.nik.toLowerCase().includes(spareNeedle)
    );
  });

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-(--text-secondary)">
          <b className="font-semibold text-(--text-primary)">
            {summary.allocated}
          </b>{" "}
          {t.faAllocOf}{" "}
          <b className="font-semibold text-(--text-primary)">{summary.total}</b>{" "}
          {t.faAllocUnits}
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
        <div className="flex flex-wrap items-center justify-end gap-2">
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
          <Select
            aria-label="Filter fleet"
            wrapperClassName="w-auto"
            className="h-10 w-auto pr-9"
            value={fleetF}
            onChange={(e) => {
              setFleetF(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">{t.faFleetAll}</option>
            {fleetOptions.map((f) => (
              <option key={f.id} value={f.id}>
                Fleet {f.digger}
              </option>
            ))}
            <option value="support">{t.faSupportGrp}</option>
          </Select>
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
              <div className="flex items-center justify-between gap-2">
                <div>
                  <b className="text-base font-bold">{u.code}</b>
                  <span className="mt-px block text-xs text-(--text-tertiary)">
                    {u.model} · {u.brand} · {u.loc}
                  </span>
                </div>
                <Badge variant={st.variant} dot>
                  {st.label}
                </Badge>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* Which department may operate it — GLOBAL means anyone. */}
                {u.departmentName ? (
                  <Badge variant="accent" title={u.departmentName}>
                    {deptAbbrev(u.departmentName)}
                  </Badge>
                ) : mode === "plan" ? (
                  <Badge variant="neutral">{t.faGlobalUnit}</Badge>
                ) : null}
                {u.fleet ? (
                  <>
                    <Badge variant="info">Fleet {u.fleet.digger}</Badge>
                    <span className="text-xs text-(--text-tertiary)">
                      {u.fleet.area}
                    </span>
                  </>
                ) : null}
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
                        {slot.at ? ` · ${slot.at.slice(11, 16)}` : ""}
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
                onChange={(e) => setSpareDeptF(e.target.value)}
              >
                <option value="all">{t.faDeptAll}</option>
                {spareDepts.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            ) : null}
            <SearchInput
              className="w-[240px]"
              placeholder={t.searchOp}
              aria-label={t.searchOp}
              value={spareQ}
              onChange={(e) => setSpareQ(e.target.value)}
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
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
            {spareShown.map((r) => (
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
                </div>
                {r.departmentName ? (
                  <Badge variant="accent" title={r.departmentName}>
                    {deptAbbrev(r.departmentName)}
                  </Badge>
                ) : null}
              </div>
            ))}
          </div>
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
