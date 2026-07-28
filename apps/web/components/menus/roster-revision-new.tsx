"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CalendarDays, Plus, Send, Trash2 } from "lucide-react";

import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { revCodeList } from "@/lib/roster-data";
import { AsyncSelect, type AsyncOption } from "@/components/ui/async-select";
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
import { Input, Textarea } from "@/components/ui/input";
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
  NameCell,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";

type Entry = {
  name: string;
  nik: string;
  tgl: string;
  kode: string;
  jam: string;
  alasan: string;
};

type EmpRow = { nik: string; name: string };

function yesterdayISO() {
  return new Date(Date.now() - 86400000).toISOString().slice(0, 10);
}

/**
 * Employee search, served by the API.
 *
 * This screen's own revision rows are still local state — the roster lands in a
 * later change — but the people it offers are real records, and the search runs
 * server-side because that is where the register lives now. A screen that is
 * not yet persisted still reads its master values from the API rather than from
 * a compiled-in array.
 */
async function loadEmployees(search: string): Promise<AsyncOption<EmpRow>[]> {
  const needle = search.trim();
  const { data } = await api.v1.employees.get({
    query: { status: "aktif", ...(needle ? { q: needle } : {}) },
  });
  return (data ?? []).slice(0, 20).map((e) => ({
    value: e.nik,
    label: `${e.name} — ${e.nik}`,
    row: { nik: e.nik, name: e.name },
  }));
}

/**
 * Form revisi roster baru — static design port. Entri, review, dan hapus
 * bekerja di state lokal; Kirim hanya toast lalu kembali ke daftar.
 */
