"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bus, Pencil, Plus, Trash2 } from "lucide-react";

import { MENU_LABELS } from "@universe/contracts";

import type { AccessMode } from "@/lib/access";
import { api, errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
  busSchedulesKey,
  busSchedulesQueryOptions,
  busUnitsQueryOptions,
  type BusScheduleRow,
} from "@/lib/queries/bus-schedules";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Checkbox, ToggleRow } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogIcon,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  FootSum,
  PageTitle,
  Panel,
  PanelFoot,
  Toolbar,
  ToolbarTitle,
} from "@/components/ui/panel";
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

/**
 * Bus departure schedules.
 *
 * A bus is not an entity of its own (design D6) — it is a unit whose type is
 * `BUS` with a departure time attached, which is why this screen picks a unit
 * rather than describing one. Its options come from `/v1/bus-schedules/units`
 * rather than from `/v1/units`, because a caller who may schedule a bus need
 * hold no grant on `database-unit`.
 *
 * With no `BUS` unit in the fleet there is nothing to schedule, and the screen
 * says so instead of offering an empty dropdown.
 */
export function BusMenu({ mode }: { mode: AccessMode }) {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const canW = mode === "manage";

  const listQ = useQuery(busSchedulesQueryOptions());
  const unitsQ = useQuery(busUnitsQueryOptions());
  const rows = React.useMemo(() => listQ.data ?? [], [listQ.data]);
  const busUnits = React.useMemo(() => unitsQ.data ?? [], [unitsQ.data]);

  const [dlgOpen, setDlgOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<BusScheduleRow | null>(null);
  const [fUnitId, setFUnitId] = React.useState("");
  const [fAt, setFAt] = React.useState("05:30");
  const [fActive, setFActive] = React.useState(true);
  const [delTarget, setDelTarget] = React.useState<BusScheduleRow | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: busSchedulesKey });

  const save = useMutation({
    mutationFn: async (input: {
      id: string | null;
      unitId: string;
      departAt: string;
      active: boolean;
    }) => {
      const result = input.id
        ? await api.v1["bus-schedules"]({ id: input.id }).patch({
            departAt: input.departAt,
            active: input.active,
          })
        : await api.v1["bus-schedules"].post({
            unitId: input.unitId,
            departAt: input.departAt,
            active: input.active,
          });
      if (result.error) throw result.error;
      return result.data;
    },
    onSuccess: async (_d, input) => {
      await invalidate();
      pushToast(
        "success",
        input.id ? t.mdEditToastT : t.mdAddToastT,
        input.departAt
      );
      setDlgOpen(false);
    },
    // A second schedule for the same unit is a 409 with the API's own wording.
    onError: (error) =>
      pushToast("error", t.mdAdd, errorMessage(error, t.loginErr)),
  });

  const del = useMutation({
    mutationFn: async (row: BusScheduleRow) => {
      const { error } = await api.v1["bus-schedules"]({ id: row.id }).delete();
      if (error) throw error;
    },
    onSuccess: async (_d, row) => {
      await invalidate();
      pushToast("success", t.mdDelToastT, row.unitCode);
      setDelTarget(null);
    },
    onError: (error) =>
      pushToast("error", t.mdDelT, errorMessage(error, t.loginErr)),
  });

  /** A unit that already has a schedule is not offered a second time. */
  const available = busUnits.filter(
    (u) => !rows.some((r) => r.unitId === u.id)
  );

  function openAdd() {
    setEditing(null);
    setFUnitId(available[0]?.id ?? "");
    setFAt("05:30");
    setFActive(true);
    setDlgOpen(true);
  }
  function openEdit(r: BusScheduleRow) {
    setEditing(r);
    setFUnitId(r.unitId);
    setFAt(r.departAt);
    setFActive(r.active);
    setDlgOpen(true);
  }
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing && !fUnitId) return;
    save.mutate({
      id: editing?.id ?? null,
      unitId: fUnitId,
      departAt: fAt,
      active: fActive,
    });
  }

  const noBusUnits = !unitsQ.isPending && busUnits.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={MENU_LABELS.bus} sub={t.busSub}>
        {canW && !noBusUnits ? (
          <Button onClick={openAdd} disabled={available.length === 0}>
            <Plus />
            {t.mdAdd}
          </Button>
        ) : null}
      </PageTitle>

      <Panel>
        <Toolbar>
          <ToolbarTitle>{MENU_LABELS.bus}</ToolbarTitle>
        </Toolbar>

        {noBusUnits ? (
          <StateBox
            icon={<Bus className="text-(--color-primary-bright)" />}
            title={t.busNoUnitsT}
            body={t.busNoUnitsB}
          />
        ) : rows.length ? (
          <Table>
            <TableHeader>
              <tr>
                <TableHead>{t.thUnitCode}</TableHead>
                <TableHead>{t.mdJam}</TableHead>
                <TableHead>{t.thStatus}</TableHead>
                <TableHead style={{ width: 110 }}>{t.thAct}</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <span className="font-semibold">{r.unitCode}</span>
                  </TableCell>
                  <TableCell className="font-mono">{r.departAt}</TableCell>
                  <TableCell>
                    <Badge variant={r.active ? "success" : "danger"} dot>
                      {r.active ? t.stAktif : t.stNonaktif}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      {canW ? (
                        <>
                          <IconButton
                            aria-label={t.mdEditT}
                            onClick={() => openEdit(r)}
                          >
                            <Pencil />
                          </IconButton>
                          <IconButton
                            danger
                            aria-label={t.empDel}
                            onClick={() => setDelTarget(r)}
                          >
                            <Trash2 />
                          </IconButton>
                        </>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <StateBox
            icon={<Bus className="text-(--color-primary-bright)" />}
            title={t.noResTitle}
            body={t.busEmptyB}
          />
        )}

        <PanelFoot>
          <FootSum>
            <b>{rows.length}</b> {t.busSumB}
          </FootSum>
        </PanelFoot>
      </Panel>

      <Dialog
        open={dlgOpen}
        onClose={() => setDlgOpen(false)}
        labelledBy="bs-t"
      >
        <DialogIcon variant="info">
          <Bus />
        </DialogIcon>
        <DialogTitle id="bs-t">{editing ? t.mdEditT : t.mdAdd}</DialogTitle>
        <DialogBody>{t.busDlgB}</DialogBody>
        <form onSubmit={submit} noValidate>
          <Field
            className="mt-4"
            label={t.thUnitCode}
            htmlFor="bs-unit"
            required
          >
            {/* The unit a schedule belongs to is fixed once set: moving it would
                be a different bus, which is a delete and a create. */}
            <Select
              id="bs-unit"
              value={fUnitId}
              disabled={!!editing}
              onChange={(e) => setFUnitId(e.target.value)}
            >
              {editing ? (
                <option value={editing.unitId}>{editing.unitCode}</option>
              ) : (
                available.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.code}
                  </option>
                ))
              )}
            </Select>
          </Field>
          <Field className="mt-4" label={t.mdJam} htmlFor="bs-at">
            <Input
              id="bs-at"
              type="time"
              className="font-mono"
              value={fAt}
              onChange={(e) => setFAt(e.target.value)}
            />
          </Field>
          <ToggleRow className="mt-4" htmlFor="bs-active">
            <Checkbox
              id="bs-active"
              checked={fActive}
              onChange={(e) => setFActive(e.target.checked)}
            />
            {t.stAktif}
          </ToggleRow>
          <DialogActions>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDlgOpen(false)}
            >
              {t.btnCancel}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {editing ? t.udbSaveEdit : t.mdSaveAdd}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      <Dialog
        open={!!delTarget}
        onClose={() => setDelTarget(null)}
        labelledBy="bsd-t"
      >
        <DialogIcon variant="danger">
          <Trash2 />
        </DialogIcon>
        <DialogTitle id="bsd-t">
          {t.mdDelT} &ldquo;{delTarget?.unitCode}&rdquo;?
        </DialogTitle>
        <DialogBody>{t.mdDelB}</DialogBody>
        <DialogActions>
          <Button variant="ghost" onClick={() => setDelTarget(null)}>
            {t.btnCancel}
          </Button>
          <Button
            variant="destructive"
            disabled={del.isPending}
            onClick={() => delTarget && del.mutate(delTarget)}
          >
            {t.empDelDo}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
