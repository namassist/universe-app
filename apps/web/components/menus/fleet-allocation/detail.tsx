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
import { useRole } from "@/components/providers/role-context";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogIcon,
  DialogTitle,
} from "@/components/ui/dialog";
import { FootSum, PageTitle, Panel, PanelFoot } from "@/components/ui/panel";
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

  const crewed = slots.filter((s) => s.employeeId).length;

  const sourceBadge = (source: ActualSlot["source"]) => {
    if (source === "plan") return <Badge variant="success">PLAN</Badge>;
    if (source === "spare")
      return <Badge variant="warning">{t.faViaSpare}</Badge>;
    if (source === "manual")
      return <Badge variant="info">{t.faViaManual}</Badge>;
    return <span className="text-(--text-tertiary)">—</span>;
  };

  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        title={`ACTUAL — ${date || "—"}`}
        sub={`${shiftLabel}${boardQ.data ? ` · ${t.fahThGen} ${boardQ.data.generatedAt.slice(11, 16)}` : ""}`}
      >
        <Button
          variant="ghost"
          onClick={() => router.push(`/fleet-allocation?mode=actual`)}
        >
          <ArrowLeft />
          {t.upBack}
        </Button>
      </PageTitle>

      <Panel>
        {slots.length ? (
          <div className="overflow-x-auto">
            <Table className="min-w-[900px]">
              <TableHeader>
                <tr>
                  <TableHead>{t.faActThUnit}</TableHead>
                  <TableHead>{t.faActThOp}</TableHead>
                  <TableHead>{t.faActThSrc}</TableHead>
                  <TableHead>{t.faActThTap}</TableHead>
                  <TableHead>FTW</TableHead>
                  <TableHead style={{ width: 110 }}>{t.thAct}</TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {slots.map((s) => (
                  <TableRow key={s.unitId}>
                    <TableCell>
                      <span className="font-mono font-semibold">
                        {s.unitCode}
                      </span>
                      {s.simperCodeName ? (
                        <span className="ml-2 text-xs text-(--text-tertiary)">
                          {s.simperCodeName}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {s.employeeName ? (
                        <>
                          <span className="font-semibold">
                            {s.employeeName}
                          </span>
                          <span className="ml-2 font-mono text-xs text-(--text-tertiary)">
                            {s.employeeNik}
                          </span>
                        </>
                      ) : (
                        <Badge variant="danger" dot>
                          {t.faActEmpty}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>{sourceBadge(s.source)}</TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {s.tappedAt ?? (
                        <span className="text-(--text-tertiary)">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {s.requiresFtw ? (
                        <Badge variant="warning">FTW</Badge>
                      ) : (
                        <span className="text-(--text-tertiary)">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {canManage ? (
                        <div className="flex gap-2">
                          <IconButton
                            aria-label={t.faActPick}
                            onClick={() => setPicking(s)}
                          >
                            <UserCog />
                          </IconButton>
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <StateBox
            icon={<Users className="text-(--color-primary-bright)" />}
            title={t.faActNoBoard}
            body={t.faActNoBoardB}
          />
        )}

        {slots.length ? (
          <PanelFoot>
            <FootSum>
              <b>{crewed}</b> / <b>{slots.length}</b> {t.fahThAlloc}
            </FootSum>
          </PanelFoot>
        ) : null}
      </Panel>

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
