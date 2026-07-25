"use client";

import * as React from "react";
import { Search, Wrench } from "lucide-react";

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
import {
  Drawer,
  DrawerClose,
  Timeline,
  TimelineItem,
} from "@/components/ui/drawer";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { Pagination, usePagination } from "@/components/ui/pagination";
import {
  FootSum,
  Fresh,
  PageTitle,
  Panel,
  PanelFoot,
  Toolbar,
  ToolbarGroup,
  ToolbarTitle,
} from "@/components/ui/panel";
import { SearchInput } from "@/components/ui/search-input";
import { Segmented, SegmentedButton } from "@/components/ui/segmented";
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

type UnitStatus = "ready" | "breakdown" | "standby";
type UsRow = {
  id: string;
  code: string;
  type: string;
  status: UnitStatus;
  loc: string;
  upd: string;
};
type Hist = { id: string; status: UnitStatus; when: string; reason: string };

const statusBadge: Record<
  UnitStatus,
  { variant: BadgeVariant; label: string }
> = {
  ready: { variant: "success", label: "Ready" },
  breakdown: { variant: "danger", label: "Breakdown" },
  standby: { variant: "warning", label: "Standby" },
};

const statusDotColor: Record<UnitStatus, string> = {
  ready: "var(--color-success)",
  breakdown: "var(--color-danger)",
  standby: "var(--color-warning)",
};

