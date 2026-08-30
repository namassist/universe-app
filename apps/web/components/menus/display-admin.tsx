"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Copy,
  Eye,
  Link2,
  Monitor,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";

import {
  COLOR_VAL,
  DEVICE_ID_PREFIX,
  DISPLAY_ROUTE_OF_KIND,
  RUNTEXT_COLORS,
  type DeviceKind,
  type RunTextColor,
} from "@universe/contracts";

import type { AccessMode } from "@/lib/access";
import { api, errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { openDisplay } from "@/lib/open-display";
import {
  devicesKey,
  devicesQueryOptions,
  type DeviceRow,
} from "@/lib/queries/devices";
import { fleetsQueryOptions } from "@/lib/queries/fleets";
import { deviceRunTextsKey } from "@/lib/queries/run-texts";
import { cn } from "@/lib/utils";
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
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { useToast } from "@/components/ui/toast";

/** A device's own ticker line. Same shape the API exchanges. */
type CustomRunText = { text: string; color: RunTextColor };

/** Matches the column default; a new screen starts where the old ones sit. */
const DEFAULT_ROTATE = 30;
/** The API's own bounds — kept here so the field refuses before the request. */
const MIN_ROTATE = 3;
const MAX_ROTATE = 600;

/**
 * The display device registry, backed by `/v1/devices`.
 *
 * A TV is a principal now, not a row of sample data: it pairs once through a
 * single-use link, reports a heartbeat, and can be revoked individually.
 * `online` and last-seen therefore come from the API rather than from the
 * hardcoded strings this screen used to show — an anonymous URL could not have
 * produced either.
 *
 * Display *content* (running texts, fleet picks, rotation) is deliberately not
 * persisted by this change; those controls stay local, as the rest of the
 * static port is, until the display-configuration change lands.
 */
/** Example names, per kind — a hint at the naming convention in use. */
const NAME_PLACEHOLDER: Record<DeviceKind, string> = {
  att: "TV Gate Utara",
  fleet: "Fleet EX-22",
  fitwork: "TV Fit To Work",
  fingerprint: "TV Monitoring Fingerprint",
};

export function DisplayAdminMenu({
  mode,
  kind,
}: {
  mode: AccessMode;
  kind: DeviceKind;
}) {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const canW = mode === "manage";

  const devicesQ = useQuery(devicesQueryOptions(kind));
  const devices = React.useMemo(() => devicesQ.data ?? [], [devicesQ.data]);

  /* The real formations, from Fleet Settings. Only a fleet wall has anything
     to point at, so the other three kinds never ask. */
  const fleetsQ = useQuery({
    ...fleetsQueryOptions(),
    enabled: kind === "fleet",
  });
  const fleets = React.useMemo(() => fleetsQ.data ?? [], [fleetsQ.data]);
  const fleetById = React.useMemo(
    () => new Map(fleets.map((f) => [f.id, f])),
    [fleets]
  );

  const [q, setQ] = React.useState("");
  const [statusF, setStatusF] = React.useState("");

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: devicesKey(kind) });

  const filtered = devices.filter((d) => {
    const needle = q.trim().toLowerCase();
    const okQ =
      !needle ||
      d.name.toLowerCase().includes(needle) ||
      d.id.toLowerCase().includes(needle);
    const okS = statusF === "" || d.active === (statusF === "1");
    return okQ && okS;
  });
  const pg = usePagination(filtered, "5");

  /* ------------------------------------------------------------ mutations */

  const save = useMutation({
    mutationFn: async (input: {
      existingId: string | null;
      id: string;
      name: string;
      active: boolean;
      rotateSeconds: number;
      fleetIds: string[];
      runTexts: CustomRunText[];
    }) => {
      const result = input.existingId
        ? await api.v1.devices({ id: input.existingId }).patch({
            name: input.name,
            active: input.active,
            rotateSeconds: input.rotateSeconds,
            fleetIds: input.fleetIds,
          })
        : await api.v1.devices.post({
            id: input.id,
            name: input.name,
            kind,
            active: input.active,
            rotateSeconds: input.rotateSeconds,
            fleetIds: input.fleetIds,
          });
      if (result.error) throw result.error;

      // Written after the device exists, because a new device has no id to
      // attach them to until it does. PUT replaces the whole list, so an empty
      // one is how a screen is handed back to the master texts.
      const deviceId = result.data?.id ?? input.id;
      const { error } = await api.v1
        .devices({ id: deviceId })
        ["run-texts"].put({ runTexts: input.runTexts });
      if (error) throw error;
      return result.data;
    },
    onSuccess: async (_d, input) => {
      await invalidate();
      await queryClient.invalidateQueries({
        queryKey: deviceRunTextsKey(input.existingId ?? input.id),
      });
      pushToast(
        "success",
        input.existingId ? t.dspToastEdit : t.dspToastAdd,
        input.name
      );
      setDlgOpen(false);
    },
    onError: (error) =>
      pushToast("error", t.dspAdd, errorMessage(error, t.loginErr)),
  });

  const setActive = useMutation({
    mutationFn: async (input: { device: DeviceRow; active: boolean }) => {
      const { error } = await api.v1
        .devices({ id: input.device.id })
        .patch({ active: input.active });
      if (error) throw error;
    },
    onSuccess: async (_d, input) => {
      await invalidate();
      pushToast(
        input.active ? "success" : "info",
        input.active ? t.stAktif : t.stNonaktif,
        input.device.name
      );
    },
    onError: (error) =>
      pushToast("error", t.thStatus, errorMessage(error, t.loginErr)),
  });

  const del = useMutation({
    mutationFn: async (device: DeviceRow) => {
      const { error } = await api.v1.devices({ id: device.id }).delete();
      if (error) throw error;
    },
    onSuccess: async (_d, device) => {
      await invalidate();
      pushToast("success", t.dspToastDel, device.name);
      setDelTarget(null);
    },
    onError: (error) =>
      pushToast("error", t.dspDelT, errorMessage(error, t.loginErr)),
  });

  const pair = useMutation({
    mutationFn: async (device: DeviceRow) => {
      const { data, error } = await api.v1
        .devices({ id: device.id })
        .pairing.post();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => setPairing(data?.url ?? null),
    onError: (error) =>
      pushToast("error", t.dspPairT, errorMessage(error, t.loginErr)),
  });

  /* --------------------------------------------------------------- dialog */

  const [dlgOpen, setDlgOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<DeviceRow | null>(null);
  const [fId, setFId] = React.useState("");
  const [fName, setFName] = React.useState("");
  const [fSel, setFSel] = React.useState<string[]>([]);
  const [fRotate, setFRotate] = React.useState(DEFAULT_ROTATE);
  const [fleetQ, setFleetQ] = React.useState("");

  const visibleFleets = React.useMemo(() => {
    const needle = fleetQ.trim().toLowerCase();
    if (!needle) return fleets;
    return fleets.filter(
      (f) =>
        f.diggerCode.toLowerCase().includes(needle) ||
        f.workAreaName.toLowerCase().includes(needle)
    );
  }, [fleets, fleetQ]);

  /**
   * How long one turn of the whole rotation takes, spelled out.
   *
   * Worth showing because the two numbers multiply: eight formations at 30 s
   * is four minutes before a screen comes back to the first one, and nobody
   * works that out from a seconds field alone.
   */
  const cycleFleets = kind === "fleet" && fSel.length ? fSel.length : 1;
  const rotateHelp =
    kind === "fleet" && cycleFleets > 1
      ? `${t.dspRotateHelp} ${t.dspCycleA} ${cycleFleets * fRotate} ${t.dspCycleB} ${cycleFleets} fleet.`
      : t.dspRotateHelp;
  const [fRuntexts, setFRuntexts] = React.useState<CustomRunText[]>([]);
  /* Empty is not "unset": a device with no texts of its own follows the master
     list, which is the behaviour this field is really editing (design D8). */
  const [fActive, setFActive] = React.useState(true);
  const [nameErr, setNameErr] = React.useState(false);
  const [delTarget, setDelTarget] = React.useState<DeviceRow | null>(null);
  const [pairing, setPairing] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  const addRT = () =>
    setFRuntexts((p) => [...p, { text: "", color: RUNTEXT_COLORS[0]! }]);
  const updateRT = (i: number, patch: Partial<CustomRunText>) =>
    setFRuntexts((p) => p.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const removeRT = (i: number) =>
    setFRuntexts((p) => p.filter((_, j) => j !== i));

  const nextId = () => {
    const prefix = DEVICE_ID_PREFIX[kind];
    const taken = devices
      .map((d) => Number(d.id.replace(prefix, "")))
      .filter((n) => Number.isFinite(n));
    const next = (taken.length ? Math.max(...taken) : 0) + 1;
    return `${prefix}${String(next).padStart(2, "0")}`;
  };

  function openAdd() {
    setEditing(null);
    setFId(nextId());
    setFName("");
    setFSel([]);
    setFRotate(DEFAULT_ROTATE);
    setFleetQ("");
    setFRuntexts([]);
    setFActive(true);
    setNameErr(false);
    setDlgOpen(true);
  }
  async function openEdit(d: DeviceRow) {
    setEditing(d);
    setFId(d.id);
    setFName(d.name);
    // Loaded from the row rather than reset: a screen's picks are stored now,
    // so reopening it has to show what it is actually displaying.
    setFSel(d.fleetIds);
    setFRotate(d.rotateSeconds);
    setFleetQ("");
    setFRuntexts([]);
    setFActive(d.active);
    setNameErr(false);
    setDlgOpen(true);
    // Fetched on open rather than for every row in the list: a registry of
    // twenty TVs would otherwise make twenty requests to render a table that
    // shows none of it.
    const { data } = await api.v1.devices({ id: d.id })["run-texts"].get();
    if (data) setFRuntexts(data);
  }
  function toggleFleet(id: string) {
    setFSel((prev) => {
      const next = prev.includes(id)
        ? prev.filter((x) => x !== id)
        : [...prev, id];
      if (next.length) setNameErr(false);
      return next;
    });
  }
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!fName.trim() && !(kind === "fleet" && fSel.length)) {
      setNameErr(true);
      return;
    }
    const first = fSel.length ? fleetById.get(fSel[0]!)?.diggerCode : undefined;
    const name =
      kind === "fleet" && first && !fName.trim()
        ? fSel.length === 1
          ? `Fleet ${first}`
          : `Fleet ${first} +${fSel.length - 1}`
        : fName.trim();
    save.mutate({
      existingId: editing?.id ?? null,
      id: fId.trim(),
      name,
      active: fActive,
      rotateSeconds: fRotate,
      // Fleet walls only. Sending [] on the other kinds is how a screen stays
      // unscoped, and the API refuses a non-empty pick on them anyway.
      fleetIds: kind === "fleet" ? fSel : [],
      runTexts: fRuntexts.filter((r) => r.text.trim().length > 0),
    });
  }

  async function copyPairing() {
    if (!pairing) return;
    await navigator.clipboard.writeText(pairing);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  const title = {
    att: t.navDispAtt,
    fleet: t.navDispFleet,
    fitwork: t.navDispFitwork,
    fingerprint: t.navDispFinger,
  }[kind];
  const sub = {
    att: t.dspSubAtt,
    fleet: t.dspSubFleet,
    fitwork: t.dspSubFitwork,
    fingerprint: t.dspSubFinger,
  }[kind];
  const addButton = canW ? (
    <Button onClick={openAdd}>
      <Plus />
      {t.dspAdd}
    </Button>
  ) : null;

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={title} sub={sub}>
        {addButton}
      </PageTitle>

      <Panel>
        <Toolbar>
          <ToolbarTitle>{t.dspListTitle}</ToolbarTitle>
          <ToolbarGroup>
            <SearchInput
              className="w-60"
              placeholder={t.dspSearchPh}
              aria-label={t.dspSearchPh}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <Select
              wrapperClassName="w-[160px]"
              aria-label={t.thStatus}
              value={statusF}
              onChange={(e) => setStatusF(e.target.value)}
            >
              <option value="">{t.allStatus}</option>
              <option value="1">{t.stAktif}</option>
              <option value="0">{t.stNonaktif}</option>
            </Select>
          </ToolbarGroup>
        </Toolbar>

        {devicesQ.isPending ? (
          <TableSkeleton rows={5} />
        ) : (
          <Table>
            <TableHeader>
              <tr>
                <TableHead>{t.dspName}</TableHead>
                <TableHead>{t.dspConn}</TableHead>
                <TableHead>{t.thStatus}</TableHead>
                <TableHead className="w-44">{t.thAct}</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {pg.rows.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    <NameCell name={d.name} sub={d.id} />
                  </TableCell>
                  {/* Derived from last_seen_at, not asserted by the row. */}
                  <TableCell>
                    <Badge variant={d.online ? "success" : "danger"} dot>
                      {d.online ? "Online" : "Offline"}
                    </Badge>
                    <div className="mt-1 font-mono text-xs text-(--text-tertiary)">
                      {d.lastSeenLabel}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={d.active ? "success" : "danger"} dot>
                      {d.active ? t.stAktif : t.stNonaktif}
                    </Badge>
                    {canW ? (
                      <button
                        type="button"
                        onClick={() =>
                          setActive.mutate({ device: d, active: !d.active })
                        }
                        className="mt-1 block cursor-pointer text-xs text-(--text-tertiary) hover:text-(--text-primary)"
                      >
                        {d.active ? t.umOff : t.umOn}
                      </button>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <IconButton
                        aria-label={t.dspPreview}
                        onClick={() =>
                          /* layar kiosk sungguhan (dark-only) — tab baru, fullscreen */
                          /* The id, not just the name: a preview answers as
                             that screen — its fleets and its rotation — so
                             what is seen here is what will hang in the pit. */
                          openDisplay(
                            `${DISPLAY_ROUTE_OF_KIND[kind]}?name=${encodeURIComponent(d.name)}&device=${encodeURIComponent(d.id)}`
                          )
                        }
                      >
                        <Eye />
                      </IconButton>
                      {canW ? (
                        <>
                          <IconButton
                            aria-label={t.dspPairT}
                            onClick={() => pair.mutate(d)}
                          >
                            <Link2 />
                          </IconButton>
                          <IconButton
                            aria-label={t.udbEditT}
                            onClick={() => void openEdit(d)}
                          >
                            <Pencil />
                          </IconButton>
                          <IconButton
                            danger
                            aria-label={t.empDel}
                            onClick={() => setDelTarget(d)}
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
        )}

        <PanelFoot>
          <FootSum>
            {t.attSumA} <b>{pg.range}</b> {t.attSumB} <b>{pg.total}</b>{" "}
            {t.dspSumB}
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

      {/* dialog tambah/edit perangkat */}
      <Dialog
        open={dlgOpen}
        onClose={() => setDlgOpen(false)}
        className="w-[min(560px,100%)]"
        labelledBy="dsp-t"
      >
        <DialogIcon variant="info">
          <Monitor />
        </DialogIcon>
        <DialogTitle id="dsp-t">
          {editing ? `${t.dspEditT} — ${editing.name}` : t.dspAdd}
        </DialogTitle>
        <DialogBody>{t.dspDlgB}</DialogBody>
        <form onSubmit={submit} noValidate>
          <div className="mt-4 flex flex-col gap-5">
            {/* The id is the tag physically written on the TV, so it is typed
                rather than generated behind the operator's back. */}
            <Field
              label={t.dspId}
              htmlFor="dsp-id"
              required
              helper={t.dspIdHelp}
            >
              <Input
                id="dsp-id"
                placeholder="DSP-A01"
                disabled={!!editing}
                value={fId}
                onChange={(e) => setFId(e.target.value)}
              />
            </Field>

            {kind === "fleet" ? (
              <Field
                label={
                  <span className="flex w-full items-center gap-2">
                    <span>Fleet</span>
                    <Badge variant={fSel.length ? "info" : "neutral"}>
                      {fSel.length} {t.dspPicked}
                    </Badge>
                    {/* Empty is not "nothing": a screen nobody has scoped is
                        a control-room screen showing every formation, and the
                        label has to say so or an empty list reads as broken. */}
                    {fSel.length === 0 ? (
                      <span className="text-xs font-normal text-(--text-tertiary)">
                        {t.dspFleetAllNote}
                      </span>
                    ) : null}
                    {fSel.length ? (
                      <button
                        type="button"
                        onClick={() => setFSel([])}
                        className="ml-auto cursor-pointer text-xs font-normal text-(--text-tertiary) hover:text-(--text-primary)"
                      >
                        {t.dspClearSel}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setFSel(fleets.map((f) => f.id))}
                        className="ml-auto cursor-pointer text-xs font-normal text-(--text-tertiary) hover:text-(--text-primary)"
                        disabled={!fleets.length}
                      >
                        {t.dspSelAll}
                      </button>
                    )}
                  </span>
                }
                helper={t.dspFleetHelp}
              >
                <div className="flex flex-col gap-2">
                  {fleets.length > 6 ? (
                    <SearchInput
                      className="w-full"
                      value={fleetQ}
                      onChange={(e) => setFleetQ(e.target.value)}
                      onClear={() => setFleetQ("")}
                      placeholder={t.dspFleetSearch}
                    />
                  ) : null}
                  <div className="grid max-h-52 grid-cols-2 gap-1 overflow-y-auto rounded-control border border-(--border-input) bg-(--fill-input) p-2">
                    {fleetsQ.isPending ? (
                      <p className="col-span-2 px-1.5 py-2 text-xs text-(--text-tertiary) italic">
                        {t.dspFleetLoading}
                      </p>
                    ) : visibleFleets.length === 0 ? (
                      /* Two different emptinesses: no fleets exist at all, or
                         the search matched none. Telling them apart is what
                         stops someone rebuilding a formation that is there. */
                      <p className="col-span-2 px-1.5 py-2 text-xs text-(--text-tertiary) italic">
                        {fleets.length ? t.dspFleetNoMatch : t.dspErrFleet}
                      </p>
                    ) : (
                      visibleFleets.map((f) => (
                        <ToggleRow
                          key={f.id}
                          className={cn(
                            "rounded-md px-1.5 py-1.5",
                            fSel.includes(f.id) && "bg-[rgba(0,212,255,.08)]"
                          )}
                        >
                          <Checkbox
                            checked={fSel.includes(f.id)}
                            onChange={() => toggleFleet(f.id)}
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {`Fleet ${f.diggerCode}`}
                            <span className="text-(--text-tertiary)">
                              {` — ${f.workAreaName} · ${f.units.length + 1} unit`}
                            </span>
                          </span>
                        </ToggleRow>
                      ))
                    )}
                  </div>
                </div>
              </Field>
            ) : null}

            <Field label={t.dspRotate} htmlFor="dsp-rotate" helper={rotateHelp}>
              <Input
                id="dsp-rotate"
                type="number"
                min={MIN_ROTATE}
                max={MAX_ROTATE}
                className="w-[130px] flex-none"
                value={String(fRotate)}
                onChange={(e) => setFRotate(Number(e.target.value))}
              />
            </Field>

            <Field
              label={t.dspName}
              htmlFor="dsp-name"
              required={kind !== "fleet"}
              error={nameErr}
              errorMessage={t.mdErrName}
            >
              <Input
                id="dsp-name"
                placeholder={NAME_PLACEHOLDER[kind]}
                value={fName}
                onChange={(e) => {
                  setFName(e.target.value);
                  if (e.target.value.trim()) setNameErr(false);
                }}
              />
            </Field>

            <Field label={t.dspRuntext} helper={t.dspRtNote}>
              <div className="flex flex-col gap-2">
                {fRuntexts.length === 0 ? (
                  <p className="rounded-control border border-dashed border-(--border-input) px-3 py-2.5 text-xs text-(--text-tertiary) italic">
                    {t.dspRtEmpty}
                  </p>
                ) : (
                  fRuntexts.map((r, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        aria-label={`${t.dspRuntext} ${i + 1}`}
                        placeholder={t.dspRuntext}
                        value={r.text}
                        onChange={(e) => updateRT(i, { text: e.target.value })}
                      />
                      <Select
                        wrapperClassName="w-[130px] flex-none"
                        aria-label={`Warna ${i + 1}`}
                        value={r.color}
                        onChange={(e) =>
                          updateRT(i, { color: e.target.value as RunTextColor })
                        }
                      >
                        {RUNTEXT_COLORS.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </Select>
                      <span
                        className="inline-block size-3 flex-none rounded-full"
                        style={{ background: COLOR_VAL[r.color] }}
                      />
                      <IconButton
                        danger
                        aria-label={t.empDel}
                        onClick={() => removeRT(i)}
                      >
                        <Trash2 />
                      </IconButton>
                    </div>
                  ))
                )}
                <Button
                  type="button"
                  variant="ghost"
                  className="self-start"
                  onClick={addRT}
                >
                  <Plus />
                  {t.dspRtAdd}
                </Button>
              </div>
            </Field>

            <ToggleRow htmlFor="dsp-active">
              <Checkbox
                id="dsp-active"
                checked={fActive}
                onChange={(e) => setFActive(e.target.checked)}
              />
              {t.stAktif}
            </ToggleRow>
          </div>
          <DialogActions>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDlgOpen(false)}
            >
              {t.btnCancel}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {editing ? t.udbSaveEdit : t.dspSaveAdd}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* dialog link pairing — sekali pakai, 15 menit */}
      <Dialog
        open={pairing !== null}
        onClose={() => setPairing(null)}
        className="w-[min(560px,100%)]"
        labelledBy="dsppair-t"
      >
        <DialogIcon variant="info">
          <Link2 />
        </DialogIcon>
        <DialogTitle id="dsppair-t">{t.dspPairT}</DialogTitle>
        <DialogBody>{t.dspPairB}</DialogBody>
        <div className="mt-4 flex items-center gap-2">
          <Input readOnly value={pairing ?? ""} className="font-mono text-xs" />
          <Button variant="secondary" onClick={copyPairing}>
            {copied ? <Check /> : <Copy />}
            {copied ? t.dspPairCopied : t.dspPairCopy}
          </Button>
        </div>
        <DialogActions>
          <Button variant="ghost" onClick={() => setPairing(null)}>
            {t.btnCancel}
          </Button>
        </DialogActions>
      </Dialog>

      {/* dialog hapus perangkat */}
      <Dialog
        open={delTarget !== null}
        onClose={() => setDelTarget(null)}
        labelledBy="dspd-t"
      >
        <DialogIcon variant="danger">
          <Trash2 />
        </DialogIcon>
        <DialogTitle id="dspd-t">{`${t.dspDelT} "${delTarget?.name ?? ""}"?`}</DialogTitle>
        <DialogBody>{t.dspDelB}</DialogBody>
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
