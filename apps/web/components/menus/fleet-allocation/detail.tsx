"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, UserCog, Users } from "lucide-react";

import type { ShiftKind } from "@universe/contracts";

import { api, errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
  actualBoardKey,
  actualBoardQueryOptions,
  actualCandidatesQueryOptions,
  actualListKey,
  type ActualSlot,
} from "@/lib/queries/fleet-actual";
import { cn } from "@/lib/utils";
import { useRole } from "@/components/providers/role-context";
import { Avatar, initialsOf } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogIcon,
  DialogTitle,
} from "@/components/ui/dialog";
import { Pagination } from "@/components/ui/pagination";
import { FootSum, PageTitle, Panel } from "@/components/ui/panel";
import { SearchInput } from "@/components/ui/search-input";
import { Segmented, SegmentedButton } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { StateBox } from "@/components/ui/state-box";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";

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
                {boardQ.data.generatedAt.slice(11, 16)}
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
