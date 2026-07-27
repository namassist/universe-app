"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Plus, Search } from "lucide-react";

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

type Status = "pending" | "approved" | "rejected";
type Row = {
  sid: string;
  nik: string;
  name: string;
  status: Status;
  whenId: string;
  whenEn: string;
  whatId: string;
  whatEn: string;
  byId?: string;
  byEn?: string;
};
type Group = { sid: string; rows: Row[] };

const stBadge: Record<Status, BadgeVariant> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
};

/* ---- static sample content ---- */
const ROWS: Row[] = [
  {
    sid: "REV-2481",
    nik: "503220421",
    name: "Budi Santoso",
    status: "pending",
    whenId: "20 Jul 2026",
    whenEn: "20 Jul 2026",
    whatId: "21 Jul: P-2 → OFF (keperluan keluarga)",
    whatEn: "21 Jul: P-2 → OFF (family matter)",
  },
  {
    sid: "REV-2481",
    nik: "501230510",
    name: "Rudi Hartono",
    status: "pending",
    whenId: "20 Jul 2026",
    whenEn: "20 Jul 2026",
    whatId: "22 Jul: M-1 → P-1 (tukar shift)",
    whatEn: "22 Jul: M-1 → P-1 (shift swap)",
  },
  {
    sid: "REV-2481",
    nik: "511190111",
    name: "Joko Prasetyo",
    status: "pending",
    whenId: "20 Jul 2026",
    whenEn: "20 Jul 2026",
    whatId: "23 Jul: P-1 → M-2",
    whatEn: "23 Jul: P-1 → M-2",
  },
  {
    sid: "REV-2479",
    nik: "508210388",
    name: "Andi Wijaya",
    status: "approved",
    whenId: "18 Jul 2026",
    whenEn: "18 Jul 2026",
    whatId: "19 Jul: OFF → P-2 (lembur disetujui)",
    whatEn: "19 Jul: OFF → P-2 (approved overtime)",
    byId: "Disetujui Manajer Ops · 19 Jul",
    byEn: "Approved by Ops Manager · 19 Jul",
  },
  {
    sid: "REV-2479",
    nik: "509220290",
    name: "Dewi Anggraini",
    status: "rejected",
    whenId: "18 Jul 2026",
    whenEn: "18 Jul 2026",
    whatId: "20 Jul: P-1 → OFF",
    whatEn: "20 Jul: P-1 → OFF",
    byId: "Ditolak Manajer Ops · kuota shift",
    byEn: "Rejected by Ops Manager · shift quota",
  },
  {
    sid: "REV-2470",
    nik: "506230455",
    name: "Fitri Handayani",
    status: "approved",
    whenId: "12 Jul 2026",
    whenEn: "12 Jul 2026",
    whatId: "14 Jul: M-2 → OFF (sakit)",
    whatEn: "14 Jul: M-2 → OFF (sick)",
    byId: "Disetujui Manajer Ops · 13 Jul",
    byEn: "Approved by Ops Manager · 13 Jul",
  },
];

