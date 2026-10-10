"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Printer, Search, Trash2 } from "lucide-react";

import { MENU_LABELS } from "@universe/contracts";

import type { AccessMode } from "@/lib/access";
import { api, errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
  printersKey,
  printersQueryOptions,
  type PrinterRow,
} from "@/lib/queries/printers";
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

/** The same shape the API enforces, checked here only to catch a typo before
    a round trip. A duplicate address is still the server's call. */
const IPV4 =
  /^((25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)$/;

/**
 * The ticket printer registry.
 *
 * A printer is paired with a booth on the fingerprint machine screen, not
 * here: a booth has a printer, and that is where somebody looks for it.
 */
export function PrintersMenu({ mode }: { mode: AccessMode }) {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const canW = mode === "manage";

  const listQ = useQuery(printersQueryOptions());
  const entries = React.useMemo(() => listQ.data ?? [], [listQ.data]);

  const [q, setQ] = React.useState("");
  const [stF, setStF] = React.useState("");
  const [dlgOpen, setDlgOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<PrinterRow | null>(null);
  const [fName, setFName] = React.useState("");
  const [fIp, setFIp] = React.useState("");
  const [fPort, setFPort] = React.useState("9100");
  const [fActive, setFActive] = React.useState(true);
  const [errName, setErrName] = React.useState(false);
  const [errIp, setErrIp] = React.useState(false);
  const [delTarget, setDelTarget] = React.useState<PrinterRow | null>(null);
  /* A test slip by hand (owner, 2026-10-10): to one printer from its row, or
     to every active printer after a confirmation — paper is not free. */
  const [testAllAsk, setTestAllAsk] = React.useState(false);
  const [testResult, setTestResult] = React.useState<TestResult | null>(null);

  const testPrint = useMutation({
    mutationFn: async (ids: string[] | null) => {
      const result = await api.v1.printers.test.post(ids ? { ids } : {});
      if (result.error) throw result.error;
      return result.data;
    },
    onSuccess: (r) => {
      setTestAllAsk(false);
      /* All sent is a toast; any failure stays on screen with its reason,
         because that is the list somebody walks the booths with. */
      if (r.failed.length) setTestResult(r);
      else
        pushToast(
          "success",
          "Tes cetak",
          `${r.sent}/${r.total} slip tes terkirim — cek kertas keluar di printernya`
        );
    },
    onError: (error) =>
      pushToast("error", "Tes cetak", errorMessage(error, t.loginErr)),
  });
  const activeCount = entries.filter((e) => e.active).length;

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: printersKey });

  const save = useMutation({
    mutationFn: async (input: {
      id: string | null;
      name: string;
      ip: string;
      port: number;
      active: boolean;
    }) => {
      const body = {
        name: input.name,
        ip: input.ip,
        port: input.port,
        active: input.active,
      };
      const result = input.id
        ? await api.v1.printers({ id: input.id }).patch(body)
        : await api.v1.printers.post(body);
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
    mutationFn: async (row: PrinterRow) => {
      const { error } = await api.v1.printers({ id: row.id }).delete();
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

  const rows = entries.filter((r) => {
    if (stF === "1" && !r.active) return false;
    if (stF === "0" && r.active) return false;
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return (
      r.name.toLowerCase().includes(needle) ||
      r.ip.toLowerCase().includes(needle)
    );
  });
  const pg = usePagination(rows, "25");

  function openAdd() {
    setEditing(null);
    setFName("");
    setFIp("");
    setFPort("9100");
    setFActive(true);
    setErrName(false);
    setErrIp(false);
    setDlgOpen(true);
  }
  function openEdit(r: PrinterRow) {
    setEditing(r);
    setFName(r.name);
    setFIp(r.ip);
    setFPort(String(r.port));
    setFActive(r.active);
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
      /* Blank reads as the usual port rather than as an error. */
      port: Number(fPort) || 9100,
      active: fActive,
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        title={MENU_LABELS["mesin-printer"]}
        sub="Daftar printer tiket — dipasangkan ke mesin fingerprint di menu Mesin Fingerprint"
      >
        {canW ? (
          <div className="flex gap-2">
            <Button
              variant="secondary"
              disabled={testPrint.isPending || activeCount === 0}
              onClick={() => setTestAllAsk(true)}
            >
              <Printer />
              Tes cetak semua
            </Button>
            <Button onClick={openAdd}>
              <Plus />
              {t.mdAdd}
            </Button>
          </div>
        ) : null}
      </PageTitle>

      <Panel>
        <Toolbar>
          <ToolbarTitle>{MENU_LABELS["mesin-printer"]}</ToolbarTitle>
          <ToolbarGroup>
            <SearchInput
              className="w-[240px]"
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
          </ToolbarGroup>
        </Toolbar>

        {rows.length ? (
          <Table>
            <TableHeader>
              <tr>
                <TableHead>{t.mfName}</TableHead>
                <TableHead>{t.mfIp}</TableHead>
                <TableHead>Port</TableHead>
                <TableHead>{t.thStatus}</TableHead>
                <TableHead style={{ width: 110 }}>{t.thAct}</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {pg.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <span className="font-semibold">{r.name}</span>
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {r.ip}
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {r.port}
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
                          {/* An inactive printer is never sent to, so it is
                              never offered a test either. */}
                          <IconButton
                            aria-label="Tes cetak"
                            title="Tes cetak"
                            disabled={!r.active || testPrint.isPending}
                            onClick={() => testPrint.mutate([r.id])}
                          >
                            <Printer />
                          </IconButton>
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
            icon={<Search className="text-(--color-primary-bright)" />}
            title={t.noResTitle}
            body="Belum ada printer terdaftar."
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
        labelledBy="pr-t"
      >
        <DialogIcon variant="info">
          <Printer />
        </DialogIcon>
        <DialogTitle id="pr-t">{editing ? t.mdEditT : t.mdAdd}</DialogTitle>
        <DialogBody>
          Printer tiket muster. Pasangkan ke mesin fingerprint setelah
          didaftarkan.
        </DialogBody>
        <form onSubmit={submit} noValidate>
          <Field
            className="mt-4"
            label={t.mfName}
            htmlFor="pr-name"
            required
            error={errName}
            errorMessage={t.mdErrName}
          >
            <Input
              id="pr-name"
              value={fName}
              onChange={(e) => setFName(e.target.value)}
            />
          </Field>
          <Field
            className="mt-4"
            label={t.mfIp}
            htmlFor="pr-ip"
            required
            error={errIp}
            errorMessage={t.mfErrIp}
          >
            <Input
              id="pr-ip"
              className="font-mono"
              inputMode="decimal"
              placeholder="192.168.179.87"
              value={fIp}
              onChange={(e) => setFIp(e.target.value)}
            />
          </Field>
          <Field className="mt-4" label="Port" htmlFor="pr-port">
            <Input
              id="pr-port"
              inputMode="numeric"
              value={fPort}
              onChange={(e) => setFPort(e.target.value)}
            />
          </Field>
          <p className="mt-2 text-xs text-(--text-tertiary)">
            Biarkan 9100 kecuali printer ini memang disetel lain.
          </p>
          <ToggleRow className="mt-4" htmlFor="pr-active">
            <Checkbox
              id="pr-active"
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
        labelledBy="prd-t"
      >
        <DialogIcon variant="danger">
          <Trash2 />
        </DialogIcon>
        <DialogTitle id="prd-t">
          {t.mdDelT} &ldquo;{delTarget?.name}&rdquo;?
        </DialogTitle>
        <DialogBody>
          Mesin yang dipasangkan ke printer ini tetap ada, pasangannya saja yang
          lepas.
        </DialogBody>
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
        open={testAllAsk}
        onClose={() => setTestAllAsk(false)}
        labelledBy="prt-t"
      >
        <DialogIcon variant="info">
          <Printer />
        </DialogIcon>
        <DialogTitle id="prt-t">
          Kirim slip tes ke {activeCount} printer aktif?
        </DialogTitle>
        <DialogBody>
          Tiap printer mencetak satu slip &ldquo;TES PRINTER — BUKAN
          TIKET&rdquo;. Slip yang keluar berarti printer siap; yang gagal
          terkirim ditampilkan beserta alasannya.
        </DialogBody>
        <DialogActions>
          <Button variant="ghost" onClick={() => setTestAllAsk(false)}>
            {t.btnCancel}
          </Button>
          <Button
            disabled={testPrint.isPending}
            onClick={() => testPrint.mutate(null)}
          >
            <Printer />
            {testPrint.isPending ? "Mengirim…" : "Kirim slip tes"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={!!testResult}
        onClose={() => setTestResult(null)}
        labelledBy="prr-t"
      >
        <DialogIcon variant="danger">
          <Printer />
        </DialogIcon>
        <DialogTitle id="prr-t">
          {testResult
            ? `${testResult.sent}/${testResult.total} slip tes terkirim`
            : ""}
        </DialogTitle>
        <DialogBody>Printer berikut tidak bisa dikirimi slip:</DialogBody>
        <ul className="mt-3 flex flex-col gap-1.5 text-sm">
          {testResult?.failed.map((f) => (
            <li key={f.id} className="flex justify-between gap-3">
              <span className="font-semibold">{f.name}</span>
              <span className="font-mono text-(--text-secondary) tabular-nums">
                {f.ip} · {f.reason}
              </span>
            </li>
          ))}
        </ul>
        <DialogActions>
          <Button onClick={() => setTestResult(null)}>Tutup</Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}

/** What a test by hand answers: how many went out, and each that did not. */
type TestResult = {
  total: number;
  sent: number;
  failed: { id: string; name: string; ip: string; reason: string }[];
};
