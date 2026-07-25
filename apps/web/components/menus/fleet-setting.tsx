"use client";

import * as React from "react";
import { Pencil, Plus, Trash2, Truck, Upload, X } from "lucide-react";

import type { AccessMode } from "@/lib/access";
import { AREA_MINING_NAMES } from "@/lib/area-data";
import { useI18n } from "@/lib/i18n";
import {
  BUS_UNITS,
  DIGGER_UNITS,
  FLEET_MEMBER_UNITS,
  unitTypeLabel,
} from "@/lib/unit-data";
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
  DNote,
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

const FLEET_MIN_UNITS = 1;
const FLEET_MAX_UNITS = 13;

type Fleet = {
  id: string;
  digger: string;
  loc: string;
  bus: string;
  units: string[];
  active: boolean;
};

/* ---- semua dropdown di-derive dari master (unit + area kerja) ---- */
/* Digger = unit jenis EXCAVATOR / kelas BIGDIGGER-MEDIUMDIGGER-SMALLDIGGER */
const DIGGERS: Record<string, string> = Object.fromEntries(
  DIGGER_UNITS.map((u) => [u.code, unitTypeLabel(u)])
);
/* Kode bus dari unit berjenis BUS — kosong sampai unit BUS ada di master */
const BUS_OPTS = BUS_UNITS.map((u) => u.code);
/* Lokasi kerja = area kerja bertipe Mining (lokasi operasi fleet) */
const AREA_OPTS = AREA_MINING_NAMES;
/* Anggota fleet = unit non-digger (hauler/support), label "model · merk" */
const OHT_TYPE: Record<string, string> = Object.fromEntries(
  FLEET_MEMBER_UNITS.map((u) => [u.code, unitTypeLabel(u)])
);
const OHT_POOL = Object.keys(OHT_TYPE);

const INITIAL: Fleet[] = [
  {
    id: "fl1",
    digger: "EX8001",
    loc: "Panel East Puncak Utara",
    bus: "",
    units: ["RD5001", "RD5002", "RD4001", "RD4002"],
    active: true,
  },
  {
    id: "fl2",
    digger: "EX7001",
    loc: "Disposal T4",
    bus: "",
    units: ["DT4017", "DT4018", "DT3013"],
    active: true,
  },
];

export function FleetSettingMenu({ mode }: { mode: AccessMode }) {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const canW = mode === "manage";

  const [fleets, setFleets] = React.useState<Fleet[]>(INITIAL);

  // add/edit dialog
  const importRef = React.useRef<HTMLInputElement>(null);
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
  const [delTarget, setDelTarget] = React.useState<Fleet | null>(null);

  const [listQ, setListQ] = React.useState("");
  const listNeedle = listQ.trim().toLowerCase();
  const listRows = listNeedle
    ? fleets.filter(
        (f) =>
          f.digger.toLowerCase().includes(listNeedle) ||
          f.loc.toLowerCase().includes(listNeedle) ||
          f.bus.toLowerCase().includes(listNeedle)
      )
    : fleets;
  const pg = usePagination(listRows, "5");

  const diggerTypeOf = (code: string) => DIGGERS[code] ?? "—";
  const diggerOpts = Object.keys(DIGGERS)
    .filter((code) => !fleets.some((f) => f.digger === code && f.id !== editId))
    .sort();
  /* unit milik fleet lain disembunyikan */
  const usedElsewhere = new Set(
    fleets.filter((f) => f.id !== editId).flatMap((f) => f.units)
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

  function openEdit(f: Fleet) {
    setEditId(f.id);
    setFDigger(f.digger);
    setFBus(f.bus);
    setFLoc(f.loc);
    setFUnits(f.units);
    setUnitQ("");
    setFActive(f.active);
    setErrDigger(false);
    setErrUnits("");
    setDlgOpen(true);
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    const digger = fDigger.trim();
    const badDigger =
      !digger || fleets.some((f) => f.digger === digger && f.id !== editId);
    setErrDigger(badDigger);
    const unitsErr =
      fUnits.length > FLEET_MAX_UNITS
        ? t.flErrMax
        : fUnits.length < FLEET_MIN_UNITS
          ? t.flErrMin
          : "";
    setErrUnits(unitsErr);
    if (badDigger || unitsErr) return;

    const data = {
      digger,
      loc: fLoc.trim(),
      bus: fBus,
      units: fUnits,
      active: fActive,
    };
    if (editId) {
      setFleets((prev) =>
        prev.map((f) => (f.id === editId ? { ...f, ...data } : f))
      );
      pushToast("success", t.flToastEdit, digger);
    } else {
      setFleets((prev) => [
        ...prev,
        { id: `fl${prev.length + 1}-${digger}`, ...data },
      ]);
      pushToast("success", t.flToastAdd, digger);
    }
    setDlgOpen(false);
  }

  function doDelete() {
    if (!delTarget) return;
    setFleets((prev) => prev.filter((f) => f.id !== delTarget.id));
    pushToast("success", t.flToastDel, delTarget.digger);
    setDelTarget(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={t.navFleetSetting} sub={t.flSub}>
        {canW ? (
          <Button onClick={openAdd}>
            <Plus />
            {t.flAdd}
          </Button>
        ) : null}
      </PageTitle>

      <Panel>
        <Toolbar>
          <ToolbarTitle>{t.flListTitle}</ToolbarTitle>
          <ToolbarGroup>
            <SearchInput
              className="w-[240px]"
              placeholder={t.flSearchPh}
              aria-label={t.flSearchPh}
              value={listQ}
              onChange={(e) => setListQ(e.target.value)}
            />
            {canW ? (
              <>
                <input
                  ref={importRef}
                  type="file"
                  accept=".csv,.xlsx"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) pushToast("success", `${t.udbImport} Fleet`, f.name);
                    e.target.value = "";
                  }}
                />
                <Button
                  variant="secondary"
                  onClick={() => importRef.current?.click()}
                >
                  <Upload />
                  {t.udbImport}
                </Button>
              </>
            ) : null}
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
                  <NameCell name={f.digger} sub={diggerTypeOf(f.digger)} />
                </TableCell>
                <TableCell>{f.loc}</TableCell>
                <TableCell className="font-mono max-xl:hidden">
                  {f.bus || "—"}
                </TableCell>
                <TableCell>
                  <div className="flex max-w-[320px] flex-wrap gap-1">
                    {f.units.map((u) => (
                      <Badge key={u} variant="info">
                        {u}
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

      <DNote title={t.flNoteT}>{t.flNoteB}</DNote>

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
        <form onSubmit={save} noValidate>
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
                        className="flex cursor-pointer items-center gap-1 rounded-chip border border-(--badge-info-border) bg-(--badge-info-fill) px-2 py-1 font-mono text-xs font-semibold text-(--color-primary-bright) hover:border-(--badge-danger-border) hover:text-(--color-danger-text)"
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
            <Button type="submit">
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
          {t.flDelT} {delTarget?.digger}?
        </DialogTitle>
        <DialogBody>{t.flDelB}</DialogBody>
        <DialogActions>
          <Button variant="ghost" onClick={() => setDelTarget(null)}>
            {t.btnCancel}
          </Button>
          <Button variant="destructive" onClick={doDelete}>
            {t.empDelDo}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
