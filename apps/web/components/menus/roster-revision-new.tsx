"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarDays, Plus, Send, Trash2 } from "lucide-react";

import { ROSTER_CODES, type RosterCode } from "@universe/contracts";

import { api, errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { rosterCodeOption } from "@/lib/roster-data";
import { AsyncSelect, type AsyncOption } from "@/components/ui/async-select";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton, Spinner } from "@/components/ui/button";
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
  kode: RosterCode;
  jin: string;
  jout: string;
  alasan: string;
};

/** "05:45–17:30", or blank when the entry carries no hours. */
const jamOf = (e: Entry) => (e.jin ? `${e.jin}–${e.jout}` : "");

/**
 * The API answers a bad entry with `issues[].field` of the form
 * `entries.3.date`, so a submission of twelve does not come back as one
 * sentence about "an entry". Turned into index → message here, and rendered on
 * the row it belongs to rather than in a toast that names none of them.
 */
function issuesByEntry(error: unknown): Map<number, string> {
  const byEntry = new Map<number, string>();
  const value = (error as { value?: unknown })?.value;
  const issues = (value as { issues?: unknown })?.issues;
  if (!Array.isArray(issues)) return byEntry;
  for (const raw of issues) {
    const issue = raw as { field?: unknown; message?: unknown };
    if (typeof issue.field !== "string" || typeof issue.message !== "string")
      continue;
    const match = /^entries\.(\d+)\./.exec(issue.field);
    if (!match) continue;
    byEntry.set(Number(match[1]), issue.message);
  }
  return byEntry;
}

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
 * A new revision submission.
 *
 * Entries are collected in local state exactly as the static port did — a
 * submission is authored, not saved a row at a time — but "Kirim" now posts all
 * of them as **one** submission, which is what the API models (design D10) and
 * what the approval screen then decides entry by entry.
 *
 * The employee an entry names is a claim, not a decision: the API validates it
 * against the caller's scope and refuses one it cannot reach, whatever this
 * form offered.
 */
export function RosterRevisionNew() {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const router = useRouter();
  const listHref = `/roster-revision`;

  const queryClient = useQueryClient();

  const [emp, setEmp] = React.useState<EmpRow | null>(null);
  const [tgl, setTgl] = React.useState(yesterdayISO);
  const [kode, setKode] = React.useState<RosterCode | "">("");
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
  const [entryErrors, setEntryErrors] = React.useState<Map<number, string>>(
    new Map()
  );
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
    if (!emp || !kode) return;
    setEntries((prev) => [
      ...prev,
      {
        name: emp.name,
        nik: emp.nik,
        tgl,
        kode,
        jin: withJam ? jin : "",
        jout: withJam ? jout : "",
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

  const sendM = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.v1["roster-revisions"].post({
        entries: entries.map((e) => ({
          nik: e.nik,
          date: e.tgl,
          toCode: e.kode,
          startTime: e.jin || null,
          endTime: e.jout || null,
          reason: e.alasan,
        })),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["roster-revisions"] });
      await queryClient.invalidateQueries({
        queryKey: ["roster-approval-queue"],
      });
      pushToast("success", `${entries.length} ${t.toastRevT}`, t.toastRevD);
      setEntries([]);
      setEntryErrors(new Map());
      setReviewOpen(false);
      router.push(listHref);
    },
    onError: (error) => {
      // Kept open, with the failures on their own rows: closing the dialog on
      // a refusal would lose twelve entries somebody just typed.
      const byEntry = issuesByEntry(error);
      setEntryErrors(byEntry);
      if (!byEntry.size) setReviewOpen(false);
      pushToast("error", t.rvSendErrT, errorMessage(error, t.rvLoadErr));
    },
  });

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
                onChange={(e) => setKode(e.target.value as RosterCode | "")}
              >
                <option value="">{t.phCode}</option>
                {/* Straight from the shared vocabulary, so a code the API
                    accepts and a code this offers cannot drift apart. */}
                {ROSTER_CODES.map((c) => (
                  <option key={c} value={c}>
                    {rosterCodeOption(t, c)}
                  </option>
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
                  {pg.rows.map((e) => {
                    const index = entries.indexOf(e);
                    const issue = entryErrors.get(index);
                    return (
                      <TableRow key={index}>
                        <TableCell>
                          <NameCell name={e.name} sub={e.nik} />
                        </TableCell>
                        <TableCell className="font-mono">{e.tgl}</TableCell>
                        <TableCell>
                          <Badge variant="info">{e.kode}</Badge>{" "}
                          {jamOf(e) ? (
                            <span className="font-mono text-xs text-(--text-secondary)">
                              {jamOf(e)}
                            </span>
                          ) : null}
                          <div className="mt-0.5 text-xs text-(--text-tertiary)">
                            {e.alasan}
                          </div>
                          {issue ? (
                            <div className="mt-1 text-xs text-(--color-danger-text)">
                              {issue}
                            </div>
                          ) : null}
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
                    );
                  })}
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
              className="flex flex-col gap-1 border-b border-(--divider) py-1.5 text-sm"
            >
              <div className="flex justify-between gap-3">
                <span>
                  {e.name} · <span className="font-mono">{e.tgl}</span>
                </span>
                <Badge variant="info">{e.kode}</Badge>
              </div>
              {entryErrors.get(i) ? (
                <span className="text-xs text-(--color-danger-text)">
                  {entryErrors.get(i)}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
        <DialogActions>
          <Button variant="ghost" onClick={() => setReviewOpen(false)}>
            {t.revCancel}
          </Button>
          <Button onClick={() => sendM.mutate()} disabled={sendM.isPending}>
            {sendM.isPending ? <Spinner /> : null}
            {t.send}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
