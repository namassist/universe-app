"use client";

import * as React from "react";
import { CheckCircle2, PenLine, TriangleAlert } from "lucide-react";

import type { AccessMode } from "@/lib/access";
import { useI18n } from "@/lib/i18n";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogIcon,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
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
import { Segmented, SegmentedButton } from "@/components/ui/segmented";
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

type Status = "pending" | "approved" | "rejected";
type Filter = Status | "all";
type Row = {
  id: string;
  nik: string;
  name: string;
  status: Status;
  whatId: string;
  whatEn: string;
  whenId: string;
  whenEn: string;
  byId?: string;
  byEn?: string;
};

const stBadge: Record<Status, BadgeVariant> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
};

/* ---- static sample content ---- */
const INITIAL: Row[] = [
  {
    id: "a1",
    nik: "503220421",
    name: "Budi Santoso",
    status: "pending",
    whatId: "21 Jul: P-2 → OFF · keperluan keluarga",
    whatEn: "21 Jul: P-2 → OFF · family matter",
    whenId: "20 Jul 2026",
    whenEn: "20 Jul 2026",
  },
  {
    id: "a2",
    nik: "501230510",
    name: "Rudi Hartono",
    status: "pending",
    whatId: "22 Jul: M-1 → P-1 · tukar shift",
    whatEn: "22 Jul: M-1 → P-1 · shift swap",
    whenId: "20 Jul 2026",
    whenEn: "20 Jul 2026",
  },
  {
    id: "a3",
    nik: "511190111",
    name: "Joko Prasetyo",
    status: "pending",
    whatId: "23 Jul: P-1 → M-2",
    whatEn: "23 Jul: P-1 → M-2",
    whenId: "20 Jul 2026",
    whenEn: "20 Jul 2026",
  },
  {
    id: "a4",
    nik: "508210388",
    name: "Andi Wijaya",
    status: "approved",
    whatId: "19 Jul: OFF → P-2 · lembur",
    whatEn: "19 Jul: OFF → P-2 · overtime",
    whenId: "18 Jul 2026",
    whenEn: "18 Jul 2026",
    byId: "Disetujui · 19 Jul",
    byEn: "Approved · 19 Jul",
  },
  {
    id: "a5",
    nik: "509220290",
    name: "Dewi Anggraini",
    status: "rejected",
    whatId: "20 Jul: P-1 → OFF",
    whatEn: "20 Jul: P-1 → OFF",
    whenId: "18 Jul 2026",
    whenEn: "18 Jul 2026",
    byId: "Ditolak · kuota shift",
    byEn: "Rejected · shift quota",
  },
];

