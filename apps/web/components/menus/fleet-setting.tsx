"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Pencil, Plus, Trash2, Truck, Upload, X } from "lucide-react";

import {
  FLEET_MAX_UNITS,
  FLEET_MIN_UNITS,
  FLEET_TRANSPORT_TYPE_NAMES,
} from "@universe/contracts";

import type { AccessMode } from "@/lib/access";
import { api, errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
  fleetsKey,
  fleetsQueryOptions,
  noFleetKey,
  noFleetQueryOptions,
  type FleetRow,
} from "@/lib/queries/fleets";
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
import { Input } from "@/components/ui/input";
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
 * **Any unit may lead** (owner, 2026-09-04). The screen used to offer only
 * excavators, from a class heuristic it kept privately; the yard runs
 * formations led by a road unit and by a dump truck, and the API never
 * enforced the heuristic anyway. So both selects offer the whole register and
 * the API's own exclusivity rules do the refusing.
 */

/**
 * What the transport select shows for a formation whose units already ride
 * different vehicles: leave them as they are.
 */
const KEEP_TRANSPORT = "\u0000keep";

/** What the list column shows for a formation's transport. */
const transportSummary = (f: FleetRow) => {
  const rides = [...new Set(f.units.map((u) => u.transportCode ?? ""))].filter(
    (c) => c.length > 0
  );
  if (!rides.length) return "—";
  return rides.length === 1 ? rides[0]! : `${rides.length} angkutan`;
};

/** The one vehicle a formation rides, or the sentinel when it rides several. */
const transportOf = (f: FleetRow) => {
  const rides = new Set(f.units.map((u) => u.transportCode ?? ""));
  return rides.size <= 1 ? ([...rides][0] ?? "") : KEEP_TRANSPORT;
};

/** Label tipe unit ringkas: "model · merk". */
const unitTypeLabel = (u: UnitRow) => `${u.modelName} · ${u.brandName}`;

/** Matches `maxItems` on the bulk-delete route; see the mutation for why. */
const BULK_CHUNK = 200;

