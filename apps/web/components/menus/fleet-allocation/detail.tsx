"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronDown,
  ChevronsUpDown,
  ChevronUp,
  UserCog,
  Users,
} from "lucide-react";

import type { ShiftKind } from "@universe/contracts";

import { api, errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
  actualAuditQueryOptions,
  actualBoardKey,
  actualBoardQueryOptions,
  actualCandidatesQueryOptions,
  actualListKey,
  type ActualSlot,
  type AuditRow,
} from "@/lib/queries/fleet-actual";
import { cn } from "@/lib/utils";
import { useRole } from "@/components/providers/role-context";
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
  PageTitle,
  Panel,
  PanelFoot,
  Toolbar,
  ToolbarTitle,
} from "@/components/ui/panel";
import { SearchInput } from "@/components/ui/search-input";
import { Segmented, SegmentedButton } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { StateBox } from "@/components/ui/state-box";
import {
  NameCell,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { useToast } from "@/components/ui/toast";

import { CheckFilter } from "./check-filter";
import { siteClock } from "./data";

/** "PIT SERVICE AND DEVELOPMENT" → "PSD", so a badge stays a badge. */
function deptAbbrev(name: string): string {
  const words = name.split(/\s+/).filter((w) => w.length > 2);
  return words.length > 1
    ? words.map((w) => w[0]!.toUpperCase()).join("")
    : name.slice(0, 4).toUpperCase();
}

/**
 * One shift's board, unit by unit.
 *
 * Vacancies are rows like any other, deliberately: a unit nobody is on is the
 * fact this screen exists to carry, and a board that listed only the crewed
 * units would report a quiet success.
 *
 * Editing is unconditional. The board is never frozen (owner, 2026-08-29), so
 * there is no state in which a supervisor is told the morning is closed.
 */
export function FleetAllocationDetail() {
  const { t } = useI18n();
  const { access } = useRole();
  const router = useRouter();
  const params = useSearchParams();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const canManage = access("fleet-allocation") === "manage";

  const dateParam = params.get("date") ?? "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : "";
  const shift: ShiftKind = params.get("shift") === "night" ? "night" : "day";
  const shiftLabel = shift === "day" ? t.faShiftPagi : t.faShiftMalam;

  const boardQ = useQuery({
    ...actualBoardQueryOptions(date, shift),
    enabled: date !== "",
    retry: false,
  });
  const slots = React.useMemo(
    () => boardQ.data?.slots ?? [],
    [boardQ.data?.slots]
  );

  const [picking, setPicking] = React.useState<ActualSlot | null>(null);
  const [fleetF, setFleetF] = React.useState("all");
  const [filter, setFilter] = React.useState<
    "all" | "unalloc" | "alloc" | "subbed"
  >("all");
  const [q, setQ] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [per, setPer] = React.useState("12");

  const assign = useMutation({
    mutationFn: async (input: {
      unitId: string;
      employeeId: string | null;
    }) => {
      const result = await api.v1["fleet-allocation"]
        .actual({ date })({ shift })({ unitId: input.unitId })
        .patch({ employeeId: input.employeeId });
      if (result.error) throw result.error;
      return result.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: actualBoardKey(date, shift),
      });
      await queryClient.invalidateQueries({ queryKey: actualListKey });
      setPicking(null);
    },
    onError: (error) =>
      pushToast("error", t.faActPick, errorMessage(error, t.loginErr)),
  });

  /*
   * The same four controls the PLAN board carries, over the same units, so a
   * person moving between the two tabs is not learning a second screen. The
   * summary counts the whole board rather than the filtered view — narrowing
   * to one fleet must not make the site look better crewed than it is.
   */
  const needle = q.trim().toLowerCase();
  const shown = slots.filter((s) => {
    if (
      fleetF === "none" ? !!s.fleet : fleetF !== "all" && s.fleet?.id !== fleetF
    )
      return false;
    if (filter === "unalloc" && s.employeeId) return false;
    if (filter === "alloc" && !s.employeeId) return false;
    if (filter === "subbed" && s.source !== "spare" && s.source !== "manual")
      return false;
    if (!needle) return true;
    return (
      s.unitCode.toLowerCase().includes(needle) ||
      (s.employeeName ?? "").toLowerCase().includes(needle) ||
      (s.employeeNik ?? "").toLowerCase().includes(needle) ||
      (s.simperCodeName ?? "").toLowerCase().includes(needle) ||
      (s.modelName ?? "").toLowerCase().includes(needle)
    );
  });

  const allocated = slots.filter((s) => s.employeeId).length;
  const idle = slots.length - allocated;

  const perN = Number(per);
  const pageCount = Math.max(1, Math.ceil(shown.length / perN));
  const cur = Math.min(page, pageCount);
  const cards = shown.slice((cur - 1) * perN, cur * perN);
  const range = shown.length
    ? `${(cur - 1) * perN + 1}–${(cur - 1) * perN + cards.length}`
    : "0";

  const sourceBadge = (source: ActualSlot["source"]) => {
    if (source === "plan") return <Badge variant="success">PLAN</Badge>;
    if (source === "spare")
      return <Badge variant="warning">{t.faViaSpare}</Badge>;
    if (source === "manual")
      return <Badge variant="info">{t.faViaManual}</Badge>;
    return null;
  };

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={`ACTUAL — ${date || "—"}`} sub={shiftLabel}>
        <Button
          variant="ghost"
          onClick={() => router.push(`/fleet-allocation?mode=actual`)}
        >
          <ArrowLeft />
          {t.upBack}
        </Button>
      </PageTitle>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-(--text-secondary)">
          <b className="font-semibold text-(--text-primary)">{allocated}</b>{" "}
          {t.faAllocOf}{" "}
          <b className="font-semibold text-(--text-primary)">{slots.length}</b>{" "}
          {t.faAllocUnits}
          {idle ? (
            <>
              {" · "}
              <b className="font-semibold text-(--color-danger-text)">
                {idle}
              </b>{" "}
              {t.faDowntime.toLowerCase()}
            </>
          ) : null}
          {boardQ.data ? (
            <>
              {" · "}
              {t.faGenAt}{" "}
              <b className="font-mono font-semibold text-(--text-primary)">
                {siteClock(boardQ.data.generatedAt)}
              </b>
            </>
          ) : null}
        </span>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Select
            aria-label={t.faFleetAll}
            wrapperClassName="w-auto"
            className="h-10 w-auto pr-9"
            value={fleetF}
            onChange={(e) => {
              setFleetF(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">{t.faFleetAll}</option>
            {(boardQ.data?.fleets ?? []).map((f) => (
              <option key={f.id} value={f.id}>
                Fleet {f.diggerCode}
              </option>
            ))}
            <option value="none">{t.faActNoFleet}</option>
          </Select>
          <Segmented role="group" aria-label={t.filter}>
            {(
              [
                ["all", t.segAll],
                ["unalloc", t.faFUnalloc],
                ["alloc", t.faFAlloc],
                ["subbed", t.faFSubbed],
              ] as ["all" | "unalloc" | "alloc" | "subbed", string][]
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

      {cards.length ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
          {cards.map((s) => {
            const empty = !s.employeeId;
            return (
              <div
                key={s.unitId}
                className={cn(
                  "flex flex-col gap-4 rounded-card p-5 glass-card",
                  // An idle unit is the fact this board exists to carry, so it
                  // is the one that reads differently across the room.
                  empty &&
                    "border-[rgba(252,60,59,.45)] shadow-[0_0_20px_rgba(252,60,59,.18),0_20px_80px_rgba(0,0,0,.5)]"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <b className="text-base font-bold">{s.unitCode}</b>
                    <span className="mt-px block truncate text-xs text-(--text-tertiary)">
                      {s.modelName} · {s.brandName}
                    </span>
                  </div>
                  {empty ? (
                    <Badge variant="danger" dot>
                      {t.faDowntime}
                    </Badge>
                  ) : (
                    sourceBadge(s.source)
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {s.departmentName ? (
                    <Badge variant="accent" title={s.departmentName}>
                      {deptAbbrev(s.departmentName)}
                    </Badge>
                  ) : null}
                  {s.simperCodeName ? (
                    <Badge variant="neutral">{s.simperCodeName}</Badge>
                  ) : null}
                  {s.requiresFtw ? <Badge variant="warning">FTW</Badge> : null}
                  {s.fleet ? (
                    <>
                      <Badge variant="info">Fleet {s.fleet.diggerCode}</Badge>
                      {s.fleet.area ? (
                        <span className="text-xs text-(--text-tertiary)">
                          {s.fleet.area}
                        </span>
                      ) : null}
                    </>
                  ) : null}
                </div>

                {s.employeeName ? (
                  <div className="flex items-center gap-3 rounded-icon border border-(--divider) bg-(--fill-subtle) p-3">
                    <Avatar className="text-xs">
                      {initialsOf(s.employeeName)}
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <b className="block truncate text-[13px] font-semibold">
                        {s.employeeName}
                      </b>
                      <span className="font-mono text-xs text-(--text-tertiary)">
                        {s.employeeNik}
                        {s.tappedAt
                          ? ` · ${t.faActThTap} ${s.tappedAt.slice(0, 5)}`
                          : ""}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="flex min-h-[62px] items-center justify-center rounded-icon border border-dashed border-[rgba(252,60,59,.45)] bg-(--fill-subtle) p-3 text-[13px] text-(--text-tertiary)">
                    {t.faActEmpty}
                  </div>
                )}

                {canManage ? (
                  <div className="mt-auto flex gap-2">
                    <Button
                      variant={empty ? "primary" : "secondary"}
                      className="h-[34px] flex-1 text-[13px]"
                      onClick={() => setPicking(s)}
                    >
                      {empty ? t.faIntervene : t.faActPick}
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <Panel>
          <StateBox
            icon={<Users className="text-(--color-primary-bright)" />}
            title={slots.length ? t.noResTitle : t.faActNoBoard}
            body={slots.length ? t.mdEmptyB : t.faActNoBoardB}
          />
        </Panel>
      )}

      {shown.length ? (
        <Panel className="px-6 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <FootSum>
              {t.attSumA} <b>{range}</b> {t.attSumB} <b>{shown.length}</b>{" "}
              {t.udbSumB}
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
      ) : null}

      <AuditTable date={date} shift={shift} />

      {picking ? (
        <CandidatePicker
          date={date}
          shift={shift}
          slot={picking}
          busy={assign.isPending}
          onClose={() => setPicking(null)}
          onPick={(employeeId) =>
            assign.mutate({ unitId: picking.unitId, employeeId })
          }
        />
      ) : null}
    </div>
  );
}

/**
 * Late FTW, and nothing else standing in the way.
 *
 * Worth its own case because it is the only refusal a supervisor is meant to
 * act on: the person is fit by every measure savera took, they simply uploaded
 * after the gate. Everything else here — unfit, no tap, wrong department, an
 * expired SIMPER — is a fact to read, not a decision to make.
 */
function lateOnly(c: {
  ftw: string;
  finger: string;
  refusal: string | null;
}): boolean {
  return c.ftw === "late" && c.finger === "pass" && !c.refusal;
}

/**
 * Everyone rostered to the shift, with what stands in their way spelled out
 * rather than filtered away — a supervisor overriding the engine is entitled
 * to see what the engine saw, and may place someone it refused.
 */
function CandidatePicker({
  date,
  shift,
  slot,
  busy,
  onClose,
  onPick,
}: {
  date: string;
  shift: ShiftKind;
  slot: ActualSlot;
  busy: boolean;
  onClose: () => void;
  onPick: (employeeId: string | null) => void;
}) {
  const { t } = useI18n();
  const candidatesQ = useQuery(
    actualCandidatesQueryOptions(date, shift, slot.unitId)
  );
  const rows = candidatesQ.data ?? [];

  return (
    <Dialog
      open
      onClose={onClose}
      className="w-[min(720px,100%)]"
      labelledBy="fapick-t"
    >
      <DialogIcon variant="info">
        <UserCog />
      </DialogIcon>
      <DialogTitle id="fapick-t">
        {t.faActPick} — {slot.unitCode}
      </DialogTitle>
      <DialogBody>{t.faActPickB}</DialogBody>

      <div className="mt-4 max-h-[46vh] overflow-y-auto">
        {rows.length ? (
          <Table>
            <TableHeader>
              <tr>
                <TableHead>{t.faActThOp}</TableHead>
                <TableHead>{t.faActThTap}</TableHead>
                <TableHead>{t.thStatus}</TableHead>
                <TableHead />
              </tr>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.employeeId}>
                  <TableCell>
                    <span className="font-semibold">{c.name}</span>
                    <span className="ml-2 font-mono text-xs text-(--text-tertiary)">
                      {c.nik}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {c.tappedAt ?? "—"}
                  </TableCell>
                  <TableCell>
                    {c.onAnotherUnit ? (
                      <Badge variant="info" dot>
                        {t.faActOnOther}
                      </Badge>
                    ) : c.ready && !c.refusal ? (
                      <Badge variant="success" dot>
                        {t.faActReady}
                      </Badge>
                    ) : lateOnly(c) ? (
                      /* Administrative, not medical — and the one case a
                         supervisor is expected to decide rather than read
                         past, so it is not dressed as a refusal. */
                      <Badge variant="warning" dot>
                        {t.faActFtwLate}
                        {c.sentAt ? ` ${c.sentAt.slice(0, 5)}` : ""}
                      </Badge>
                    ) : (
                      <span title={c.refusal ?? undefined}>
                        <Badge variant="danger" dot>
                          {c.refusal ??
                            `${t.faActNotReady} · ${c.finger}/${c.ftw}`}
                        </Badge>
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="secondary"
                      className="h-8 text-[13px]"
                      disabled={busy || c.onAnotherUnit}
                      onClick={() => onPick(c.employeeId)}
                    >
                      {t.faActPick}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <StateBox
            icon={<Users className="text-(--color-primary-bright)" />}
            title={t.noResTitle}
            body={t.faActPickB}
          />
        )}
      </div>

      <DialogActions>
        <Button variant="ghost" onClick={onClose}>
          {t.btnCancel}
        </Button>
        {slot.employeeId ? (
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => onPick(null)}
          >
            {t.faActClear}
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  );
}

/**
 * The board's audit table — one line per operator the roster put on this
 * shift, and what became of them.
 *
 * The row is the *person*: "unit plan → unit actual" is a movement, and a
 * movement needs someone to move. Units nobody filled are already on the board
 * above, so this table deliberately does not repeat them.
 */
/**
 * The FTW verdict, in words and in colour.
 *
 * Written here rather than reusing `ftwBadge` from `data.ts`: that one keys on
 * the three-way summary the PLAN board shows ("fit/kurang/belum"), while these
 * are the engine's own six verdicts. Collapsing them would hide the two that
 * a dispute actually turns on — uploaded after the deadline, and uploaded but
 * unreadable.
 */
const AUDIT_FTW: Record<
  AuditRow["ftw"],
  {
    variant: BadgeVariant;
    key:
      | "faFtwPass"
      | "faFtwFail"
      | "faFtwLate"
      | "faFtwMissing"
      | "faFtwUnreadable"
      | "faFtwNotReq";
  }
> = {
  pass: { variant: "success", key: "faFtwPass" },
  fail: { variant: "danger", key: "faFtwFail" },
  late: { variant: "warning", key: "faFtwLate" },
  missing: { variant: "neutral", key: "faFtwMissing" },
  unreadable: { variant: "warning", key: "faFtwUnreadable" },
  "not-required": { variant: "neutral", key: "faFtwNotReq" },
};

/**
 * The formation filter's value for "belongs to none".
 *
 * A sentinel rather than the empty string, which already means "no filter" —
 * and rows outside a formation are a real answer, not the absence of one.
 * Underscored so it can never collide with a digger's unit code.
 */
const NO_FLEET_ROW = "__no-fleet";

/**
 * What the board did, in one word and one colour.
 *
 * Five values, not two: "placed" and "not placed" would hide the distinction
 * that matters when a formation is short — somebody turned away by FTW or the
 * tap is a different problem from somebody ready with nowhere to sit.
 */
const AUDIT_DECISION: Record<
  AuditRow["decision"],
  {
    variant: BadgeVariant;
    key:
      | "faDecKept"
      | "faDecSubstitute"
      | "faDecManual"
      | "faDecNotReady"
      | "faDecNoSeat";
  }
> = {
  kept: { variant: "success", key: "faDecKept" },
  substitute: { variant: "warning", key: "faDecSubstitute" },
  /* Amber with the spare, as on the fleet wall: both are a seat filled by
     someone other than its planned holder, and which of the two says only how
     that came about. The tooltip keeps that half. */
  manual: { variant: "warning", key: "faDecManual" },
  "not-ready": { variant: "danger", key: "faDecNotReady" },
  "no-seat": { variant: "danger", key: "faDecNoSeat" },
};

/** The finger verdict's own words — the filter needs labels, not raw values. */
const AUDIT_FINGER: Record<
  AuditRow["finger"],
  "faFingerPassOpt" | "faFingerLateOpt" | "faAuditNoTap"
> = {
  pass: "faFingerPassOpt",
  late: "faFingerLateOpt",
  missing: "faAuditNoTap",
};

function AuditTable({ date, shift }: { date: string; shift: ShiftKind }) {
  const { t } = useI18n();
  const auditQ = useQuery(actualAuditQueryOptions(date, shift));
  const rows = React.useMemo(() => auditQ.data?.rows ?? [], [auditQ.data]);

  const [q, setQ] = React.useState("");
  const [fleetF, setFleetF] = React.useState("");
  const [ftwF, setFtwF] = React.useState("");
  const [fingerF, setFingerF] = React.useState("");
  const [skillF, setSkillF] = React.useState<string[]>([]);
  const [page, setPage] = React.useState(1);
  const [per, setPer] = React.useState("10");
  /* Null means the server's order: formation, then decision. Sorting by the
     tap is a second reading of the same rows — the engine offers vacancies to
     spares first come first served, so earliest-first is the order it worked
     in. */
  const [tapSort, setTapSort] = React.useState<"asc" | "desc" | null>(null);

  /* The formations on this board, plus one entry for the rows outside any —
     which is where every spare and every no-fleet unit's holder sits, and the
     bucket somebody scanning for "who was left over" actually wants. */
  const fleetOptions = React.useMemo(
    () =>
      [
        ...new Set(rows.map((r) => r.fleetDiggerCode).filter(Boolean)),
      ].sort() as string[],
    [rows]
  );
  const hasUnfleeted = React.useMemo(
    () => rows.some((r) => !r.fleetDiggerCode),
    [rows]
  );

  /* Each filter offers only what this board actually contains. A verdict no
     operator on this shift has is a choice that can only ever empty the table,
     and offering it invites exactly that. */
  const ftwOptions = React.useMemo(
    () =>
      (Object.keys(AUDIT_FTW) as AuditRow["ftw"][])
        .filter((v) => rows.some((r) => r.ftw === v))
        .map((v) => ({ value: v, label: t[AUDIT_FTW[v].key] })),
    [rows, t]
  );
  const fingerOptions = React.useMemo(
    () =>
      (Object.keys(AUDIT_FINGER) as AuditRow["finger"][])
        .filter((v) => rows.some((r) => r.finger === v))
        .map((v) => ({ value: v, label: t[AUDIT_FINGER[v]] })),
    [rows, t]
  );
  const skillOptions = React.useMemo(
    () =>
      [...new Set(rows.flatMap((r) => r.skills))]
        .sort()
        .map((code) => ({ value: code, label: code })),
    [rows]
  );

  const needle = q.trim().toLowerCase();
  const shown = React.useMemo(
    () =>
      rows.filter((r) => {
        if (fleetF === NO_FLEET_ROW) {
          if (r.fleetDiggerCode) return false;
        } else if (fleetF && r.fleetDiggerCode !== fleetF) return false;
        if (ftwF && r.ftw !== ftwF) return false;
        if (fingerF && r.finger !== fingerF) return false;
        /* Any, not all: a unit asks for one code, so holding any of the ticked
           ones is what makes an operator relevant to the question. */
        if (skillF.length && !skillF.some((c) => r.skills.includes(c)))
          return false;
        if (!needle) return true;
        return (
          r.name.toLowerCase().includes(needle) ||
          r.nik.includes(needle) ||
          (r.planUnitCode ?? "").toLowerCase().includes(needle) ||
          (r.actualUnitCode ?? "").toLowerCase().includes(needle) ||
          (r.fleetDiggerCode ?? "").toLowerCase().includes(needle)
        );
      }),
    [rows, needle, fleetF, ftwF, fingerF, skillF]
  );

  const sorted = React.useMemo(() => {
    if (!tapSort) return shown;
    /* Copied before sorting: `shown` is derived from the query cache, and
       sorting in place would reorder the rows every other filter reads. */
    return [...shown].sort((a, b) => {
      /* No tap is neither early nor late — it belongs at the end whichever way
         the column points, or reversing the sort would parade thirteen people
         who never arrived above everyone who did. */
      if (!a.tappedAt || !b.tappedAt) {
        if (a.tappedAt === b.tappedAt) return a.name.localeCompare(b.name);
        return a.tappedAt ? -1 : 1;
      }
      const order = a.tappedAt.localeCompare(b.tappedAt);
      return (
        (tapSort === "asc" ? order : -order) || a.name.localeCompare(b.name)
      );
    });
  }, [shown, tapSort]);

  const perN = Number(per);
  const pageCount = Math.max(1, Math.ceil(sorted.length / perN));
  const cur = Math.min(page, pageCount);
  const pageRows = sorted.slice((cur - 1) * perN, cur * perN);
  const range = sorted.length
    ? `${(cur - 1) * perN + 1}–${(cur - 1) * perN + pageRows.length}`
    : "0";

  return (
    <Panel>
      <Toolbar className="mb-3">
        <ToolbarTitle>{t.faAuditTitle}</ToolbarTitle>
      </Toolbar>
      {/* The filters own a row of their own rather than crowding in beside the
          title: there are five of them, and squeezed into a toolbar they each
          shrink to a width that fits nothing. The widths are proportional, so
          the row stays full at any viewport — four filters at one share each
          and the search at two, because a name or a unit code needs the room
          and a dropdown does not. `min-w` is what makes them wrap on a narrow
          screen instead of collapsing into unreadable stubs. */}
      <div className="mb-4 flex w-full flex-wrap items-center gap-2">
        {fleetOptions.length || hasUnfleeted ? (
          <Select
            aria-label={t.faAuditFleet}
            wrapperClassName="min-w-[150px] flex-1"
            className="h-10 w-full"
            value={fleetF}
            onChange={(e) => {
              setFleetF(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t.faAuditFleetAll}</option>
            {fleetOptions.map((code) => (
              <option key={code} value={code}>
                Fleet {code}
              </option>
            ))}
            {hasUnfleeted ? (
              <option value={NO_FLEET_ROW}>{t.faNoFleet}</option>
            ) : null}
          </Select>
        ) : null}
        {/* Single choice: a row has exactly one verdict, so "pass or fail"
            asks for everything and the two are never usefully combined. Only
            the SIMPER filter is a set, because an operator holds several codes
            at once. */}
        {ftwOptions.length ? (
          <Select
            aria-label={t.faAuditFtw}
            wrapperClassName="min-w-[150px] flex-1"
            className="h-10 w-full"
            value={ftwF}
            onChange={(e) => {
              setFtwF(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t.faAuditFtwAll}</option>
            {ftwOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        ) : null}
        {fingerOptions.length ? (
          <Select
            aria-label={t.faAuditFinger}
            wrapperClassName="min-w-[150px] flex-1"
            className="h-10 w-full"
            value={fingerF}
            onChange={(e) => {
              setFingerF(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t.faAuditFingerAll}</option>
            {fingerOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        ) : null}
        <CheckFilter
          className="min-w-[150px] flex-1"
          label={t.faSkillFilter}
          options={skillOptions}
          value={skillF}
          onChange={(next) => {
            setSkillF(next);
            setPage(1);
          }}
        />
        <SearchInput
          className="w-auto min-w-[220px] flex-[2]"
          placeholder={t.faAuditSearch}
          aria-label={t.faAuditSearch}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
      </div>
      {/* Said plainly rather than left for someone to discover: the board
          records outcomes, not the verdicts behind them, and readings keep
          arriving after a board is generated. These two columns therefore
          agree with the FTW and Attendance menus — which is what they are here
          to replace — and can differ from what the engine saw. */}
      {/* <p className="mb-4 text-xs text-(--text-tertiary)">{t.faAuditNote}</p> */}

      {auditQ.isPending ? (
        <TableSkeleton rows={6} />
      ) : !shown.length ? (
        <p className="text-sm text-(--text-tertiary)">
          {needle || fleetF || ftwF || fingerF || skillF.length
            ? t.faNoMatch
            : t.faAuditEmpty}
        </p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <tr>
                {/* The three unit columns together, on the left: a formation
                    and its units are one thought, and the plan/actual pair is
                    the sentence — where they stand, where they ended up. */}
                <TableHead>{t.faAuditFleet}</TableHead>
                <TableHead>{t.faAuditPlan}</TableHead>
                <TableHead>{t.faActThOp}</TableHead>
                <TableHead className="max-lg:hidden">
                  {t.faSkillFilter}
                </TableHead>
                <TableHead>{t.faAuditFtw}</TableHead>
                {/* The only sortable column here: the tap is the one value on
                    the row that orders the shift, and it is what the engine
                    itself sorts spares by. Clicking cycles earliest → latest →
                    back to the formation order. */}
                <TableHead
                  aria-sort={
                    tapSort === "asc"
                      ? "ascending"
                      : tapSort === "desc"
                        ? "descending"
                        : "none"
                  }
                >
                  <button
                    type="button"
                    onClick={() => {
                      setTapSort((v) =>
                        v === null ? "asc" : v === "asc" ? "desc" : null
                      );
                      setPage(1);
                    }}
                    className="inline-flex cursor-pointer items-center gap-1.5 uppercase hover:text-(--color-primary-bright)"
                  >
                    {t.faAuditFinger}
                    {tapSort === "asc" ? (
                      <ChevronUp className="size-3.5" />
                    ) : tapSort === "desc" ? (
                      <ChevronDown className="size-3.5" />
                    ) : (
                      <ChevronsUpDown className="size-3.5 text-(--text-tertiary)" />
                    )}
                  </button>
                </TableHead>
                {/* Last, and the only coloured cell in the row: it is the
                    answer the whole line was building towards. */}
                <TableHead>{t.faAuditActual}</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {pageRows.map((r) => (
                <TableRow key={r.nik}>
                  <TableCell className="font-mono">
                    {r.fleetDiggerCode ?? (
                      <span className="text-(--text-tertiary)">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {/* No standing unit is not missing data — it is what a
                        spare *is*, so it is named rather than dashed. */}
                    {r.planUnitCode ? (
                      <span className="font-mono">{r.planUnitCode}</span>
                    ) : (
                      <Badge variant="warning">{t.faAuditSpare}</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <NameCell name={r.name} sub={r.nik} />
                  </TableCell>
                  <TableCell className="max-lg:hidden">
                    {r.skills.length ? (
                      <span className="flex max-w-[220px] flex-wrap gap-1">
                        {r.skills.map((code) => (
                          <span
                            key={code}
                            className="rounded-chip border border-(--badge-info-border) bg-(--badge-info-fill) px-1.5 py-px font-mono text-[10px] leading-4 font-semibold text-(--color-primary-bright)"
                          >
                            {code}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="text-(--text-tertiary)">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={AUDIT_FTW[r.ftw].variant}>
                      {t[AUDIT_FTW[r.ftw].key]}
                    </Badge>
                    {/* The upload time, because "late" is only meaningful
                        beside the hour it was late by. */}
                    {r.sentAt && r.ftw === "late" ? (
                      <div className="mt-0.5 font-mono text-xs text-(--text-tertiary)">
                        {r.sentAt.slice(0, 5)}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {r.tappedAt ? (
                      <>
                        <span className="font-mono">
                          {r.tappedAt.slice(0, 5)}
                        </span>
                        {r.finger === "late" ? (
                          <div className="mt-0.5 text-xs text-(--badge-warning-text)">
                            {t.faFingerLate}
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-(--color-danger-text)">
                        {t.faAuditNoTap}
                      </span>
                    )}
                  </TableCell>
                  {/* The decision, carried by the badge rather than by a
                      column of its own: green kept their unit, amber came in
                      to fill one, red left the shift without a machine. The
                      word is on the tooltip, so the distinction between a
                      spare and a supervisor's placement — both amber — is
                      still there for anyone who asks. */}
                  <TableCell>
                    <Badge
                      variant={AUDIT_DECISION[r.decision].variant}
                      title={t[AUDIT_DECISION[r.decision].key]}
                      className="font-mono"
                    >
                      {r.actualUnitCode ?? t.faAuditNoUnit}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <PanelFoot>
            <FootSum>
              {t.attSumA} <b>{range}</b> {t.attSumB} <b>{shown.length}</b>{" "}
              {t.faAuditSumB}
            </FootSum>
            <Pagination
              page={cur}
              pageCount={pageCount}
              onPage={setPage}
              per={per}
              perOptions={["10", "20", "30"]}
              onPer={(v) => {
                setPer(v);
                setPage(1);
              }}
            />
          </PanelFoot>
        </>
      )}
    </Panel>
  );
}
