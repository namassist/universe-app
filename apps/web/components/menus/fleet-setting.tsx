"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Copy,
  Eye,
  Pencil,
  Plus,
  Trash2,
  Truck,
  Upload,
  X,
} from "lucide-react";

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

/** What the list column shows for a formation's transport. */
const transportSummary = (f: FleetRow) => {
  const rides = [
    ...new Set(
      [f.leaderTransportCode, ...f.units.map((u) => u.transportCode)].filter(
        (c): c is string => !!c
      )
    ),
  ];
  if (!rides.length) return "—";
  return rides.length === 1 ? rides[0]! : `${rides.length} angkutan`;
};

/** Each unit's ride, by code — the leader's first, then every member's. */
const transportsOf = (f: FleetRow): Record<string, string> => ({
  [f.leaderCode]: f.leaderTransportCode ?? "",
  ...Object.fromEntries(f.units.map((u) => [u.code, u.transportCode ?? ""])),
});

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

  /* The two pinned entries. Neither is a fleet — no leader, no members,
     nothing to disband — so both are fetched from the same derived list and
     told apart by `fleetSupport`.

     They mean opposite things and were one row until 2026-09-04, which read as
     a lie once support units started being crewed: the entry says "not
     allocated" and 59 of its 239 units were. */
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
  const MEMBER_POOL = React.useMemo(() => Object.keys(UNIT_TYPE), [UNIT_TYPE]);
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
   * The vehicle each unit rides, by unit code — the leader's included.
   *
   * Per unit, not per formation (owner, 2026-09-04). One select for the whole
   * fleet was the old shape and it cannot say what the yard's own file says:
   * two units of one formation legitimately ride different vehicles. The
   * "samakan semua" button covers the ordinary case where they do not.
   */
  const [fBus, setFBus] = React.useState<Record<string, string>>({});
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
  /* Adding to support is its own small dialog rather than a mode of the
     viewer: it asks for a work area and a ride, which the viewer has nothing
     to do with. */
  const [supOpen, setSupOpen] = React.useState(false);
  const [supQ, setSupQ] = React.useState("");
  const [supSel, setSupSel] = React.useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [supArea, setSupArea] = React.useState("");
  const [supBus, setSupBus] = React.useState("");
  const [supErr, setSupErr] = React.useState(false);

  const [nfOpen, setNfOpen] = React.useState(false);
  const [nfKind, setNfKind] = React.useState<"support" | "none">("none");
  const [nfQ, setNfQ] = React.useState("");

  /* The no-fleet entry follows the formations, so every write that changes a
     formation changes it too. Invalidating both together is what keeps the
     pinned row honest after a fleet is created, edited or disbanded. */
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: fleetsKey }),
      queryClient.invalidateQueries({ queryKey: noFleetKey }),
    ]);

  /**
   * Put units into the support entry, or move the ones already in it.
   *
   * The import is the usual way this list is written, and it rewrites the whole
   * yard once a day. This is the other half of that: a dozer moved to a new
   * panel at ten in the morning, without waiting for tomorrow's file.
   */
  const saveSupport = useMutation({
    mutationFn: async (input: {
      unitIds: string[];
      workArea: string;
      transportUnitId: string | null;
    }) => {
      const result = await api.v1.fleets.support.post(input);
      if (result.error) throw result.error;
      return result.data;
    },
    onSuccess: async (data) => {
      await invalidate();
      setSupOpen(false);
      pushToast("success", t.flSupport, `${data.changed} ${t.flSupToastAdd}`);
    },
    onError: (error) =>
      pushToast("error", t.flSupport, errorMessage(error, t.loginErr)),
  });

  const releaseSupport = useMutation({
    mutationFn: async (unitIds: string[]) => {
      const result = await api.v1.fleets.support.release.post({ unitIds });
      if (result.error) throw result.error;
      return result.data;
    },
    onSuccess: async (data) => {
      await invalidate();
      setSupSel(new Set());
      pushToast("success", t.flSupport, `${data.changed} ${t.flSupToastOut}`);
    },
    onError: (error) =>
      pushToast("error", t.flSupport, errorMessage(error, t.loginErr)),
  });

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
  /* unit milik fleet lain disembunyikan */
  const usedElsewhere = new Set(
    fleets
      .filter((f) => f.id !== editId)
      .flatMap((f) => f.units.map((u) => u.code))
  );
  /* Every unit may lead since 2026-09-04, so this list is the whole register —
     minus anything another formation already holds, as leader *or* as hauler.
     Offering those was a trap the moment excavators stopped being the only
     candidates: the API refuses them by name, after the dialog is filled in. */
  const leaderOpts = Object.keys(UNIT_TYPE)
    .filter(
      (code) =>
        !usedElsewhere.has(code) &&
        !fleets.some((f) => f.leaderCode === code && f.id !== editId)
    )
    .sort();
  const unitOpts = MEMBER_POOL.filter((c) => !usedElsewhere.has(c)).sort();
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
  /** Crewed without a formation: dozers, water trucks, spare diggers. */
  const supportUnits = React.useMemo(
    () => noFleet.filter((u) => u.fleetSupport),
    [noFleet]
  );
  /** In no formation and crewed by nobody — most of the register. */
  const idleUnits = React.useMemo(
    () => noFleet.filter((u) => !u.fleetSupport),
    [noFleet]
  );
  const nfSource = nfKind === "support" ? supportUnits : idleUnits;
  const nfFiltered = React.useMemo(() => {
    const needle = nfQ.trim().toUpperCase();
    return needle
      ? nfSource.filter((u) => u.code.toUpperCase().includes(needle))
      : nfSource;
  }, [nfSource, nfQ]);
  const unitTypeOf = React.useMemo(
    () => new Map(units.map((u) => [u.code, unitTypeLabel(u)])),
    [units]
  );

  /** Units the support entry can still take: unattached, and not already in it. */
  const supCandidates = React.useMemo(() => {
    const needle = supQ.trim().toUpperCase();
    return idleUnits.filter(
      (u) => !needle || u.code.toUpperCase().includes(needle)
    );
  }, [idleUnits, supQ]);

  function openSupportAdd() {
    setSupSel(new Set());
    setSupQ("");
    setSupArea("");
    setSupBus("");
    setSupErr(false);
    setSupOpen(true);
  }

  function submitSupport(e: React.FormEvent) {
    e.preventDefault();
    const workArea = supArea.trim();
    setSupErr(!workArea);
    if (!workArea || !supSel.size) return;
    saveSupport.mutate({
      unitIds: [...supSel],
      workArea,
      transportUnitId: supBus ? (unitIdByCode.get(supBus) ?? null) : null,
    });
  }

  /** The ordinary case: one vehicle for the whole formation, in one click. */
  function applyBusToAll(code: string) {
    setFBus(
      Object.fromEntries(
        [fLeader, ...fUnits].filter(Boolean).map((c) => [c, code])
      )
    );
  }

  function openNoFleet(kind: "support" | "none") {
    setNfKind(kind);
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
    setFBus({});
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
    setFBus(transportsOf(f));
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

    /* One entry per unit on the form, so a formation whose units ride
       different vehicles keeps saying so. A code the catalogue no longer has
       resolves to null rather than to a broken reference. */
    const transports = Object.fromEntries(
      [digger, ...fUnits].map((code) => [
        unitIdByCode.get(code)!,
        fBus[code] ? (unitIdByCode.get(fBus[code]!) ?? null) : null,
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
            {/* Two pinned entries above the formations, neither of them a
                fleet: they have no record, so there is nothing to delete and
                nothing to create. They were one row until 2026-09-04, when it
                stopped being true — the row said "not allocated" and 59 of its
                239 units were being crewed.

                Hidden while the list is being searched: the search is for a
                formation, and a fixed row that ignored it would read as a
                result that does not match. */}
            {!listNeedle
              ? (
                  [
                    {
                      kind: "support" as const,
                      name: t.flSupport,
                      sub: t.flSupportSub,
                      badge: t.flSupportFixed,
                      variant: "info" as const,
                      units: supportUnits,
                    },
                    {
                      kind: "none" as const,
                      name: t.flNoFleet,
                      sub: t.flNoFleetSub,
                      badge: t.flNoFleetFixed,
                      variant: "neutral" as const,
                      units: idleUnits,
                    },
                  ] as const
                ).map((entry) => (
                  <TableRow key={entry.kind}>
                    {/* Empty rather than absent: there is no record here to
                        delete, and the columns still have to line up. */}
                    {canW ? <TableCell /> : null}
                    <TableCell>
                      <NameCell name={entry.name} sub={entry.sub} />
                    </TableCell>
                    <TableCell className="text-(--text-tertiary)">—</TableCell>
                    <TableCell className="text-(--text-tertiary) max-xl:hidden">
                      —
                    </TableCell>
                    <TableCell>
                      {/* A count and a sample, not the whole list: between them
                          these are most of the register, and several hundred
                          badges would bury the formations underneath. The
                          dialog has the full list. */}
                      {entry.units.length ? (
                        <div className="flex max-w-[320px] flex-wrap items-center gap-1">
                          {entry.units.slice(0, 3).map((u) => (
                            <Badge key={u.id} variant="info">
                              {u.code}
                            </Badge>
                          ))}
                          {entry.units.length > 3 ? (
                            <span className="text-xs text-(--text-tertiary)">
                              +{entry.units.length - 3} {t.flSumB.toLowerCase()}
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
                      <Badge variant={entry.variant}>{entry.badge}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {/* Viewing is never gated — there is nothing to write
                            on the no-fleet entry, and support is the one that
                            has an editable flag behind it. */}
                        <IconButton
                          aria-label={entry.name}
                          onClick={() => openNoFleet(entry.kind)}
                        >
                          <Eye />
                        </IconButton>
                        {canW && entry.kind === "support" ? (
                          <IconButton
                            aria-label={t.flSupAddT}
                            onClick={openSupportAdd}
                          >
                            <Plus />
                          </IconButton>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              : null}
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
        /* Wider than the two viewers beside it: the transport list is a row
           per unit — code, type and a vehicle select — and at 560px it needed
           sideways scrolling to reach the select. */
        className="w-[min(760px,100%)]"
        labelledBy="fl-t"
      >
        <DialogIcon variant="info">
          <Truck />
        </DialogIcon>
        <DialogTitle id="fl-t">
          {editId ? `${t.flEditT} ${fLeader}` : t.flAdd}
        </DialogTitle>
        <DialogBody>{t.flDlgB}</DialogBody>
        {/* The dialog caps its own height and expects one child to be the
            scrolling area; a plain <form> was neither, so a tall formation
            simply overflowed off the screen with no way to reach the rest.
            The fields scroll and the actions stay put. */}
        <form
          onSubmit={submit}
          noValidate
          className="flex min-h-0 flex-1 flex-col"
        >
          <FormGrid className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
            <Field
              label={t.flLeader}
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
            <Field
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
              label={`${t.flUnits} — ${fUnits.length}/${FLEET_MAX_UNITS}`}
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
            <Field className="col-span-full" label={t.flBus}>
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-(--text-tertiary)">
                    {t.flBusPerUnit}
                  </span>
                  {/* The ordinary case, in one click: most formations ride one
                      vehicle, and setting it once per unit would be the price
                      of supporting the case where they do not. */}
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-8 px-3 text-xs"
                    disabled={!fLeader}
                    onClick={() => applyBusToAll(fBus[fLeader] ?? "")}
                  >
                    <Copy />
                    {t.flBusSameAll}
                  </Button>
                </div>
                {/* No scroll of its own: it is at most fourteen rows, and a
                    second scrollbar inside a dialog that already scrolls is
                    the one you catch by accident. */}
                <div className="rounded-control border border-(--divider) bg-(--fill-subtle) p-1.5">
                  {[fLeader, ...fUnits].filter(Boolean).map((code) => (
                    <div
                      key={code}
                      className="flex items-center gap-3 px-2 py-1.5"
                    >
                      <span className="w-[120px] shrink-0 font-mono text-sm font-semibold">
                        {code}
                      </span>
                      {code === fLeader ? (
                        <Badge variant="info">{t.flLeaderTag}</Badge>
                      ) : null}
                      <span className="min-w-0 flex-1 truncate text-xs text-(--text-tertiary)">
                        {UNIT_TYPE[code] ?? "—"}
                      </span>
                      <Select
                        aria-label={`${t.flBus} — ${code}`}
                        wrapperClassName="w-[220px] shrink-0"
                        className="h-9"
                        value={fBus[code] ?? ""}
                        onChange={(e) =>
                          setFBus({ ...fBus, [code]: e.target.value })
                        }
                      >
                        <option value="">
                          {BUS_OPTS.length
                            ? "— tanpa angkutan —"
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
                    </div>
                  ))}
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
        <DialogTitle id="nf-t">
          {nfKind === "support" ? t.flSupport : t.flNoFleet}
        </DialogTitle>
        <DialogBody>
          {nfKind === "support" ? t.flSupportDlgB : t.flNoFleetDlgB}
        </DialogBody>
        {/* Read-only: membership is a consequence of the formations, so there
            is nothing here to submit. The search is worth keeping — the list
            is the size of the yard minus its fleets. */}
        <div className="mt-4 flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex items-center gap-2">
            <SearchInput
              className="flex-1"
              placeholder={t.flUnitSearchPh}
              aria-label={t.flUnitSearchPh}
              value={nfQ}
              onChange={(e) => setNfQ(e.target.value)}
            />
            {/* Only on support: no-fleet membership is derived, so there would
                be nothing for a button here to write. */}
            {canW && nfKind === "support" && supportUnits.length ? (
              <Button
                variant="destructive"
                className="h-9"
                disabled={releaseSupport.isPending}
                onClick={() =>
                  releaseSupport.mutate(supportUnits.map((u) => u.id))
                }
              >
                {t.flSupOutAll}
              </Button>
            ) : null}
          </div>
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
                  {/* A support unit is crewed, so where it works and what
                      brings its crew are the two things a reader is here for.
                      A unit in no operation has neither, and shows neither. */}
                  {u.workArea ? (
                    <span className="ml-auto text-xs text-(--text-secondary)">
                      {u.workArea}
                    </span>
                  ) : null}
                  {u.transportCode ? (
                    <Badge variant="neutral">{u.transportCode}</Badge>
                  ) : null}
                  {canW && nfKind === "support" ? (
                    <IconButton
                      aria-label={`${t.flSupOut} — ${u.code}`}
                      disabled={releaseSupport.isPending}
                      onClick={() => releaseSupport.mutate([u.id])}
                    >
                      <X />
                    </IconButton>
                  ) : null}
                </div>
              ))
            ) : (
              <p className="px-2 py-1.5 text-xs text-(--text-tertiary)">
                {nfSource.length ? t.noResTitle : t.flNoFleetEmpty}
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

      {/* Dialog tambah unit support — lokasi dan angkutan, tanpa formasi */}
      <Dialog
        open={supOpen}
        onClose={() => setSupOpen(false)}
        className="w-[min(560px,100%)]"
        labelledBy="sup-t"
      >
        <form onSubmit={submitSupport} className="flex min-h-0 flex-1 flex-col">
          <DialogIcon variant="info">
            <Truck />
          </DialogIcon>
          <DialogTitle id="sup-t">{t.flSupAddT}</DialogTitle>
          <DialogBody>{t.flSupAddB}</DialogBody>

          <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
            <Field
              label={t.flLoc}
              htmlFor="sup-loc"
              required
              error={supErr}
              errorMessage={t.flErrLoc}
            >
              <Input
                id="sup-loc"
                value={supArea}
                onChange={(e) => setSupArea(e.target.value)}
                placeholder={t.flLocPh}
                maxLength={120}
                autoComplete="off"
              />
            </Field>

            <Field label={t.flBus} htmlFor="sup-bus">
              <Select
                id="sup-bus"
                value={supBus}
                onChange={(e) => setSupBus(e.target.value)}
              >
                <option value="">
                  {BUS_OPTS.length
                    ? "— tanpa angkutan —"
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

            <Field label={`${t.flSupPick} (${supSel.size} ${t.flSupSelected})`}>
              <div className="flex flex-col gap-2">
                <SearchInput
                  placeholder={t.flUnitSearchPh}
                  aria-label={t.flUnitSearchPh}
                  value={supQ}
                  onChange={(e) => setSupQ(e.target.value)}
                />
                <div className="max-h-56 overflow-y-auto rounded-control border border-(--divider) bg-(--fill-subtle) p-1.5">
                  {supCandidates.length ? (
                    supCandidates.map((u) => (
                      <label
                        key={u.id}
                        className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-(--fill-hover)"
                      >
                        <Checkbox
                          checked={supSel.has(u.id)}
                          onChange={() =>
                            setSupSel((prev) => {
                              const next = new Set(prev);
                              if (next.has(u.id)) next.delete(u.id);
                              else next.add(u.id);
                              return next;
                            })
                          }
                        />
                        <span className="font-mono text-sm font-semibold">
                          {u.code}
                        </span>
                        <span className="text-xs text-(--text-tertiary)">
                          {unitTypeOf.get(u.code) ?? "—"}
                        </span>
                      </label>
                    ))
                  ) : (
                    <p className="px-2 py-1.5 text-xs text-(--text-tertiary)">
                      {idleUnits.length ? t.noResTitle : t.flSupNone}
                    </p>
                  )}
                </div>
              </div>
            </Field>
          </div>

          <DialogActions>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setSupOpen(false)}
            >
              {t.btnCancel}
            </Button>
            <Button
              type="submit"
              disabled={!supSel.size || saveSupport.isPending}
            >
              {t.flSupAddT}
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
