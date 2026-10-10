"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Fingerprint,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Search,
  Trash2,
} from "lucide-react";

import { MENU_LABELS } from "@universe/contracts";

import type { AccessMode } from "@/lib/access";
import { api, errorMessage } from "@/lib/api";
import {
  boothHealthView,
  matchesReadiness,
  READINESS_FILTERS,
  type ReadinessFilter,
} from "@/lib/booth-health";
import { useI18n } from "@/lib/i18n";
import {
  fingerprintMachinesKey,
  fingerprintMachinesQueryOptions,
  type FingerprintMachineRow,
} from "@/lib/queries/fingerprint-machines";
import { printersQueryOptions } from "@/lib/queries/printers";
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

import { NetcheckDialog } from "./fingerprint-netcheck-dialog";

/**
 * The same IPv4 shape the API enforces, checked here only so a typo is caught
 * before a round trip. The server's answer is still the one that decides — a
 * duplicate address, in particular, is a conflict only the database can see.
 */
const IPV4 =
  /^((25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)$/;

/**
 * The fingerprint machine registry.
 *
 * These rows are what the monitoring TV shows a card for, so a machine missing
 * here is a machine nobody is watching. Deactivating is the right move for one
 * that is merely unplugged: it keeps its identity and drops off the wall.
 */
export function FingerprintMachinesMenu({ mode }: { mode: AccessMode }) {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const canW = mode === "manage";

  const listQ = useQuery(fingerprintMachinesQueryOptions());
  const printersQ = useQuery(printersQueryOptions());
  const entries = React.useMemo(() => listQ.data ?? [], [listQ.data]);

  const [q, setQ] = React.useState("");
  const [stF, setStF] = React.useState("");
  const [rdF, setRdF] = React.useState<ReadinessFilter>("");
  const [dlgOpen, setDlgOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<FingerprintMachineRow | null>(
    null
  );
  const [fName, setFName] = React.useState("");
  const [fIp, setFIp] = React.useState("");
  const [fActive, setFActive] = React.useState(true);
  const [fComKey, setFComKey] = React.useState("0");
  const [fPort, setFPort] = React.useState("80");
  const [fPrinterId, setFPrinterId] = React.useState("");
  const [errName, setErrName] = React.useState(false);
  const [errIp, setErrIp] = React.useState(false);
  const [delTarget, setDelTarget] =
    React.useState<FingerprintMachineRow | null>(null);
  const [sel, setSel] = React.useState<ReadonlySet<string>>(() => new Set());
  const [bulkDelOpen, setBulkDelOpen] = React.useState(false);
  const [pingOpen, setPingOpen] = React.useState(false);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: fingerprintMachinesKey });

  const save = useMutation({
    mutationFn: async (input: {
      id: string | null;
      name: string;
      ip: string;
      active: boolean;
      comKey: number;
      port: number;
      printerId: string | null;
    }) => {
      const body = {
        name: input.name,
        ip: input.ip,
        active: input.active,
        comKey: input.comKey,
        port: input.port,
        printerId: input.printerId,
      };
      const result = input.id
        ? await api.v1["fingerprint-machines"]({ id: input.id }).patch(body)
        : await api.v1["fingerprint-machines"].post(body);
      if (result.error) throw result.error;
      return result.data;
    },
    onSuccess: async (_d, input) => {
      await invalidate();
      pushToast(
        "success",
        input.id ? t.mdEditToastT : t.mdAddToastT,
        `${input.name} — ${input.ip}`
      );
      setDlgOpen(false);
    },
    onError: (error) =>
      pushToast("error", t.mdAdd, errorMessage(error, t.loginErr)),
  });

  const del = useMutation({
    mutationFn: async (row: FingerprintMachineRow) => {
      const { error } = await api.v1["fingerprint-machines"]({
        id: row.id,
      }).delete();
      if (error) throw error;
    },
    onSuccess: async (_d, row) => {
      await invalidate();
      pushToast("success", t.mdDelToastT, row.name);
      setDelTarget(null);
    },
    onError: (error) =>
      pushToast("error", t.mdDelT, errorMessage(error, t.loginErr)),
  });

  /* The whole site is ~60 machines, well under the endpoints' 200, so a
     selection always goes in one request. */
  const bulkActive = useMutation({
    mutationFn: async (input: { ids: string[]; active: boolean }) => {
      const result =
        await api.v1["fingerprint-machines"]["bulk-active"].post(input);
      if (result.error) throw result.error;
      return result.data;
    },
    onSuccess: async (data, input) => {
      await invalidate();
      pushToast(
        "success",
        t.mfBulkActiveToastT,
        `${data.updated} ${t.mfSumB} — ${input.active ? t.stAktif : t.stNonaktif}`
      );
      setSel(new Set());
    },
    onError: (error) =>
      pushToast("error", t.mfBulkActiveToastT, errorMessage(error, t.loginErr)),
  });

  const bulkDel = useMutation({
    mutationFn: async (ids: string[]) => {
      const result = await api.v1["fingerprint-machines"]["bulk-delete"].post({
        ids,
      });
      if (result.error) throw result.error;
      return result.data;
    },
    onSuccess: async (data) => {
      await invalidate();
      pushToast("success", t.mdDelToastT, `${data.deleted} ${t.mfSumB}`);
      setBulkDelOpen(false);
      setSel(new Set());
    },
    onError: (error) =>
      pushToast("error", t.mdBulkDel, errorMessage(error, t.loginErr)),
  });

  const rows = entries.filter((r) => {
    if (stF === "1" && !r.active) return false;
    if (stF === "0" && r.active) return false;
    if (!matchesReadiness(r, rdF)) return false;
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return (
      r.name.toLowerCase().includes(needle) ||
      r.ip.toLowerCase().includes(needle)
    );
  });
  const pg = usePagination(rows, "25");

  // Resolved against the filtered list, so a machine ticked before a filter
  // hid it never reaches a request.
  const selectedRows = rows.filter((r) => sel.has(r.id));

  // The header box governs the page, not the whole filtered set — as in the
  // unit registry. Selections still accumulate across pages.
  const pageIds = pg.rows.map((r) => r.id);
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

  // The ticked machines, or else every active one — an inactive machine is
  // retired, and checking it is only worth doing when somebody asks for it.
  const pingTargets = selectedRows.length
    ? selectedRows
    : entries.filter((r) => r.active);

  function openAdd() {
    setEditing(null);
    setFName("");
    setFIp("");
    setFActive(true);
    setFComKey("0");
    setFPort("80");
    setFPrinterId("");
    setErrName(false);
    setErrIp(false);
    setDlgOpen(true);
  }
  function openEdit(r: FingerprintMachineRow) {
    setEditing(r);
    setFName(r.name);
    setFIp(r.ip);
    setFActive(r.active);
    setFComKey(String(r.comKey));
    setFPort(String(r.port));
    setFPrinterId(r.printerId ?? "");
    setErrName(false);
    setErrIp(false);
    setDlgOpen(true);
  }
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const name = fName.trim();
    const ip = fIp.trim();
    const badName = !name;
    const badIp = !IPV4.test(ip);
    setErrName(badName);
    setErrIp(badIp);
    if (badName || badIp) return;
    save.mutate({
      id: editing?.id ?? null,
      name,
      ip,
      active: fActive,
      /* Blank reads as the factory value rather than as an error: somebody
         clearing the box means "the usual one", not "no key at all". */
      comKey: Number(fComKey) || 0,
      port: Number(fPort) || 80,
      printerId: fPrinterId || null,
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={MENU_LABELS["mesin-fingerprint"]} sub={t.mfSub}>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setPingOpen(true)}>
            <Activity />
            {t.mfPing}
            {selectedRows.length ? ` (${selectedRows.length})` : null}
          </Button>
          {canW ? (
            <Button onClick={openAdd}>
              <Plus />
              {t.mdAdd}
            </Button>
          ) : null}
        </div>
      </PageTitle>

      <Panel>
        <Toolbar>
          <ToolbarTitle>{MENU_LABELS["mesin-fingerprint"]}</ToolbarTitle>
          <ToolbarGroup>
            <SearchInput
              className="w-60"
              placeholder={t.mdSearchPh}
              aria-label={t.mdSearchPh}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <Select
              wrapperClassName="w-[160px]"
              value={stF}
              onChange={(e) => setStF(e.target.value)}
              aria-label={t.allStatus}
            >
              <option value="">{t.allStatus}</option>
              <option value="1">{t.stAktif}</option>
              <option value="0">{t.stNonaktif}</option>
            </Select>
            {/* The same verdict as the Kesiapan column and the wall, so a
                filtered list never disagrees with either. */}
            <Select
              wrapperClassName="w-[200px]"
              value={rdF}
              onChange={(e) => setRdF(e.target.value as ReadinessFilter)}
              aria-label="Kesiapan"
            >
              <option value="">Semua kesiapan</option>
              {READINESS_FILTERS.slice(0, 2).map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
              <optgroup label="Rincian masalah">
                {READINESS_FILTERS.slice(2).map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </optgroup>
            </Select>
            {/* Appended so the controls before them keep their place when a
                selection appears and disappears. */}
            {canW && selectedRows.length ? (
              <>
                <Button
                  variant="secondary"
                  disabled={bulkActive.isPending}
                  onClick={() =>
                    bulkActive.mutate({
                      ids: selectedRows.map((r) => r.id),
                      active: true,
                    })
                  }
                >
                  <Power />
                  {t.mfBulkOn}
                </Button>
                <Button
                  variant="secondary"
                  disabled={bulkActive.isPending}
                  onClick={() =>
                    bulkActive.mutate({
                      ids: selectedRows.map((r) => r.id),
                      active: false,
                    })
                  }
                >
                  <PowerOff />
                  {t.mfBulkOff}
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => setBulkDelOpen(true)}
                >
                  <Trash2 />
                  {t.mdBulkDel} ({selectedRows.length})
                </Button>
              </>
            ) : null}
          </ToolbarGroup>
        </Toolbar>

        {rows.length ? (
          <Table>
            <TableHeader>
              <tr>
                {/* For viewers too: a selection also scopes the Ping check. */}
                <TableHead style={{ width: 44 }}>
                  <Checkbox
                    ref={(el) => {
                      // Indeterminate is a DOM property, not an attribute.
                      if (el) el.indeterminate = somePageSel && !allPageSel;
                    }}
                    checked={allPageSel}
                    onChange={togglePage}
                    aria-label={t.mdSelAll}
                  />
                </TableHead>
                <TableHead>{t.mfName}</TableHead>
                <TableHead>{t.mfIp}</TableHead>
                <TableHead>{t.mfPrinterIp}</TableHead>
                <TableHead>{t.mfReach}</TableHead>
                <TableHead>{t.thStatus}</TableHead>
                <TableHead style={{ width: 110 }}>{t.thAct}</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {pg.rows.map((r) => (
                <TableRow key={r.id} selected={sel.has(r.id)}>
                  <TableCell>
                    <Checkbox
                      checked={sel.has(r.id)}
                      onChange={() => toggleRow(r.id)}
                      aria-label={`${t.mdSelRow} — ${r.name}`}
                    />
                  </TableCell>
                  <TableCell>
                    <span className="font-semibold">{r.name}</span>
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {r.ip}
                  </TableCell>
                  <TableCell>
                    {/* The booth's printer, by address — what a technician
                        pings and what `netcheck.sh` lists beside the machine —
                        and the prober's reading of it, so a dead printer is
                        seen here before a slip fails to come out. */}
                    {r.printer ? (
                      <span className="flex items-center gap-2">
                        <span className="font-mono tabular-nums">
                          {r.printer.ip}
                        </span>
                        {!r.printer.active ? (
                          <Badge variant="warning" dot>
                            {t.stNonaktif}
                          </Badge>
                        ) : r.printer.checkedAt === null ? null : (
                          <Badge
                            variant={r.printer.online ? "success" : "danger"}
                            dot
                          >
                            {r.printer.online ? t.mfOnline : t.mfOffline}
                          </Badge>
                        )}
                      </span>
                    ) : (
                      <span className="text-(--text-tertiary)">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {/* Whether a tap here becomes a slip — the machine and its
                        printer together, the same verdict the wall shows. An
                        inactive machine is not probed, so it has none. */}
                    {!r.active ? (
                      <span className="text-(--text-tertiary)">—</span>
                    ) : r.checkedAt === null ? (
                      <span className="text-(--text-tertiary)">
                        {t.mfNotChecked}
                      </span>
                    ) : (
                      <Badge variant={boothHealthView(r.health).variant} dot>
                        {boothHealthView(r.health).label}
                      </Badge>
                    )}
                  </TableCell>
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
            icon={<Search className="text-primary-bright" />}
            title={t.noResTitle}
            body={t.mfEmptyB}
          />
        )}

        <PanelFoot>
          <FootSum>
            {t.attSumA} <b>{pg.range}</b> {t.attSumB} <b>{pg.total}</b>{" "}
            {t.mdSumB}
          </FootSum>
          <Pagination
            page={pg.page}
            pageCount={pg.pageCount}
            onPage={pg.setPage}
            per={pg.per}
            perOptions={["10", "25", "50"]}
            onPer={pg.setPer}
          />
        </PanelFoot>
      </Panel>

      <Dialog
        open={dlgOpen}
        onClose={() => setDlgOpen(false)}
        labelledBy="mf-t"
      >
        <DialogIcon variant="info">
          <Fingerprint />
        </DialogIcon>
        <DialogTitle id="mf-t">{editing ? t.mdEditT : t.mdAdd}</DialogTitle>
        <DialogBody>{t.mfDlgB}</DialogBody>
        <form onSubmit={submit} noValidate>
          <Field
            className="mt-4"
            label={t.mfName}
            htmlFor="mf-name"
            required
            error={errName}
            errorMessage={t.mdErrName}
          >
            <Input
              id="mf-name"
              value={fName}
              onChange={(e) => setFName(e.target.value)}
            />
          </Field>
          <Field
            className="mt-4"
            label={t.mfIp}
            htmlFor="mf-ip"
            required
            error={errIp}
            errorMessage={t.mfErrIp}
          >
            <Input
              id="mf-ip"
              className="font-mono"
              inputMode="decimal"
              placeholder="192.168.179.229"
              value={fIp}
              onChange={(e) => setFIp(e.target.value)}
            />
          </Field>
          <ToggleRow className="mt-4" htmlFor="mf-active">
            <Checkbox
              id="mf-active"
              checked={fActive}
              onChange={(e) => setFActive(e.target.checked)}
            />
            {t.stAktif}
          </ToggleRow>
          <p className="mt-2 text-xs text-(--text-tertiary)">
            {t.mfNonaktifNote}
          </p>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <Field label="Com Key" htmlFor="mf-comkey">
              <Input
                id="mf-comkey"
                inputMode="numeric"
                value={fComKey}
                onChange={(e) => setFComKey(e.target.value)}
              />
            </Field>
            <Field label="Port" htmlFor="mf-port">
              <Input
                id="mf-port"
                inputMode="numeric"
                value={fPort}
                onChange={(e) => setFPort(e.target.value)}
              />
            </Field>
          </div>
          <p className="mt-2 text-xs text-(--text-tertiary)">
            Biarkan 0 dan 80 kecuali mesin ini memang disetel lain.
          </p>

          <Field className="mt-4" label="Printer tiket" htmlFor="mf-printer">
            <Select
              id="mf-printer"
              value={fPrinterId}
              onChange={(e) => setFPrinterId(e.target.value)}
            >
              <option value="">Tanpa printer</option>
              {(printersQ.data ?? [])
                /* A printer already claimed by another booth is left out: one
                   printer belongs to one machine, and offering a taken one
                   would only produce a 409 after the click. */
                .filter(
                  (pr) =>
                    (pr.active || pr.id === fPrinterId) &&
                    !entries.some(
                      (m) => m.printerId === pr.id && m.id !== editing?.id
                    )
                )
                .map((pr) => (
                  <option key={pr.id} value={pr.id}>
                    {pr.name} — {pr.ip}
                  </option>
                ))}
            </Select>
          </Field>
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
        labelledBy="mfd-t"
      >
        <DialogIcon variant="danger">
          <Trash2 />
        </DialogIcon>
        <DialogTitle id="mfd-t">
          {t.mdDelT} &ldquo;{delTarget?.name}&rdquo;?
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

      <Dialog
        open={bulkDelOpen}
        onClose={() => setBulkDelOpen(false)}
        labelledBy="mfb-t"
      >
        <DialogIcon variant="danger">
          <Trash2 />
        </DialogIcon>
        <DialogTitle id="mfb-t">{t.mfBulkDelT}</DialogTitle>
        <DialogBody>
          <b>{selectedRows.length}</b> {t.mfSumB} — {t.mfBulkDelB}
        </DialogBody>
        <DialogActions>
          <Button variant="ghost" onClick={() => setBulkDelOpen(false)}>
            {t.btnCancel}
          </Button>
          <Button
            variant="destructive"
            disabled={bulkDel.isPending || !selectedRows.length}
            onClick={() => bulkDel.mutate(selectedRows.map((r) => r.id))}
          >
            {t.mdBulkDel}
          </Button>
        </DialogActions>
      </Dialog>

      {pingOpen ? (
        <NetcheckDialog
          machines={pingTargets}
          scopeLabel={selectedRows.length ? t.mfPingScopeSel : t.mfPingScopeAll}
          onClose={() => setPingOpen(false)}
        />
      ) : null}
    </div>
  );
}
