"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Wrench } from "lucide-react";

import type { UnitStatus } from "@universe/contracts";

import type { AccessMode } from "@/lib/access";
import { api, errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
  unitStatusHistoryKey,
  unitStatusHistoryQueryOptions,
  unitStatusKey,
  unitStatusQueryOptions,
  type UnitStatusRow,
} from "@/lib/queries/unit-status";
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

/** "2026-07-21T08:12:00.000Z" → "21 Jul 08:12", in local time. */
function whenOf(iso: string) {
  const d = new Date(iso);
  const date = d.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
  });
  return `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The label pieces the table shows: "model · brand", location or a dash. */
const typeOf = (u: UnitStatusRow) => `${u.modelName} · ${u.brandName}`;
const locOf = (u: UnitStatusRow) => u.location ?? "—";

type FilterKey = "all" | UnitStatus;

export function UnitStatusMenu({ mode }: { mode: AccessMode }) {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const canW = mode === "manage";

  const listQ = useQuery(unitStatusQueryOptions());
  const units = React.useMemo(() => listQ.data ?? [], [listQ.data]);

  const [filter, setFilter] = React.useState<FilterKey>("all");
  const [q, setQ] = React.useState("");
  const [freshTime, setFreshTime] = React.useState("");

  const [drawer, setDrawer] = React.useState<UnitStatusRow | null>(null);
  const [dlg, setDlg] = React.useState<UnitStatusRow | null>(null);
  const [newSt, setNewSt] = React.useState<UnitStatus>("ready");
  const [reason, setReason] = React.useState("");

  React.useEffect(() => {
    const id = setTimeout(() => setFreshTime(stampNow()), 0);
    return () => clearTimeout(id);
  }, []);

  const historyQ = useQuery({
    ...unitStatusHistoryQueryOptions(drawer?.code ?? ""),
    enabled: !!drawer,
  });
  const history = historyQ.data ?? [];

  const save = useMutation({
    mutationFn: async (input: {
      code: string;
      status: UnitStatus;
      reason: string;
    }) => {
      const result = await api.v1["unit-status"]({ code: input.code }).post({
        status: input.status,
        reason: input.reason,
      });
      if (result.error) throw result.error;
      return result.data;
    },
    onSuccess: async (_d, input) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: unitStatusKey }),
        queryClient.invalidateQueries({
          queryKey: unitStatusHistoryKey(input.code),
        }),
      ]);
      pushToast(
        "success",
        `${input.code} → ${statusBadge[input.status].label}`,
        t.toastStD
      );
      setDlg(null);
    },
    onError: (error) =>
      pushToast("error", t.usDlgT, errorMessage(error, t.loginErr)),
  });

  const needle = q.trim().toLowerCase();
  /* breakdown dulu — urutan terburuk-dulu dari vocabulary status */
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
        typeOf(u).toLowerCase().includes(needle) ||
        locOf(u).toLowerCase().includes(needle)
      );
    })
    .sort(
      (a, b) =>
        order[a.status] - order[b.status] || a.code.localeCompare(b.code)
    );
  const pg = usePagination(rows);
  const breakN = units.filter((u) => u.status === "breakdown").length;

  function openDialog(row: UnitStatusRow) {
    setNewSt(row.status);
    setReason("");
    setDlg(row);
  }

  function saveStatus() {
    if (!dlg || !reason.trim()) return;
    save.mutate({ code: dlg.code, status: newSt, reason: reason.trim() });
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
                  <TableCell>{typeOf(u)}</TableCell>
                  <TableCell>
                    <Badge variant={statusBadge[u.status].variant} dot>
                      {statusBadge[u.status].label}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-xl:hidden">{locOf(u)}</TableCell>
                  <TableCell className="text-[13px] text-(--text-secondary)">
                    {u.updatedAt ? u.updatedAt.slice(0, 10) : "—"}
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
                  {typeOf(drawer)} · {locOf(drawer)}
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
            {history.length ? (
              <Timeline>
                {history.map((h) => (
                  <TimelineItem
                    key={h.id}
                    dotColor={statusDotColor[h.status]}
                    when={whenOf(h.createdAt)}
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
            onChange={(e) => setNewSt(e.target.value as UnitStatus)}
          >
            <option value="ready">Ready</option>
            <option value="breakdown">Breakdown</option>
            <option value="standby">Standby</option>
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
          <Button
            onClick={saveStatus}
            disabled={!reason.trim() || save.isPending}
          >
            {t.btnSaveSt}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
