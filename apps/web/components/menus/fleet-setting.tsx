"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2, Truck, Upload, X } from "lucide-react";

import { FLEET_MAX_UNITS, FLEET_MIN_UNITS } from "@universe/contracts";

import type { AccessMode } from "@/lib/access";
import { api, errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
  fleetsKey,
  fleetsQueryOptions,
  type FleetRow,
} from "@/lib/queries/fleets";
import { masterQueryOptions, recordType } from "@/lib/queries/master";
import { unitsQueryOptions, type UnitRow } from "@/lib/queries/units";
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
import { Field, FormGrid } from "@/components/ui/field";
import { Pagination, usePagination } from "@/components/ui/pagination";
import {
  FootSum,
  PageTitle,
  Panel,
  PanelFoot,
  Toolbar,
  ToolbarGroup,
  ToolbarTitle,
} from "@/components/ui/panel";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import {
  NameCell,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";

/* ---- semua dropdown di-derive dari master (unit + area kerja) ---- */
/**
 * The fleet records and the values the form offers both come from the API now;
 * the dialog still *thinks* in unit codes and area names because that is what
 * the operator reads, and translates to ids at the edge when it submits.
 *
 * Digger-ness is derived here rather than stored: it is a property of the unit
 * type and class, and the catalogues do not carry a "this is a fleet leader"
 * flag. Kept as the same rule the static module used — the API deliberately
 * does not enforce a heuristic.
 */
const DIGGER_CLASSES = ["BIGDIGGER", "MEDIUMDIGGER", "SMALLDIGGER"];
const isDigger = (u: UnitRow) =>
  u.typeName === "EXCAVATOR" || DIGGER_CLASSES.includes(u.className);

/** Label tipe unit ringkas: "model · merk". */
const unitTypeLabel = (u: UnitRow) => `${u.modelName} · ${u.brandName}`;

const BUS_TYPE_NAME = "BUS";

export function FleetSettingMenu({ mode }: { mode: AccessMode }) {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const router = useRouter();
  const canW = mode === "manage";

  const fleetsQ = useQuery(fleetsQueryOptions());
  const fleets = React.useMemo(() => fleetsQ.data ?? [], [fleetsQ.data]);

  // Active units and active Mining work areas — the values this screen offers.
  const unitsQ = useQuery(unitsQueryOptions({ active: true }));
  const areasQ = useQuery(masterQueryOptions("area-kerja", true));
  const units = React.useMemo(() => unitsQ.data ?? [], [unitsQ.data]);

  const DIGGERS = React.useMemo(
    () =>
      Object.fromEntries(
        units.filter(isDigger).map((u) => [u.code, unitTypeLabel(u)])
      ) as Record<string, string>,
    [units]
  );
  /* Anggota fleet = unit non-digger (hauler/support), label "model · merk". */
  const OHT_TYPE = React.useMemo(
    () =>
      Object.fromEntries(
        units.filter((u) => !isDigger(u)).map((u) => [u.code, unitTypeLabel(u)])
      ) as Record<string, string>,
    [units]
  );
  const OHT_POOL = React.useMemo(() => Object.keys(OHT_TYPE), [OHT_TYPE]);
  /* Kode bus dari unit berjenis BUS — kosong sampai unit BUS ada di master. */
  const BUS_OPTS = React.useMemo(
    () => units.filter((u) => u.typeName === BUS_TYPE_NAME).map((u) => u.code),
    [units]
  );
  /* Lokasi kerja = area kerja bertipe Mining (lokasi operasi fleet). */
  const MINING_AREAS = React.useMemo(
    () => (areasQ.data ?? []).filter((a) => recordType(a) === "Mining"),
    [areasQ.data]
  );
  const AREA_OPTS = React.useMemo(
    () => MINING_AREAS.map((a) => a.name),
    [MINING_AREAS]
  );

  /** Code → id at the submit edge; the API speaks ids, the operator codes. */
  const unitIdByCode = React.useMemo(
    () => new Map(units.map((u) => [u.code, u.id])),
    [units]
  );

  // add/edit dialog
  const [dlgOpen, setDlgOpen] = React.useState(false);
  const [editId, setEditId] = React.useState<string | null>(null);
  const [fDigger, setFDigger] = React.useState("");
  const [fBus, setFBus] = React.useState("");
  const [fLoc, setFLoc] = React.useState("");
  const [fUnits, setFUnits] = React.useState<string[]>([]);
  const [unitQ, setUnitQ] = React.useState("");
  const [fActive, setFActive] = React.useState(true);
  const [errDigger, setErrDigger] = React.useState(false);
  const [errUnits, setErrUnits] = React.useState("");
  const [delTarget, setDelTarget] = React.useState<FleetRow | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: fleetsKey });

  const save = useMutation({
    mutationFn: async (input: {
      id: string | null;
      diggerUnitId: string;
      workAreaId: string;
      busUnitId: string | null;
      unitIds: string[];
      active: boolean;
    }) => {
      const body = {
        diggerUnitId: input.diggerUnitId,
        workAreaId: input.workAreaId,
        busUnitId: input.busUnitId,
        unitIds: input.unitIds,
        active: input.active,
      };
      const result = input.id
        ? await api.v1.fleets({ id: input.id }).patch(body)
        : await api.v1.fleets.post(body);
      if (result.error) throw result.error;
      return result.data;
    },
    onSuccess: async (_d, input) => {
      await invalidate();
      pushToast("success", input.id ? t.flToastEdit : t.flToastAdd, fDigger);
      setDlgOpen(false);
    },
    onError: (error) =>
      pushToast("error", t.flAdd, errorMessage(error, t.loginErr)),
  });

  const del = useMutation({
    mutationFn: async (row: FleetRow) => {
      const { error } = await api.v1.fleets({ id: row.id }).delete();
      if (error) throw error;
    },
    onSuccess: async (_d, row) => {
      await invalidate();
      pushToast("success", t.flToastDel, row.diggerCode);
      setDelTarget(null);
    },
    onError: (error) =>
      pushToast("error", t.flDelT, errorMessage(error, t.loginErr)),
  });

  const [listQ, setListQ] = React.useState("");
  const listNeedle = listQ.trim().toLowerCase();
  const listRows = listNeedle
    ? fleets.filter(
        (f) =>
          f.diggerCode.toLowerCase().includes(listNeedle) ||
          f.workAreaName.toLowerCase().includes(listNeedle) ||
          (f.busCode ?? "").toLowerCase().includes(listNeedle)
      )
    : fleets;
  const pg = usePagination(listRows, "5");

  const diggerTypeOf = (code: string) => DIGGERS[code] ?? "—";
  const diggerOpts = Object.keys(DIGGERS)
    .filter(
      (code) => !fleets.some((f) => f.diggerCode === code && f.id !== editId)
    )
    .sort();
  /* unit milik fleet lain disembunyikan */
  const usedElsewhere = new Set(
    fleets
      .filter((f) => f.id !== editId)
      .flatMap((f) => f.units.map((u) => u.code))
  );
  const unitOpts = OHT_POOL.filter((c) => !usedElsewhere.has(c)).sort();
  const unitOptsFiltered = unitOpts.filter((c) =>
    c.toUpperCase().includes(unitQ.trim().toUpperCase())
  );

  function toggleUnit(code: string) {
    if (fUnits.includes(code)) {
      setFUnits(fUnits.filter((c) => c !== code));
      setErrUnits("");
      return;
    }
    if (fUnits.length >= FLEET_MAX_UNITS) {
      setErrUnits(t.flErrMax);
      return;
    }
    setFUnits([...fUnits, code]);
    setErrUnits("");
  }

  function openAdd() {
    setEditId(null);
    setFDigger(diggerOpts[0] || "");
    setFBus(BUS_OPTS[0] ?? "");
    setFLoc(AREA_OPTS[0] ?? "");
    setFUnits([]);
    setUnitQ("");
    setFActive(true);
    setErrDigger(false);
    setErrUnits("");
    setDlgOpen(true);
  }

  function openEdit(f: FleetRow) {
    setEditId(f.id);
    setFDigger(f.diggerCode);
    setFBus(f.busCode ?? "");
    setFLoc(f.workAreaName);
    setFUnits(f.units.map((u) => u.code));
    setUnitQ("");
    setFActive(f.active);
    setErrDigger(false);
    setErrUnits("");
    setDlgOpen(true);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const digger = fDigger.trim();
    const badDigger =
      !digger || fleets.some((f) => f.diggerCode === digger && f.id !== editId);
    setErrDigger(badDigger);
    const unitsErr =
      fUnits.length > FLEET_MAX_UNITS
        ? t.flErrMax
        : fUnits.length < FLEET_MIN_UNITS
          ? t.flErrMin
          : "";
    setErrUnits(unitsErr);
    if (badDigger || unitsErr) return;

    // The maps are built from the same lists the selects offered, so a miss
    // here means the catalogue changed under the open dialog — surfaced as
    // an error rather than submitted as a broken reference.
    const diggerUnitId = unitIdByCode.get(digger);
    const workAreaId = MINING_AREAS.find((a) => a.name === fLoc)?.id;
    const busUnitId = fBus ? unitIdByCode.get(fBus) : null;
    const unitIds = fUnits.map((c) => unitIdByCode.get(c));
    if (!diggerUnitId || !workAreaId || unitIds.some((id) => !id)) {
      pushToast("error", t.flAdd, t.loginErr);
      return;
    }

    save.mutate({
      id: editId,
      diggerUnitId,
      workAreaId,
      busUnitId: busUnitId ?? null,
      unitIds: unitIds as string[],
      active: fActive,
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={t.navFleetSetting} sub={t.flSub}>
        {canW ? (
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => router.push("/fleet-setting/import")}
            >
              <Upload />
              {t.upImport}
            </Button>
            <Button onClick={openAdd}>
              <Plus />
              {t.flAdd}
            </Button>
          </div>
        ) : null}
      </PageTitle>

      <Panel>
        <Toolbar>
          <ToolbarTitle>{t.flListTitle}</ToolbarTitle>
          <ToolbarGroup>
            <SearchInput
              className="w-60"
              placeholder={t.flSearchPh}
              aria-label={t.flSearchPh}
              value={listQ}
              onChange={(e) => setListQ(e.target.value)}
            />
          </ToolbarGroup>
        </Toolbar>
        <Table>
          <TableHeader>
            <tr>
              <TableHead>Fleet</TableHead>
              <TableHead>{t.flLoc}</TableHead>
              <TableHead className="max-xl:hidden">{t.flBus}</TableHead>
              <TableHead>{t.flUnits}</TableHead>
              <TableHead>{t.thStatus}</TableHead>
              <TableHead style={{ width: 110 }}>{t.thAct}</TableHead>
            </tr>
          </TableHeader>
          <TableBody>
            {pg.rows.map((f) => (
              <TableRow key={f.id}>
                <TableCell>
                  <NameCell
                    name={f.diggerCode}
                    sub={diggerTypeOf(f.diggerCode)}
                  />
                </TableCell>
                <TableCell>{f.workAreaName}</TableCell>
                <TableCell className="font-mono max-xl:hidden">
                  {f.busCode ?? "—"}
                </TableCell>
                <TableCell>
                  <div className="flex max-w-[320px] flex-wrap gap-1">
                    {f.units.map((u) => (
                      <Badge key={u.id} variant="info">
                        {u.code}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={f.active ? "success" : "danger"} dot>
                    {f.active ? t.stAktif : t.stNonaktif}
                  </Badge>
                </TableCell>
                <TableCell>
                  {canW ? (
                    <div className="flex gap-2">
                      <IconButton
                        aria-label={t.udbEditT}
                        onClick={() => openEdit(f)}
                      >
                        <Pencil />
                      </IconButton>
                      <IconButton
                        danger
                        aria-label={t.empDel}
                        onClick={() => setDelTarget(f)}
                      >
                        <Trash2 />
                      </IconButton>
                    </div>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <PanelFoot>
          <FootSum>
            {t.attSumA} <b>{pg.range}</b> {t.attSumB} <b>{pg.total}</b>{" "}
            {t.flSumB}
          </FootSum>
          <Pagination
            page={pg.page}
            pageCount={pg.pageCount}
            onPage={pg.setPage}
            per={pg.per}
            perOptions={["5", "10", "25"]}
            onPer={pg.setPer}
          />
        </PanelFoot>
      </Panel>

      {/* Dialog tambah/edit fleet */}
      <Dialog
        open={dlgOpen}
        onClose={() => setDlgOpen(false)}
        className="w-[min(560px,100%)]"
        labelledBy="fl-t"
      >
        <DialogIcon variant="info">
          <Truck />
        </DialogIcon>
        <DialogTitle id="fl-t">
          {editId ? `${t.flEditT} ${fDigger}` : t.flAdd}
        </DialogTitle>
        <DialogBody>{t.flDlgB}</DialogBody>
        <form onSubmit={submit} noValidate>
          <FormGrid className="mt-4">
            <Field
              label="Digger (fleet leader)"
              htmlFor="fl-digger"
              required
              error={errDigger}
              errorMessage={t.flErrDigger}
            >
              <Select
                id="fl-digger"
                value={fDigger}
                onChange={(e) => setFDigger(e.target.value)}
              >
                {editId && !diggerOpts.includes(fDigger) ? (
                  <option value={fDigger}>{fDigger}</option>
                ) : null}
                {diggerOpts.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t.flBus} htmlFor="fl-bus">
              <Select
                id="fl-bus"
                value={fBus}
                onChange={(e) => setFBus(e.target.value)}
              >
                <option value="">
                  {BUS_OPTS.length ? "— pilih bus —" : "— belum ada bus —"}
                </option>
                {BUS_OPTS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              className="col-span-full"
              label={t.flLoc}
              htmlFor="fl-loc"
              required
            >
              <Select
                id="fl-loc"
                value={fLoc}
                onChange={(e) => setFLoc(e.target.value)}
              >
                {AREA_OPTS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              className="col-span-full"
              label={`${t.flUnits} (OHT) — ${fUnits.length}/${FLEET_MAX_UNITS}`}
              htmlFor="fl-unit-search"
              helper={t.flUnitsHelp}
              error={!!errUnits}
              errorMessage={errUnits}
            >
              <div className="flex flex-col gap-2">
                {fUnits.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {fUnits.map((c) => (
                      <button
                        type="button"
                        key={c}
                        onClick={() => toggleUnit(c)}
                        aria-label={`${t.empDel} ${c}`}
                        className="flex cursor-pointer items-center gap-1 rounded-chip border border-(--badge-info-border) bg-(--badge-info-fill) px-2 py-1 font-mono text-xs font-semibold text-primary-bright hover:border-(--badge-danger-border) hover:text-danger-text"
                      >
                        {c}
                        <X className="size-3" />
                      </button>
                    ))}
                  </div>
                ) : null}
                <SearchInput
                  id="fl-unit-search"
                  placeholder={t.flUnitSearchPh}
                  value={unitQ}
                  onChange={(e) => setUnitQ(e.target.value)}
                />
                <div className="max-h-44 overflow-y-auto rounded-control border border-(--divider) bg-(--fill-subtle) p-1.5">
                  {unitOptsFiltered.length ? (
                    unitOptsFiltered.map((code) => (
                      <label
                        key={code}
                        className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-(--fill-hover)"
                      >
                        <Checkbox
                          checked={fUnits.includes(code)}
                          onChange={() => toggleUnit(code)}
                        />
                        <span className="font-mono text-sm font-semibold">
                          {code}
                        </span>
                        <span className="text-xs text-(--text-tertiary)">
                          {OHT_TYPE[code] ?? "—"}
                        </span>
                      </label>
                    ))
                  ) : (
                    <p className="px-2 py-1.5 text-xs text-(--text-tertiary)">
                      {t.noResTitle}
                    </p>
                  )}
                </div>
              </div>
            </Field>
          </FormGrid>
          <ToggleRow className="mt-4" htmlFor="fl-active">
            <Checkbox
              id="fl-active"
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
              {editId ? t.udbSaveEdit : t.flSaveAdd}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* Dialog hapus fleet */}
      <Dialog
        open={!!delTarget}
        onClose={() => setDelTarget(null)}
        labelledBy="fld-t"
      >
        <DialogIcon variant="danger">
          <Trash2 />
        </DialogIcon>
        <DialogTitle id="fld-t">
          {t.flDelT} {delTarget?.diggerCode}?
        </DialogTitle>
        <DialogBody>{t.flDelB}</DialogBody>
        <DialogActions>
          <Button variant="ghost" onClick={() => setDelTarget(null)}>
            {t.btnCancel}
          </Button>
          <Button
            variant="destructive"
            disabled={del.isPending}
            onClick={() => {
              if (delTarget) del.mutate(delTarget);
            }}
          >
            {t.empDelDo}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
