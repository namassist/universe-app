"use client";

import * as React from "react";
import { notFound, useRouter } from "next/navigation";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarClock, Plus, Save, Trash2 } from "lucide-react";

import { ROSTER_CODES, type RosterCode } from "@universe/contracts";

import { api, errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
  rosterCorrectionPeople,
  rosterCorrectionsRoot,
  type RosterCorrectionPerson,
} from "@/lib/queries/roster-corrections";
import { rosterCodeLabel } from "@/lib/roster-data";
import { useRole } from "@/components/providers/role-context";
import { AsyncSelect, type AsyncOption } from "@/components/ui/async-select";
import { Button, IconButton } from "@/components/ui/button";
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

const LIST_HREF = "/roster-correction";

type Entry = {
  nik: string;
  name: string;
  departmentName: string;
  code: RosterCode;
  reason: string;
};

/** The site's calendar day, `YYYY-MM-DD` — the browser is on site time. */
const today = () => new Date().toLocaleDateString("sv-SE");

/**
 * The API names a refused entry by index (`entries.3.code`), so a submission
 * of twelve comes back as twelve rows that can each say what is wrong with
 * them rather than one sentence about "an entry".
 */
function issuesByEntry(error: unknown): Map<number, string> {
  const byEntry = new Map<number, string>();
  const issues = (error as { value?: { issues?: unknown } })?.value?.issues;
  if (!Array.isArray(issues)) return byEntry;
  for (const raw of issues) {
    const issue = raw as { field?: unknown; message?: unknown };
    if (typeof issue.field !== "string" || typeof issue.message !== "string")
      continue;
    const match = /^entries\.(\d+)\./.exec(issue.field);
    if (match) byEntry.set(Number(match[1]), issue.message);
  }
  return byEntry;
}

/**
 * A new correction submission: one date, several people.
 *
 * The morning's call-ins come in together — three operators rostered N who
 * are needed on the day shift — so the date is chosen once and the people are
 * gathered into a list, then saved as one submission. All or nothing: a
 * refused entry is marked on its row and nothing is written until it is
 * fixed or removed.
 */