export function RosterRevisionNew() {
  const { t, lang } = useI18n();
  const { pushToast } = useToast();
  const router = useRouter();
  const listHref = `/roster-revision`;

  const codes = revCodeList(lang);

  const [emp, setEmp] = React.useState<EmpRow | null>(null);
  const [tgl, setTgl] = React.useState(yesterdayISO);
  const [kode, setKode] = React.useState("");
  const [withJam, setWithJam] = React.useState(false);
  const [jin, setJin] = React.useState("05:45");
  const [jout, setJout] = React.useState("17:30");
  const [alasan, setAlasan] = React.useState("");
  const [errs, setErrs] = React.useState<{
    emp?: boolean;
    tgl?: boolean;
    kode?: boolean;
    alasan?: boolean;
  }>({});

  const [entries, setEntries] = React.useState<Entry[]>([]);
  const [reviewOpen, setReviewOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const needle = q.trim().toLowerCase();
  const shown = entries.filter(
    (e) =>
      !needle ||
      e.name.toLowerCase().includes(needle) ||
      e.nik.toLowerCase().includes(needle)
  );
  const pg = usePagination(shown, "5");

  function addEntry() {
    const next = {
      emp: !emp,
      tgl: !tgl,
      kode: !kode,
      alasan: !alasan.trim(),
    };
    setErrs(next);
    if (next.emp || next.tgl || next.kode || next.alasan) return;
    if (!emp) return;
    setEntries((prev) => [
      ...prev,
      {
        name: emp.name,
        nik: emp.nik,
        tgl,
        kode: kode.split(" — ")[0]!,
        jam: withJam ? `${jin}–${jout}` : "",
        alasan: alasan.trim(),
      },
    ]);
    setEmp(null);
    setKode("");
    setAlasan("");
    setWithJam(false);
    setJin("05:45");
    setJout("17:30");
  }

  function sendAll() {
    /* static-only: tanpa penyimpanan — toast lalu kembali */
    pushToast("success", `${entries.length} ${t.toastRevT}`, t.toastRevD);
    setEntries([]);
    setReviewOpen(false);
    router.push(listHref);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={t.revNewTitle} sub={t.revSub}>
        <Button variant="ghost" onClick={() => router.push(listHref)}>
          <ArrowLeft />
          {t.revBack}
        </Button>
      </PageTitle>

      <div className="grid grid-cols-[420px_minmax(0,1fr)] items-start gap-6 max-[1360px]:grid-cols-1">
        <Panel>
          <Toolbar className="mb-4">
            <ToolbarTitle>{t.revFormTitle}</ToolbarTitle>
          </Toolbar>
          <div className="flex flex-col gap-4">
            <Field
              label={t.lblEmp}
              htmlFor="rev-kar"
              required
              error={errs.emp}
              errorMessage={t.errEmp}
            >
              <AsyncSelect
                id="rev-kar"
                value={emp?.nik ?? ""}
                valueLabel={emp ? `${emp.name} — ${emp.nik}` : undefined}
                onChange={(o) =>
                  setEmp(o?.row ? { nik: o.row.nik, name: o.row.name } : null)
                }
                load={loadEmployees}
                placeholder={t.phEmp}
                searchPlaceholder={t.searchEmp}
                emptyText={t.noResTitle}
              />
            </Field>

            <Field
              label={t.lblDate}
              htmlFor="rev-tgl"
              required
              error={errs.tgl}
            >
              <Input
                id="rev-tgl"
                type="date"
                className="font-mono"
                value={tgl}
                onChange={(e) => setTgl(e.target.value)}
              />
            </Field>

            <Field
              label={t.lblCode}
              htmlFor="rev-kode"
              required
              error={errs.kode}
              errorMessage={t.errCode}
              helper={
                <>
                  {t.helpCode1} <Link href={`/roster-data`}>{t.navR1}</Link>.
                </>
              }
            >
              <Select
                id="rev-kode"
                value={kode}
                onChange={(e) => setKode(e.target.value)}
              >
                <option value="">{t.phCode}</option>
                {codes.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>

            <ToggleRow htmlFor="rev-withjam">
              <Checkbox
                id="rev-withjam"
                checked={withJam}
                onChange={(e) => setWithJam(e.target.checked)}
              />
              {t.withJam}
            </ToggleRow>

            {withJam ? (
              <div className="grid grid-cols-2 gap-4">
                <Field label={t.lblIn} htmlFor="rev-jin">
                  <Input
                    id="rev-jin"
                    type="time"
                    className="font-mono"
                    value={jin}
                    onChange={(e) => setJin(e.target.value)}
                  />
                </Field>
                <Field label={t.lblOut} htmlFor="rev-jout">
                  <Input
                    id="rev-jout"
                    type="time"
                    className="font-mono"
                    value={jout}
                    onChange={(e) => setJout(e.target.value)}
                  />
                </Field>
              </div>
            ) : null}

            <Field
              label={t.lblReason}
              htmlFor="rev-alasan"
              required
              error={errs.alasan}
              errorMessage={t.errReason}
              helper={t.helpReason}
            >
              <Textarea
                id="rev-alasan"
                placeholder={t.phReason}
                value={alasan}
                onChange={(e) => setAlasan(e.target.value)}
              />
            </Field>

            <Button
              variant="secondary"
              className="self-start"
              onClick={addEntry}
            >
              <Plus />
              {t.addEntry}
            </Button>
          </div>
        </Panel>

        <Panel>
          <Toolbar className="mb-4">
            <ToolbarTitle>{t.revListTitle}</ToolbarTitle>
            <ToolbarGroup>
              <SearchInput
                className="w-[240px]"
                placeholder={t.searchEmp}
                aria-label={t.searchEmp}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <span className="text-xs text-(--text-tertiary)">
                {entries.length} {t.revCount}
              </span>
            </ToolbarGroup>
          </Toolbar>
          {entries.length === 0 ? (
            <StateBox
              icon={<CalendarDays className="text-(--color-primary-bright)" />}
              title={t.revEmptyT}
              body={t.revEmptyB}
            />
          ) : (
            <div>
              <Table>
                <TableHeader>
                  <tr>
                    <TableHead>{t.thEmp}</TableHead>
                    <TableHead>{t.lblDate}</TableHead>
                    <TableHead>{t.thChange}</TableHead>
                    <TableHead className="w-[60px]">{t.thAct}</TableHead>
                  </tr>
                </TableHeader>
                <TableBody>
                  {pg.rows.map((e) => (
                    <TableRow key={entries.indexOf(e)}>
                      <TableCell>
                        <NameCell name={e.name} sub={e.nik} />
                      </TableCell>
                      <TableCell className="font-mono">{e.tgl}</TableCell>
                      <TableCell>
                        <Badge variant="info">{e.kode}</Badge>{" "}
                        {e.jam ? (
                          <span className="font-mono text-xs text-(--text-secondary)">
                            {e.jam}
                          </span>
                        ) : null}
                        <div className="mt-0.5 text-xs text-(--text-tertiary)">
                          {e.alasan}
                        </div>
                      </TableCell>
                      <TableCell>
                        <IconButton
                          danger
                          aria-label={t.delEntry}
                          onClick={() =>
                            setEntries((prev) => prev.filter((x) => x !== e))
                          }
                        >
                          <Trash2 />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <PanelFoot>
                <FootSum>{t.revFootNote}</FootSum>
                <div className="flex flex-wrap items-center gap-4">
                  <Pagination
                    page={pg.page}
                    pageCount={pg.pageCount}
                    onPage={pg.setPage}
                    per={pg.per}
                    perOptions={["5", "10", "25"]}
                    onPer={pg.setPer}
                  />
                  <Button onClick={() => setReviewOpen(true)}>{t.send}</Button>
                </div>
              </PanelFoot>
            </div>
          )}
        </Panel>
      </div>

      <Dialog
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        labelledBy="rev-t"
      >
        <DialogIcon variant="info">
          <Send />
        </DialogIcon>
        <DialogTitle id="rev-t">
          {t.revDlgT1} {entries.length} {t.revDlgT2}
        </DialogTitle>
        <DialogBody>{t.revDlgBody}</DialogBody>
        <ul className="mt-3 list-none p-0">
          {entries.map((e, i) => (
            <li
              key={i}
              className="flex justify-between gap-3 border-b border-(--divider) py-1.5 text-sm"
            >
              <span>
                {e.name} · <span className="font-mono">{e.tgl}</span>
              </span>
              <Badge variant="info">{e.kode}</Badge>
            </li>
          ))}
        </ul>
        <DialogActions>
          <Button variant="ghost" onClick={() => setReviewOpen(false)}>
            {t.revCancel}
          </Button>
          <Button onClick={sendAll}>{t.send}</Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