export function RosterRevisionMenu({ mode }: { mode: AccessMode }) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const en = lang === "en";
  const canW = mode === "manage";

  const [st, setSt] = React.useState("");
  const [q, setQ] = React.useState("");
  const [detailSid, setDetailSid] = React.useState<string | null>(null);

  const stLabel = (s: Status) =>
    s === "pending"
      ? t.stPending
      : s === "approved"
        ? t.stApproved
        : t.stRejected;

  /* kelompokkan per sid — urutan sesuai kemunculan pertama */
  const groups = React.useMemo(() => {
    const map = new Map<string, Group>();
    for (const r of ROWS) {
      const g = map.get(r.sid);
      if (g) g.rows.push(r);
      else map.set(r.sid, { sid: r.sid, rows: [r] });
    }
    return Array.from(map.values());
  }, []);

  const shown = groups.filter((g) => {
    if (st && !g.rows.some((r) => r.status === st)) return false;
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return g.rows.some((r) => r.name.toLowerCase().includes(needle));
  });
  const pg = usePagination(shown);

  const pendingN = ROWS.filter((r) => r.status === "pending").length;
  const detail = detailSid
    ? groups.find((g) => g.sid === detailSid)
    : undefined;

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={t.navR2} sub={t.revListSub}>
        {canW ? (
          <Button onClick={() => router.push(`/roster-revision/new`)}>
            <Plus />
            {t.revNewBtn}
          </Button>
        ) : null}
      </PageTitle>

      <Panel>
        <Toolbar>
          <ToolbarTitle>{t.rvListTitle}</ToolbarTitle>
          <ToolbarGroup>
            <SearchInput
              className="w-[240px]"
              placeholder={t.searchEmp}
              aria-label={t.searchEmp}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <Select
              aria-label={t.allStatus}
              wrapperClassName="w-[170px]"
              value={st}
              onChange={(e) => setSt(e.target.value)}
            >
              <option value="">{t.allStatus}</option>
              <option value="pending">{t.stPending}</option>
              <option value="approved">{t.stApproved}</option>
              <option value="rejected">{t.stRejected}</option>
            </Select>
          </ToolbarGroup>
        </Toolbar>

        {shown.length ? (
          <Table>
            <TableHeader>
              <tr>
                <TableHead className="w-[170px]">{t.thSubmission}</TableHead>
                <TableHead>{t.thEmp}</TableHead>
                <TableHead className="w-[150px] max-xl:hidden">
                  {t.thWhen}
                </TableHead>
                <TableHead className="w-[180px]">{t.thStatus}</TableHead>
                <TableHead className="w-[90px]">{t.thAct}</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {pg.rows.map((g) => {
                const statuses = Array.from(
                  new Set(g.rows.map((r) => r.status))
                );
                return (
                  <TableRow key={g.sid}>
                    <TableCell>
                      <NameCell
                        name={<span className="font-mono">{g.sid}</span>}
                        sub={`${g.rows.length} ${t.revCount}`}
                      />
                    </TableCell>
                    <TableCell className="max-w-[340px]">
                      {g.rows.map((r) => r.name).join(", ")}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-(--text-secondary) max-xl:hidden">
                      {en ? g.rows[0]!.whenEn : g.rows[0]!.whenId}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        {statuses.map((s) => (
                          <Badge key={s} variant={stBadge[s]} dot>
                            {stLabel(s)}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setDetailSid(g.sid)}
                      >
                        {t.rvDetail}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <StateBox
            icon={<Search className="text-primary-bright" />}
            title={t.noResTitle}
            body={t.apEmptyB}
          />
        )}

        <PanelFoot>
          <FootSum>
            {t.attSumA} <b>{pg.range}</b> {t.attSumB} <b>{pg.total}</b>{" "}
            {t.rvSumB} · <b>{pendingN}</b> {t.apSumC}
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
        open={!!detail}
        onClose={() => setDetailSid(null)}
        className="w-[min(620px,100%)]"
        labelledBy="rvd-t"
      >
        {detail ? (
          <>
            <DialogIcon variant="info">
              <CalendarDays />
            </DialogIcon>
            <DialogTitle id="rvd-t" className="font-mono">
              {detail.sid}
            </DialogTitle>
            <DialogBody>
              {detail.rows.length} {t.revCount} · {t.thWhen.toLowerCase()}{" "}
              {en ? detail.rows[0]!.whenEn : detail.rows[0]!.whenId}
            </DialogBody>
            <div className="mt-3 max-h-[50vh] overflow-y-auto">
              {detail.rows.map((r, i) => (
                <div key={i} className="border-b border-(--divider) py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <b className="text-sm">{r.name}</b>
                    <span className="font-mono text-xs text-(--text-tertiary)">
                      {r.nik}
                    </span>
                    <Badge variant={stBadge[r.status]} dot className="ml-auto">
                      {stLabel(r.status)}
                    </Badge>
                  </div>
                  <div className="mt-1 text-sm text-(--text-secondary)">
                    {en ? r.whatEn : r.whatId}
                  </div>
                  <div className="mt-0.5 text-xs text-(--text-tertiary)">
                    {(en ? r.byEn : r.byId) ?? (en ? r.whenEn : r.whenId)}
                  </div>
                </div>
              ))}
            </div>
            <DialogActions>
              <Button variant="secondary" onClick={() => setDetailSid(null)}>
                {t.btnClose}
              </Button>
            </DialogActions>
          </>
        ) : null}
      </Dialog>
    </div>
  );
}