export function RosterCorrectionNew() {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const { access } = useRole();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [date, setDate] = React.useState(today);
  const [entries, setEntries] = React.useState<Entry[]>([]);
  const [issues, setIssues] = React.useState<Map<number, string>>(new Map());

  const [person, setPerson] = React.useState<RosterCorrectionPerson | null>(
    null
  );
  const [code, setCode] = React.useState<RosterCode>("D");
  /* Kept between entries: a morning's call-ins usually share one reason. */
  const [reason, setReason] = React.useState("");
  const [errs, setErrs] = React.useState<{
    person?: string;
    reason?: boolean;
  }>({});
  const [reviewOpen, setReviewOpen] = React.useState(false);

  /* What each listed day reads now, for the date as it stands — asked again
     when the date changes, so a list built for one day never shows another's
     codes. */
  const currents = useQueries({
    queries: entries.map((e) => ({
      queryKey: ["roster-correction-current", e.nik, date],
      queryFn: () => rosterCorrectionPeople(e.nik, date),
    })),
  });
  const currentOf = (i: number) => {
    const q = currents[i];
    if (!q || q.isPending) return "…";
    return q.data?.find((p) => p.nik === entries[i]?.nik)?.code ?? "kosong";
  };

  const loadPeople = React.useCallback(
    async (search: string): Promise<AsyncOption<RosterCorrectionPerson>[]> => {
      if (!search.trim()) return [];
      const people = await rosterCorrectionPeople(search.trim(), date);
      /* The picker's `sub` is a short tag that never shrinks — the label is
         what truncates — so the long part goes in the label and the tag is
         only the day's code. */
      return people.map((p) => ({
        value: p.nik,
        label: `${p.name} · ${p.nik} · ${p.departmentName}`,
        sub: p.code ?? "—",
        row: p,
      }));
    },
    [date]
  );

  const save = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.v1["roster-corrections"].post({
        date,
        entries: entries.map((e) => ({
          nik: e.nik,
          code: e.code,
          reason: e.reason,
        })),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async (rows) => {
      await queryClient.invalidateQueries({ queryKey: rosterCorrectionsRoot });
      pushToast(
        "success",
        "Roster dikoreksi",
        `${rows.length} koreksi untuk ${date} sudah berlaku`
      );
      router.push(LIST_HREF);
    },
    onError: (error) => {
      setReviewOpen(false);
      const byEntry = issuesByEntry(error);
      setIssues(byEntry);
      pushToast(
        "error",
        "Koreksi belum tersimpan",
        byEntry.size
          ? `${byEntry.size} entri perlu diperbaiki — lihat tandanya di daftar`
          : errorMessage(error, t.loginErr)
      );
    },
  });

  if (access("roster-correction") !== "manage") notFound();

  function addEntry() {
    const text = reason.trim();
    const dupe = person && entries.some((e) => e.nik === person.nik);
    const next = {
      person: !person
        ? "Pilih karyawan"
        : dupe
          ? "Karyawan ini sudah ada di daftar"
          : undefined,
      reason: text.length < 3,
    };
    setErrs(next);
    if (!person || next.person || next.reason) return;
    setEntries((prev) => [
      ...prev,
      {
        nik: person.nik,
        name: person.name,
        departmentName: person.departmentName,
        code,
        reason: text,
      },
    ]);
    setIssues(new Map());
    setPerson(null);
  }

  function removeEntry(index: number) {
    setEntries((prev) => prev.filter((_, i) => i !== index));
    /* The indices after it shift, so the old marks no longer line up. */
    setIssues(new Map());
  }

  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        title="Tambah Koreksi Roster"
        sub="Satu tanggal, beberapa karyawan sekaligus — berlaku langsung setelah disimpan"
      >
        <Button variant="ghost" onClick={() => router.push(LIST_HREF)}>
          <ArrowLeft />
          Kembali
        </Button>
      </PageTitle>

      {/* Above the list panel: each glass panel is its own stacking context
          (backdrop-filter), so without this the employee dropdown opens
          underneath the panel that follows it. */}
      <Panel className="relative z-10">
        <Toolbar className="mb-4">
          <ToolbarTitle>Tanggal &amp; Entri</ToolbarTitle>
        </Toolbar>
        <div className="grid gap-4 md:grid-cols-[180px_1fr_200px_1fr_auto] md:items-start">
          <Field label="Tanggal" htmlFor="rcn-date" required>
            <Input
              id="rcn-date"
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value || today());
                setIssues(new Map());
              }}
            />
          </Field>
          <Field
            label="Karyawan"
            htmlFor="rcn-person"
            required
            error={!!errs.person}
            errorMessage={errs.person}
          >
            <AsyncSelect<RosterCorrectionPerson>
              id="rcn-person"
              ariaLabel="Karyawan"
              value={person?.nik ?? ""}
              valueLabel={
                person
                  ? `${person.name} (${person.nik}) — roster ${person.code ?? "kosong"}`
                  : ""
              }
              placeholder="Cari NIK atau nama"
              searchPlaceholder="Ketik NIK atau nama"
              emptyText="Tidak ada karyawan yang cocok"
              load={loadPeople}
              onChange={(option) => setPerson(option?.row ?? null)}
            />
          </Field>
          <Field label="Ubah menjadi" htmlFor="rcn-code">
            <Select
              id="rcn-code"
              value={code}
              onChange={(e) => setCode(e.target.value as RosterCode)}
            >
              {ROSTER_CODES.map((c) => (
                <option key={c} value={c}>
                  {c} — {rosterCodeLabel(t, c)}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Alasan"
            htmlFor="rcn-reason"
            required
            error={!!errs.reason}
            errorMessage="Tulis alasannya, minimal 3 huruf"
          >
            <Input
              id="rcn-reason"
              placeholder="Contoh: dipanggil masuk pagi, darurat"
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addEntry();
                }
              }}
            />
          </Field>
          <Button className="md:mt-[26px]" onClick={addEntry}>
            <Plus />
            Tambah
          </Button>
        </div>
      </Panel>

      <Panel>
        <Toolbar>
          <ToolbarTitle>Daftar Koreksi — {date}</ToolbarTitle>
        </Toolbar>
        {entries.length ? (
          <Table>
            <TableHeader>
              <tr>
                <TableHead style={{ width: 48 }}>No</TableHead>
                <TableHead>NIK</TableHead>
                <TableHead>Nama</TableHead>
                <TableHead>Departemen</TableHead>
                <TableHead>Roster</TableHead>
                <TableHead>Alasan</TableHead>
                <TableHead style={{ width: 60 }}>{t.thAct}</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {entries.map((e, i) => {
                const issue = issues.get(i);
                return (
                  <TableRow key={e.nik}>
                    <TableCell className="tabular-nums">{i + 1}</TableCell>
                    <TableCell className="font-mono">{e.nik}</TableCell>
                    <TableCell>
                      <span className="font-semibold">{e.name}</span>
                      {issue ? (
                        <div className="mt-1 text-xs text-(--color-danger-text)">
                          {issue}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>{e.departmentName}</TableCell>
                    <TableCell className="font-mono whitespace-nowrap">
                      {currentOf(i)} → <b>{e.code}</b>
                    </TableCell>
                    <TableCell className="max-w-[260px]">{e.reason}</TableCell>
                    <TableCell>
                      <IconButton
                        danger
                        aria-label="Hapus dari daftar"
                        onClick={() => removeEntry(i)}
                      >
                        <Trash2 />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <StateBox
            icon={<CalendarClock className="text-(--color-primary-bright)" />}
            title="Belum ada entri"
            body="Pilih karyawan, kode baru, dan alasan, lalu tekan Tambah. Ulangi untuk karyawan berikutnya."
          />
        )}
        <PanelFoot>
          <FootSum>
            <b>{entries.length}</b> karyawan akan dikoreksi untuk <b>{date}</b>
          </FootSum>
          <Button
            disabled={!entries.length || save.isPending}
            onClick={() => setReviewOpen(true)}
          >
            <Save />
            Simpan Semua ({entries.length})
          </Button>
        </PanelFoot>
      </Panel>

      <Dialog
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        labelledBy="rcn-t"
      >
        <DialogIcon variant="info">
          <CalendarClock />
        </DialogIcon>
        <DialogTitle id="rcn-t">
          Simpan {entries.length} koreksi untuk {date}?
        </DialogTitle>
        <DialogBody>
          Berlaku langsung untuk alokasi, tiket, dan display, dan tidak tertimpa
          tarikan unggul_att. Agar ikut alokasi pagi, simpan sebelum Batas
          Finger In.
        </DialogBody>
        <ul className="mt-4 flex max-h-[280px] flex-col gap-1 overflow-y-auto text-sm">
          {entries.map((e, i) => (
            <li key={e.nik} className="flex justify-between gap-4">
              <span>
                {e.name} <span className="font-mono text-xs">({e.nik})</span>
              </span>
              <span className="font-mono whitespace-nowrap">
                {currentOf(i)} → <b>{e.code}</b>
              </span>
            </li>
          ))}
        </ul>
        <DialogActions>
          <Button variant="ghost" onClick={() => setReviewOpen(false)}>
            {t.btnCancel}
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            Simpan Semua
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