export function RosterApprovalMenu({ mode }: { mode: AccessMode }) {
  const { t, lang } = useI18n();
  const { pushToast } = useToast();
  const en = lang === "en";
  const canW = mode === "manage";

  const [rows, setRows] = React.useState<Row[]>(INITIAL);
  const [filter, setFilter] = React.useState<Filter>("pending");
  const [q, setQ] = React.useState("");
  const [noteFor, setNoteFor] = React.useState<string | null>(null);
  const [note, setNote] = React.useState("");
  const [noFor, setNoFor] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("");

  const stLabel = (s: Status) =>
    s === "pending"
      ? t.stPending
      : s === "approved"
        ? t.stApproved
        : t.stRejected;

  const pendingN = rows.filter((r) => r.status === "pending").length;
  const needle = q.trim().toLowerCase();
  const list = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => filter === "all" || r.status === filter)
    .filter(
      ({ r }) =>
        !needle ||
        r.name.toLowerCase().includes(needle) ||
        r.nik.toLowerCase().includes(needle) ||
        (en ? r.whatEn : r.whatId).toLowerCase().includes(needle)
    );
  const pg = usePagination(list);

  /* keputusan lokal — status + jejak pengesah berubah di state */
  function decide(id: string | null, ok: boolean, extra?: string) {
    if (!id) return;
    const r = rows.find((row) => row.id === id);
    if (!r) return;
    const by = ok
      ? {
          byId: `Disetujui · ${extra ?? "tanpa catatan"}`,
          byEn: `Approved · ${extra ?? "no note"}`,
        }
      : { byId: `Ditolak · ${extra}`, byEn: `Rejected · ${extra}` };
    setRows((prev) =>
      prev.map((row) =>
        row.id === id
          ? { ...row, status: ok ? "approved" : "rejected", ...by }
          : row
      )
    );
    const what = (en ? r.whatEn : r.whatId).split(" · ")[0];
    if (ok) pushToast("success", t.toastOkT, `${r.name} — ${what}.`);
    else pushToast("info", t.toastNoT, `${r.name} — ${t.toastNoD}`);
  }

  const noteRow =
    noteFor !== null ? rows.find((r) => r.id === noteFor) : undefined;
  const noRow = noFor !== null ? rows.find((r) => r.id === noFor) : undefined;

  const segs: { f: Filter; label: React.ReactNode }[] = [
    {
      f: "pending",
      label: (
        <>
          {t.segPending} <span className="font-mono">{pendingN}</span>
        </>
      ),
    },
    { f: "approved", label: t.segApproved },
    { f: "rejected", label: t.segRejected },
    { f: "all", label: t.segAll },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={t.apTitle} sub={t.apSub} />

      <Panel>
        <Toolbar>
          <ToolbarTitle>{t.apQueue}</ToolbarTitle>
          <ToolbarGroup>
            <SearchInput
              className="w-[240px]"
              placeholder={t.searchEmp}
              aria-label={t.searchEmp}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <Segmented role="group" aria-label="Filter status">
              {segs.map((s) => (
                <SegmentedButton
                  key={s.f}
                  active={filter === s.f}
                  onClick={() => setFilter(s.f)}
                >
                  {s.label}
                </SegmentedButton>
              ))}
            </Segmented>
          </ToolbarGroup>
        </Toolbar>

        {list.length ? (
          <Table>
            <TableHeader>
              <tr>
                <TableHead>{t.thEmp}</TableHead>
                <TableHead>NIK</TableHead>
                <TableHead>{t.thSubmission}</TableHead>
                <TableHead>{t.thWhen}</TableHead>
                <TableHead>{t.thStatus}</TableHead>
                <TableHead className="w-[330px]">{t.thAct}</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {pg.rows.map(({ r, i }) => (
                <TableRow key={i}>
                  <TableCell className="font-semibold">{r.name}</TableCell>
                  <TableCell className="font-mono text-(--text-secondary) tabular-nums">
                    {r.nik}
                  </TableCell>
                  <TableCell className="max-w-[360px]">
                    {en ? r.whatEn : r.whatId}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-(--text-secondary)">
                    {en ? r.whenEn : r.whenId}
                  </TableCell>
                  <TableCell>
                    <Badge variant={stBadge[r.status]} dot>
                      {stLabel(r.status)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {r.status === "pending" && canW ? (
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => decide(r.id, true)}>
                          {t.btnOk}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setNote("");
                            setNoteFor(r.id);
                          }}
                        >
                          {t.btnNote}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => {
                            setReason("");
                            setNoFor(r.id);
                          }}
                        >
                          {t.btnNo}
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-(--text-tertiary)">
                        {en ? r.byEn : r.byId}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <StateBox
            icon={<CheckCircle2 className="text-(--badge-success-text)" />}
            title={t.apEmptyT}
            body={t.apEmptyB}
          />
        )}

        <PanelFoot>
          <FootSum>
            {t.attSumA} <b>{pg.range}</b> {t.attSumB} <b>{pg.total}</b>{" "}
            {t.apSumB} · <b>{pendingN}</b> {t.apSumC}
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
        open={noteFor !== null}
        onClose={() => setNoteFor(null)}
        labelledBy="note-t"
      >
        <DialogIcon variant="info">
          <PenLine />
        </DialogIcon>
        <DialogTitle id="note-t">
          {t.noteDlgT1} {noteRow?.name} {t.noteDlgT2}
        </DialogTitle>
        <DialogBody>{t.noteDlgB}</DialogBody>
        <Field label={t.lblNote} htmlFor="ap-note" className="mt-4">
          <Textarea
            id="ap-note"
            placeholder={t.phNote}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <DialogActions>
          <Button variant="ghost" onClick={() => setNoteFor(null)}>
            {t.btnCancel}
          </Button>
          <Button
            onClick={() => {
              decide(noteFor, true, note.trim() || undefined);
              setNoteFor(null);
            }}
          >
            {t.btnOk}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={noFor !== null}
        onClose={() => setNoFor(null)}
        labelledBy="no-t"
      >
        <DialogIcon variant="warning">
          <TriangleAlert />
        </DialogIcon>
        <DialogTitle id="no-t">
          {t.noDlgT1} {noRow?.name}?
        </DialogTitle>
        <DialogBody>{t.noDlgB}</DialogBody>
        <Field
          label={t.lblWhy}
          htmlFor="ap-reason"
          required
          helper={t.helpWhy}
          className="mt-4"
        >
          <Textarea
            id="ap-reason"
            placeholder={t.phWhy}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <DialogActions>
          <Button variant="ghost" onClick={() => setNoFor(null)}>
            {t.btnCancel}
          </Button>
          <Button
            variant="destructive"
            disabled={!reason.trim()}
            onClick={() => {
              decide(noFor, false, reason.trim());
              setNoFor(null);
            }}
          >
            {t.btnNoDo}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