function pad(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}
function stampNow() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())} WITA`;
}

/* ---- static sample content ---- */
/* Selaras dgn Fleet Allocation (data.ts): kode, status & lokasi tiap unit sama. */
const INITIAL: UsRow[] = [
  {
    id: "u1",
    code: "EX8001",
    type: "EX2600-7BH · HITACHI",
    status: "ready",
    loc: "Panel East Puncak Utara",
    upd: "2026-07-21",
  },
  {
    id: "u2",
    code: "RD5001",
    type: "777E · CATERPILLAR",
    status: "ready",
    loc: "Panel East Puncak Utara",
    upd: "2026-07-21",
  },
  {
    id: "u3",
    code: "RD5002",
    type: "777E · CATERPILLAR",
    status: "ready",
    loc: "Panel East Puncak Utara",
    upd: "2026-07-21",
  },
  {
    id: "u4",
    code: "RD4001",
    type: "773E · CATERPILLAR",
    status: "breakdown",
    loc: "Panel East Puncak Utara",
    upd: "2026-07-21",
  },
  {
    id: "u5",
    code: "RD4002",
    type: "773E · CATERPILLAR",
    status: "ready",
    loc: "Panel East Puncak Utara",
    upd: "2026-07-21",
  },
  {
    id: "u6",
    code: "EX7001",
    type: "EX2000-7BH · HITACHI",
    status: "ready",
    loc: "Disposal T4",
    upd: "2026-07-21",
  },
  {
    id: "u7",
    code: "DT4017",
    type: "SYZ440C · SANY",
    status: "ready",
    loc: "Disposal T4",
    upd: "2026-07-21",
  },
  {
    id: "u8",
    code: "DT4018",
    type: "SYZ440C · SANY",
    status: "ready",
    loc: "Disposal T4",
    upd: "2026-07-21",
  },
  {
    id: "u9",
    code: "DT3013",
    type: "SYZ320C-8W(R) · SANY",
    status: "standby",
    loc: "Disposal T4",
    upd: "2026-07-21",
  },
  {
    id: "u10",
    code: "WE2004",
    type: "SY215W · SANY",
    status: "ready",
    loc: "Workshop",
    upd: "2026-07-20",
  },
  {
    id: "u11",
    code: "DT3014",
    type: "SYZ320C-8W(R) · SANY",
    status: "standby",
    loc: "Workshop",
    upd: "2026-07-20",
  },
  {
    id: "u12",
    code: "EX5001",
    type: "ZX870LCH-5G · HITACHI",
    status: "ready",
    loc: "Panel East Puncak Utara",
    upd: "2026-07-20",
  },
  {
    id: "u13",
    code: "EX5002",
    type: "ZX870LCH-5G · HITACHI",
    status: "standby",
    loc: "Readyline",
    upd: "2026-07-20",
  },
  {
    id: "u14",
    code: "EX4001",
    type: "ZX470LC-5G · HITACHI",
    status: "standby",
    loc: "Readyline",
    upd: "2026-07-19",
  },
  {
    id: "u15",
    code: "EX4002",
    type: "ZX470LC-5G · HITACHI",
    status: "standby",
    loc: "Readyline",
    upd: "2026-07-19",
  },
];

const INITIAL_HIST: Record<string, Hist[]> = {
  u4: [
    {
      id: "h1",
      status: "breakdown",
      when: "21 Jul 08:12",
      reason: "Engine overheat — menunggu spare part",
    },
    {
      id: "h2",
      status: "ready",
      when: "18 Jul 06:00",
      reason: "Selesai service berkala 2000 jam",
    },
  ],
  u9: [
    {
      id: "h3",
      status: "standby",
      when: "21 Jul 05:30",
      reason: "Tanpa operator — cadangan shift pagi",
    },
  ],
  u11: [
    {
      id: "h4",
      status: "standby",
      when: "20 Jul 05:30",
      reason: "Cadangan — rotasi unit shift malam",
    },
  ],
};

type FilterKey = "all" | UnitStatus;

export function UnitStatusMenu({ mode }: { mode: AccessMode }) {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const canW = mode === "manage";

  const [units, setUnits] = React.useState<UsRow[]>(INITIAL);
  const [hists, setHists] =
    React.useState<Record<string, Hist[]>>(INITIAL_HIST);
  const [filter, setFilter] = React.useState<FilterKey>("all");
  const [q, setQ] = React.useState("");
  const [freshTime, setFreshTime] = React.useState("");

  const [drawer, setDrawer] = React.useState<UsRow | null>(null);
  const [dlg, setDlg] = React.useState<UsRow | null>(null);
  const [newSt, setNewSt] = React.useState("Ready");
  const [reason, setReason] = React.useState("");

  React.useEffect(() => {
    const id = setTimeout(() => setFreshTime(stampNow()), 0);
    return () => clearTimeout(id);
  }, []);

  const needle = q.trim().toLowerCase();
  /* breakdown dulu — meniru sort=-status server */
  const order: Record<UnitStatus, number> = {
    breakdown: 0,
    standby: 1,
    ready: 2,
  };
  const rows = units
    .filter((u) => {
      if (filter !== "all" && u.status !== filter) return false;
      if (!needle) return true;
      return (
        u.code.toLowerCase().includes(needle) ||
        u.type.toLowerCase().includes(needle) ||
        u.loc.toLowerCase().includes(needle)
      );
    })
    .sort(
      (a, b) =>
        order[a.status] - order[b.status] || a.code.localeCompare(b.code)
    );
  const pg = usePagination(rows);
  const breakN = units.filter((u) => u.status === "breakdown").length;

  function openDialog(row: UsRow) {
    setNewSt(statusBadge[row.status].label);
    setReason("");
    setDlg(row);
  }

  function saveStatus() {
    if (!dlg || !reason.trim()) return;
    const target = dlg;
    const kind = newSt.toLowerCase() as UnitStatus;
    setDlg(null);
    const today = new Date().toISOString().slice(0, 10);
    setUnits((prev) =>
      prev.map((u) =>
        u.id === target.id ? { ...u, status: kind, upd: today } : u
      )
    );
    const d = new Date();
    const when = `${d.toLocaleDateString("id-ID", { day: "numeric", month: "short" })} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    setHists((prev) => ({
      ...prev,
      [target.id]: [
        { id: `h-${Date.now()}`, status: kind, when, reason: reason.trim() },
        ...(prev[target.id] ?? []),
      ],
    }));
    pushToast("success", `${target.code} → ${newSt}`, t.toastStD);
  }

  const heads = [
    t.thUnitCode,
    t.thType,
    t.thStatus,
    t.thLoc,
    t.thLastUpd,
    t.thAct,
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={t.navUnitStatus} sub={t.usSub}>
        <Fresh>
          {t.dataAsOf}&nbsp;
          <b className="font-mono text-(--text-secondary)">{freshTime}</b>
        </Fresh>
      </PageTitle>

      <Panel>
        <Toolbar>
          <ToolbarTitle>{t.usListTitle}</ToolbarTitle>
          <ToolbarGroup>
            <SearchInput
              className="w-[240px]"
              placeholder={t.searchUnit}
              aria-label={t.searchUnit}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <Segmented role="group" aria-label="Filter status">
              {(
                [
                  ["all", t.segAll],
                  ["ready", "Ready"],
                  ["breakdown", "Breakdown"],
                  ["standby", "Standby"],
                ] as [FilterKey, string][]
              ).map(([key, label]) => (
                <SegmentedButton
                  key={key}
                  active={filter === key}
                  onClick={() => setFilter(key)}
                >
                  {label}
                </SegmentedButton>
              ))}
            </Segmented>
          </ToolbarGroup>
        </Toolbar>

        {pg.rows.length ? (
          <Table>
            <TableHeader>
              <tr>
                {heads.map((h, i) => (
                  <TableHead
                    key={h}
                    className={i === 3 ? "max-xl:hidden" : undefined}
                    style={i === 5 ? { width: 220 } : undefined}
                  >
                    {h}
                  </TableHead>
                ))}
              </tr>
            </TableHeader>
            <TableBody>
              {pg.rows.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <NameCell name={u.code} />
                  </TableCell>
                  <TableCell>{u.type}</TableCell>
                  <TableCell>
                    <Badge variant={statusBadge[u.status].variant} dot>
                      {statusBadge[u.status].label}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-xl:hidden">{u.loc}</TableCell>
                  <TableCell className="text-[13px] text-(--text-secondary)">
                    {u.upd}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setDrawer(u)}
                      >
                        {t.btnHist}
                      </Button>
                      {canW ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => openDialog(u)}
                        >
                          {t.btnChangeSt}
                        </Button>
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
            title={t.usEmptyT}
            body={t.usEmptyB}
          />
        )}

        <PanelFoot>
          <FootSum>
            {t.attSumA} <b>{pg.range}</b> {t.attSumB} <b>{pg.total}</b>{" "}
            {t.udbSumB} · <b>{breakN}</b> Breakdown
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

      {/* Drawer riwayat status */}
      <Drawer
        open={!!drawer}
        onClose={() => setDrawer(null)}
        labelledBy="us-dw-t"
      >
        {drawer ? (
          <>
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h3 id="us-dw-t" className="text-xl font-semibold">
                  {drawer.code}
                </h3>
                <span className="font-mono text-xs text-(--text-tertiary)">
                  {drawer.type} · {drawer.loc}
                </span>
              </div>
              <DrawerClose
                onClick={() => setDrawer(null)}
                aria-label={t.btnClose}
              />
            </div>
            <div className="mb-5">
              <Badge variant={statusBadge[drawer.status].variant} dot>
                {statusBadge[drawer.status].label}
              </Badge>
            </div>
            <h4 className="mb-4 text-xs font-semibold tracking-[.05em] text-(--text-tertiary) uppercase">
              {t.histTitle}
            </h4>
            {(hists[drawer.id] ?? []).length ? (
              <Timeline>
                {(hists[drawer.id] ?? []).map((h) => (
                  <TimelineItem
                    key={h.id}
                    dotColor={statusDotColor[h.status]}
                    when={h.when}
                    what={statusBadge[h.status].label}
                    why={h.reason}
                  />
                ))}
              </Timeline>
            ) : (
              <p className="text-sm text-(--text-tertiary)">{t.usEmptyB}</p>
            )}
          </>
        ) : null}
      </Drawer>

      {/* Dialog ubah status */}
      <Dialog open={!!dlg} onClose={() => setDlg(null)} labelledBy="us-st-t">
        <DialogIcon variant="warning">
          <Wrench />
        </DialogIcon>
        <DialogTitle id="us-st-t">
          {t.usDlgT} {dlg?.code}
        </DialogTitle>
        <DialogBody>{t.usDlgB}</DialogBody>
        <Field label={t.lblNewSt} htmlFor="st-new" required className="mt-4">
          <Select
            id="st-new"
            value={newSt}
            onChange={(e) => setNewSt(e.target.value)}
          >
            <option>Ready</option>
            <option>Breakdown</option>
            <option>Standby</option>
          </Select>
        </Field>
        <Field
          label={t.lblReason2}
          htmlFor="st-reason"
          required
          helper={t.helpReasonSt}
          className="mt-4"
        >
          <Textarea
            id="st-reason"
            placeholder={t.phReasonSt}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <DialogActions>
          <Button variant="ghost" onClick={() => setDlg(null)}>
            {t.btnCancel}
          </Button>
          <Button onClick={saveStatus} disabled={!reason.trim()}>
            {t.btnSaveSt}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