export function FleetSettingMenu({ mode }: { mode: AccessMode }) {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const router = useRouter();
  const canW = mode === "manage";

  const fleetsQ = useQuery(fleetsQueryOptions());
  const fleets = React.useMemo(() => fleetsQ.data ?? [], [fleetsQ.data]);

  /* The no-fleet entry — machines in no formation that still get an operator.
     Fetched separately because it is not a fleet: no digger, no area, no bus,
     and nothing to disband. */
  const noFleetQ = useQuery(noFleetQueryOptions());
  const noFleet = React.useMemo(
    () => noFleetQ.data?.units ?? [],
    [noFleetQ.data]
  );

  // Active units — the only catalogue this screen still offers from.
  const unitsQ = useQuery(unitsQueryOptions({ active: true }));
  const units = React.useMemo(() => unitsQ.data ?? [], [unitsQ.data]);

  /* Satu katalog untuk pemimpin maupun anggota: keduanya unit biasa, dan yang
     memisahkan mereka adalah perannya di fleet ini, bukan jenisnya. */
  const UNIT_TYPE = React.useMemo(
    () =>
      Object.fromEntries(
        units.map((u) => [u.code, unitTypeLabel(u)])
      ) as Record<string, string>,
    [units]
  );
  const OHT_POOL = React.useMemo(() => Object.keys(UNIT_TYPE), [UNIT_TYPE]);
  /* Angkutan fleet: bus, dan manhaul truck yang mengantar ke lokasi juga.
     Dikelompokkan per jenis — MH1001 di antara UD-BU07 dan UD-BU08 terlihat
     seperti kesalahan data sampai jenisnya ikut tertulis. */
  const BUS_GROUPS = React.useMemo(
    () =>
      FLEET_TRANSPORT_TYPE_NAMES.map((name) => ({
        name,
        codes: units
          .filter((u) => u.typeName.trim().toUpperCase() === name)
          .map((u) => u.code),
      })).filter((g) => g.codes.length),
    [units]
  );
  const BUS_OPTS = React.useMemo(
    () => BUS_GROUPS.flatMap((g) => g.codes),
    [BUS_GROUPS]
  );
  /** Code → id at the submit edge; the API speaks ids, the operator codes. */
  const unitIdByCode = React.useMemo(
    () => new Map(units.map((u) => [u.code, u.id])),
    [units]
  );

  // add/edit dialog
  const [dlgOpen, setDlgOpen] = React.useState(false);
  const [editId, setEditId] = React.useState<string | null>(null);
  const [fLeader, setFLeader] = React.useState("");
  /**
   * The vehicle for the whole formation, or `KEEP_TRANSPORT` when its units
   * already ride different ones.
   *
   * Transport is per unit now, and the import is where per-unit differences
   * come from. This dialog edits a formation, so it offers one value — and
   * rather than flatten a mixed formation on every save, it opens on the
   * sentinel and submits nothing at all for transport unless somebody picks.
   */
  const [fBus, setFBus] = React.useState("");
  const [fLoc, setFLoc] = React.useState("");
  const [fUnits, setFUnits] = React.useState<string[]>([]);
  const [unitQ, setUnitQ] = React.useState("");
  const [fActive, setFActive] = React.useState(true);
  const [errLeader, setErrLeader] = React.useState(false);
  const [errLoc, setErrLoc] = React.useState(false);
  const [errUnits, setErrUnits] = React.useState("");
  const [delTarget, setDelTarget] = React.useState<FleetRow | null>(null);

  /**
   * Selection is a set of ids, not of rows: the list is refetched after every
   * write, and holding row objects would keep a tick attached to a stale copy
   * of a formation whose members have since changed underneath it.
   */
  const [sel, setSel] = React.useState<ReadonlySet<string>>(() => new Set());
  const [bulkOpen, setBulkOpen] = React.useState(false);

  // no-fleet dialog — a read-only list; membership is derived, not chosen
  const [nfOpen, setNfOpen] = React.useState(false);
  const [nfQ, setNfQ] = React.useState("");

  /* The no-fleet entry follows the formations, so every write that changes a
     formation changes it too. Invalidating both together is what keeps the
     pinned row honest after a fleet is created, edited or disbanded. */
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: fleetsKey }),
      queryClient.invalidateQueries({ queryKey: noFleetKey }),
    ]);

  const save = useMutation({
    mutationFn: async (input: {
      id: string | null;
      leaderUnitId: string;
      workArea: string;
      transports?: Record<string, string | null>;
      unitIds: string[];
      active: boolean;
    }) => {
      const body = {
        leaderUnitId: input.leaderUnitId,
        workArea: input.workArea,
        unitIds: input.unitIds,
        active: input.active,
        ...(input.transports ? { transports: input.transports } : {}),
      };
      const result = input.id
        ? await api.v1.fleets({ id: input.id }).patch(body)
        : await api.v1.fleets.post(body);
      if (result.error) throw result.error;
      return result.data;
    },
    onSuccess: async (_d, input) => {
      await invalidate();
      pushToast("success", input.id ? t.flToastEdit : t.flToastAdd, fLeader);
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
      pushToast("success", t.flToastDel, row.leaderCode);
      setDelTarget(null);
      setSel((prev) => {
        if (!prev.has(row.id)) return prev;
        const next = new Set(prev);
        next.delete(row.id);
        return next;
      });
    },
    onError: (error) =>
      pushToast("error", t.flDelT, errorMessage(error, t.loginErr)),
  });

  const bulkDel = useMutation({
    /**
     * Chunked to the endpoint's own `maxItems`, so a selection accumulated
     * across pages cannot fail as a whole on a cap the operator never sees.
     */
    mutationFn: async (ids: string[]) => {
      let deleted = 0;
      for (let i = 0; i < ids.length; i += BULK_CHUNK) {
        const result = await api.v1.fleets["bulk-delete"].post({
          ids: ids.slice(i, i + BULK_CHUNK),
        });
        if (result.error) throw result.error;
        deleted += result.data.deleted;
      }
      return deleted;
    },
    onSuccess: (deleted) => {
      setBulkOpen(false);
      setSel(new Set());
      pushToast("success", t.flToastDel, `${deleted} ${t.flBulkDelToast}`);
    },
    onError: (error) =>
      pushToast("error", t.flDelT, errorMessage(error, t.loginErr)),
    // In `onSettled` rather than `onSuccess`: a chunk that throws may still
    // have been preceded by chunks that landed, and the list has to catch up
    // either way.
    onSettled: () => invalidate(),
  });

  const [listQ, setListQ] = React.useState("");
  const listNeedle = listQ.trim().toLowerCase();
  const listRows = listNeedle
    ? fleets.filter(
        (f) =>
          f.leaderCode.toLowerCase().includes(listNeedle) ||
          f.workArea.toLowerCase().includes(listNeedle) ||
          f.units.some((u) =>
            (u.transportCode ?? "").toLowerCase().includes(listNeedle)
          )
      )
    : fleets;
  const pg = usePagination(listRows, "5");

  // Resolved against the whole list rather than the filtered one, so typing in
  // the search box does not silently drop formations already ticked on another
  // page. Ids that no longer exist fall out here without needing to be pruned.
  const selectedIds = React.useMemo(
    () => fleets.filter((f) => sel.has(f.id)).map((f) => f.id),
    [fleets, sel]
  );

  // The header checkbox governs the page, not the whole filtered set: ticking
  // one box and silently arming a delete over formations on four other pages
  // is the kind of help nobody asks for. Selections still accumulate.
  const pageIds = pg.rows.map((f) => f.id);
  const allPageSel = pageIds.length > 0 && pageIds.every((id) => sel.has(id));
  const somePageSel = pageIds.some((id) => sel.has(id));

  function toggleRow(id: string) {
    setSel((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }
  function togglePage() {
    setSel((prev) => {
      const next = new Set(prev);
      for (const id of pageIds) {
        if (allPageSel) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  const leaderTypeOf = (code: string) => UNIT_TYPE[code] ?? "—";
  const leaderOpts = Object.keys(UNIT_TYPE)
    .filter(
      (code) => !fleets.some((f) => f.leaderCode === code && f.id !== editId)
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

  /* Anything no formation has already claimed. A unit is configured in exactly
     one place, so a digger or a hauler is not offered here — the API refuses it
     by name anyway, and offering it would be a trap. */
  const inAFleet = React.useMemo(
    () =>
      new Set([
        ...fleets.map((f) => f.leaderCode),
        ...fleets.flatMap((f) => f.units.map((u) => u.code)),
      ]),
    [fleets]
  );
  const nfFiltered = React.useMemo(() => {
    const needle = nfQ.trim().toUpperCase();
    return needle
      ? noFleet.filter((u) => u.code.toUpperCase().includes(needle))
      : noFleet;
  }, [noFleet, nfQ]);
  const unitTypeOf = React.useMemo(
    () => new Map(units.map((u) => [u.code, unitTypeLabel(u)])),
    [units]
  );

  function openNoFleet() {
    setNfQ("");
    setNfOpen(true);
  }

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
    setFLeader(leaderOpts[0] || "");
    setFBus("");
    setFLoc("");
    setFUnits([]);
    setUnitQ("");
    setFActive(true);
    setErrLeader(false);
    setErrLoc(false);
    setErrUnits("");
    setDlgOpen(true);
  }

  function openEdit(f: FleetRow) {
    setEditId(f.id);
    setFLeader(f.leaderCode);
    setFBus(transportOf(f));
    setFLoc(f.workArea);
    setFUnits(f.units.map((u) => u.code));
    setUnitQ("");
    setFActive(f.active);
    setErrLeader(false);
    setErrLoc(false);
    setErrUnits("");
    setDlgOpen(true);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const digger = fLeader.trim();
    const badLeader =
      !digger || fleets.some((f) => f.leaderCode === digger && f.id !== editId);
    setErrLeader(badLeader);
    // Nothing behind this field validates it any more, so the emptiness check
    // that the master list used to make implicit is made here.
    const workArea = fLoc.trim();
    setErrLoc(!workArea);
    const unitsErr =
      fUnits.length > FLEET_MAX_UNITS
        ? t.flErrMax
        : fUnits.length < FLEET_MIN_UNITS
          ? t.flErrMin
          : "";
    setErrUnits(unitsErr);
    if (badLeader || !workArea || unitsErr) return;

    // The maps are built from the same lists the selects offered, so a miss
    // here means the catalogue changed under the open dialog — surfaced as
    // an error rather than submitted as a broken reference. The work area is
    // not among them: it is typed, so there is nothing to resolve.
    const leaderUnitId = unitIdByCode.get(digger);
    const unitIds = fUnits.map((c) => unitIdByCode.get(c));
    if (!leaderUnitId || unitIds.some((id) => !id)) {
      pushToast("error", t.flAdd, t.loginErr);
      return;
    }

    /* Left out entirely on the sentinel, which is what keeps a formation whose
       units ride different vehicles from being flattened by an edit that was
       never about transport. */
    const busUnitId =
      fBus && fBus !== KEEP_TRANSPORT ? (unitIdByCode.get(fBus) ?? null) : null;
    const transports =
      fBus === KEEP_TRANSPORT
        ? undefined
        : Object.fromEntries(
            [leaderUnitId, ...(unitIds as string[])].map((id) => [
              id,
              busUnitId,
            ])
          );

    save.mutate({
      id: editId,
      leaderUnitId,
      workArea,
      transports,
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
            {/* Appended rather than prepended so the search box keeps its
                position when a selection appears and disappears. */}
            {canW && selectedIds.length ? (
              <Button variant="destructive" onClick={() => setBulkOpen(true)}>
                <Trash2 />
                {t.mdBulkDel} ({selectedIds.length})
              </Button>
            ) : null}
          </ToolbarGroup>
        </Toolbar>
        <Table>
          <TableHeader>
            <tr>
              {canW ? (
                <TableHead style={{ width: 44 }}>
                  <Checkbox
                    ref={(el) => {
                      // Indeterminate is a DOM property, not an attribute —
                      // there is no way to express it in JSX.
                      if (el) el.indeterminate = somePageSel && !allPageSel;
                    }}
                    checked={allPageSel}
                    onChange={togglePage}
                    aria-label={t.flSelAll}
                  />
                </TableHead>
              ) : null}
              <TableHead>Fleet</TableHead>
              <TableHead>{t.flLoc}</TableHead>
              <TableHead className="max-xl:hidden">{t.flBus}</TableHead>
              <TableHead>{t.flUnits}</TableHead>
              <TableHead>{t.thStatus}</TableHead>
              <TableHead style={{ width: 110 }}>{t.thAct}</TableHead>
            </tr>
          </TableHeader>
          <TableBody>
            {/* Pinned above the formations, and there is no delete on it: it
                has no record to delete. A site always has machines that belong
                to no formation and still have to be crewed, so the entry is
                part of the screen rather than something to create.

                Hidden while the list is being searched — the search is for a
                formation, and a fixed row that ignored it would read as a
                result that does not match. */}
            {!listNeedle ? (
              <TableRow>
                {/* Empty rather than absent: there is no record here to
                    delete, and the columns still have to line up. */}
                {canW ? <TableCell /> : null}
                <TableCell>
                  <NameCell name={t.flNoFleet} sub={t.flNoFleetSub} />
                </TableCell>
                <TableCell className="text-(--text-tertiary)">—</TableCell>
                <TableCell className="text-(--text-tertiary) max-xl:hidden">
                  —
                </TableCell>
                <TableCell>
                  {/* A count and a sample, not the whole list: this is most of
                      the register, and several hundred badges would bury the
                      formations underneath it. The dialog has the full list. */}
                  {noFleet.length ? (
                    <div className="flex max-w-[320px] flex-wrap items-center gap-1">
                      {noFleet.slice(0, 3).map((u) => (
                        <Badge key={u.id} variant="info">
                          {u.code}
                        </Badge>
                      ))}
                      {noFleet.length > 3 ? (
                        <span className="text-xs text-(--text-tertiary)">
                          +{noFleet.length - 3} {t.flSumB.toLowerCase()}
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-xs text-(--text-tertiary) italic">
                      {t.flNoFleetEmpty}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="neutral">{t.flNoFleetFixed}</Badge>
                </TableCell>
                <TableCell>
                  {/* Not gated on write access: there is nothing to write. */}
                  <IconButton aria-label={t.flNoFleet} onClick={openNoFleet}>
                    <Eye />
                  </IconButton>
                </TableCell>
              </TableRow>
            ) : null}
            {pg.rows.map((f) => (
              <TableRow key={f.id} selected={sel.has(f.id)}>
                {canW ? (
                  <TableCell>
                    <Checkbox
                      checked={sel.has(f.id)}
                      onChange={() => toggleRow(f.id)}
                      aria-label={`${t.flSelRow} — ${f.leaderCode}`}
                    />
                  </TableCell>
                ) : null}
                <TableCell>
                  <NameCell
                    name={f.leaderCode}
                    sub={leaderTypeOf(f.leaderCode)}
                  />
                </TableCell>
                <TableCell>{f.workArea}</TableCell>
                <TableCell className="font-mono max-xl:hidden">
                  {/* The formation's ride when its units share one, otherwise
                      how many they are spread across — a single code here
                      would misdirect every crew not on it. */}
                  {transportSummary(f)}
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
          {editId ? `${t.flEditT} ${fLeader}` : t.flAdd}
        </DialogTitle>
        <DialogBody>{t.flDlgB}</DialogBody>
        <form onSubmit={submit} noValidate>
          <FormGrid className="mt-4">
            <Field
              label="Digger (fleet leader)"
              htmlFor="fl-digger"
              required
              error={errLeader}
              errorMessage={t.flErrLeader}
            >
              <Select
                id="fl-digger"
                value={fLeader}
                onChange={(e) => setFLeader(e.target.value)}
              >
                {editId && !leaderOpts.includes(fLeader) ? (
                  <option value={fLeader}>{fLeader}</option>
                ) : null}
                {leaderOpts.map((c) => (
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
                {/* Only offered when the formation actually is mixed, so the
                    ordinary case keeps a two-item choice. */}
                {fBus === KEEP_TRANSPORT ? (
                  <option value={KEEP_TRANSPORT}>{t.flBusMixed}</option>
                ) : null}
                <option value="">
                  {BUS_OPTS.length
                    ? "— pilih angkutan —"
                    : "— belum ada bus/manhaul —"}
                </option>
                {BUS_GROUPS.map((g) => (
                  <optgroup key={g.name} label={g.name}>
                    {g.codes.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            </Field>
            <Field
              className="col-span-full"
              label={t.flLoc}
              htmlFor="fl-loc"
              required
              error={errLoc}
              errorMessage={t.flErrLoc}
            >
              {/* Typed, not picked: pits open and close within days, so a
                  master list of them would be mostly dead rows. Nothing keeps
                  the spelling uniform — that is the trade. */}
              <Input
                id="fl-loc"
                value={fLoc}
                onChange={(e) => setFLoc(e.target.value)}
                placeholder={t.flLocPh}
                maxLength={120}
                autoComplete="off"
              />
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
                          {UNIT_TYPE[code] ?? "—"}
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

      {/* Dialog no-fleet — hanya daftar unit, tidak ada yang lain diputuskan */}
      <Dialog
        open={nfOpen}
        onClose={() => setNfOpen(false)}
        className="w-[min(560px,100%)]"
        labelledBy="nf-t"
      >
        <DialogIcon variant="info">
          <Truck />
        </DialogIcon>
        <DialogTitle id="nf-t">{t.flNoFleet}</DialogTitle>
        <DialogBody>{t.flNoFleetDlgB}</DialogBody>
        {/* Read-only: membership is a consequence of the formations, so there
            is nothing here to submit. The search is worth keeping — the list
            is the size of the yard minus its fleets. */}
        <div className="mt-4 flex min-h-0 flex-1 flex-col gap-2">
          <SearchInput
            placeholder={t.flUnitSearchPh}
            aria-label={t.flUnitSearchPh}
            value={nfQ}
            onChange={(e) => setNfQ(e.target.value)}
          />
          <div className="max-h-72 min-h-0 flex-1 overflow-y-auto rounded-control border border-(--divider) bg-(--fill-subtle) p-1.5">
            {nfFiltered.length ? (
              nfFiltered.map((u) => (
                <div
                  key={u.id}
                  className="flex items-center gap-2.5 rounded-lg px-2 py-1.5"
                >
                  <span className="font-mono text-sm font-semibold">
                    {u.code}
                  </span>
                  <span className="text-xs text-(--text-tertiary)">
                    {unitTypeOf.get(u.code) ?? "—"}
                  </span>
                </div>
              ))
            ) : (
              <p className="px-2 py-1.5 text-xs text-(--text-tertiary)">
                {noFleet.length ? t.noResTitle : t.flNoFleetEmpty}
              </p>
            )}
          </div>
        </div>
        <DialogActions>
          <Button variant="ghost" onClick={() => setNfOpen(false)}>
            {t.btnClose}
          </Button>
        </DialogActions>
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
          {t.flDelT} {delTarget?.leaderCode}?
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

      {/* Dialog hapus beberapa fleet sekaligus */}
      <Dialog
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        labelledBy="flb-t"
      >
        <DialogIcon variant="danger">
          <Trash2 />
        </DialogIcon>
        <DialogTitle id="flb-t">{t.flBulkDelT}</DialogTitle>
        <DialogBody>
          <b>{selectedIds.length}</b> {t.flSumB} — {t.flBulkDelB}
        </DialogBody>
        <DialogActions>
          <Button variant="ghost" onClick={() => setBulkOpen(false)}>
            {t.btnCancel}
          </Button>
          <Button
            variant="destructive"
            disabled={bulkDel.isPending || !selectedIds.length}
            onClick={() => bulkDel.mutate(selectedIds)}
          >
            {t.mdBulkDel}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
