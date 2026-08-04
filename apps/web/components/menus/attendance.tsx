"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Search } from "lucide-react";

import type { AccessMode } from "@/lib/access";
import { errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { masterQueryOptions } from "@/lib/queries/master";
import {
  attendanceQueryOptions,
  syncAttendance,
} from "@/lib/queries/readiness";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Select } from "@/components/ui/select";
import { StateBox } from "@/components/ui/state-box";
import {
  IOCell,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { useToast } from "@/components/ui/toast";

/**
 * The tap log as the machines recorded it: first IN and first OUT per person
 * per day, enriched with who the NIK is and what the roster says. What a tap
 * *means* against a shift (late, unfit, absent) needs the allocation engine
 * and arrives with the Actual tab — this screen does not guess.
 */

const isoDate = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const daysAgo = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() - days);
  return isoDate(d);
};

const MAX_SPAN_DAYS = 62;

/** "YYYY-MM-DD HH:MM:SS" → "HH:MM", for the in/out cells. */
const clock = (at: string | null) => (at ? at.slice(11, 16) : undefined);

export function AttendanceMenu({ mode }: { mode: AccessMode }) {
  const { t, lang } = useI18n();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();

  const today = isoDate(new Date());
  const [from, setFrom] = React.useState(daysAgo(today, 1));
  const [to, setTo] = React.useState(today);
  const [dept, setDept] = React.useState("");
  const [q, setQ] = React.useState("");

  const spanOk =
    from <= to &&
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000 <
      MAX_SPAN_DAYS;

  const deptsQ = useQuery(masterQueryOptions("departemen", true));
  const listQ = useQuery({
    ...attendanceQueryOptions(from, to),
    enabled: spanOk,
  });

  const sync = useMutation({
    mutationFn: syncAttendance,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["attendance"] });
      pushToast("success", t.refreshDoneT, `${result.upserted} ${t.attSumLog}`);
    },
    onError: (error) =>
      pushToast("error", t.navR4, errorMessage(error, t.attLoadErr)),
  });

  const all = listQ.data?.rows ?? [];

  const needle = q.trim().toLowerCase();
  const rows = all.filter((r) => {
    if (dept && r.department !== dept) return false;
    if (!needle) return true;
    return (
      (r.name ?? "").toLowerCase().includes(needle) || r.nik.includes(needle)
    );
  });
  const pg = usePagination(rows);
  const presentN = rows.filter((r) => r.firstInAt).length;

  const loc = lang === "en" ? "en-GB" : "id-ID";
  const dLabel = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(loc, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

  const syncedLabel = listQ.data?.lastSyncedAt
    ? new Date(listQ.data.lastSyncedAt).toLocaleTimeString(loc, {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        title={t.navR4}
        sub={
          <>
            {t.attSubA} {t.flowRevisi}
            {t.attSubB}
          </>
        }
      >
        <Fresh>
          {t.dataAsOf}&nbsp;
          <b className="font-mono text-(--text-secondary)">{syncedLabel}</b>
        </Fresh>
      </PageTitle>

      <Panel>
        <Toolbar>
          <ToolbarTitle>{t.attLog}</ToolbarTitle>
          <ToolbarGroup>
            <SearchInput
              className="w-[240px]"
              placeholder={t.searchEmp}
              aria-label={t.searchEmp}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <Select
              aria-label={t.allDepts}
              wrapperClassName="w-[180px]"
              value={dept}
              onChange={(e) => setDept(e.target.value)}
            >
              <option value="">{t.allDepts}</option>
              {(deptsQ.data ?? []).map((d) => (
                <option key={d.id}>{d.name}</option>
              ))}
            </Select>
            <div className="flex items-center gap-2">
              <label
                htmlFor="att-from"
                className="text-xs text-(--text-tertiary)"
              >
                {t.lblDate}
              </label>
              <Input
                id="att-from"
                type="date"
                className="w-[160px] font-mono"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
              <span className="text-(--text-tertiary)">–</span>
              <Input
                id="att-to"
                type="date"
                className="w-[160px] font-mono"
                aria-label={t.lblDateTo}
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
            {mode === "manage" ? (
              <Button
                variant="secondary"
                onClick={() => sync.mutate()}
                disabled={sync.isPending}
              >
                <RefreshCw className={cn(sync.isPending && "animate-spin")} />
                {t.refresh}
              </Button>
            ) : null}
          </ToolbarGroup>
        </Toolbar>

        {listQ.isPending && spanOk ? (
          <TableSkeleton rows={8} />
        ) : listQ.isError ? (
          <StateBox
            icon={<Search className="text-(--color-primary-bright)" />}
            title={t.attLoadErr}
            body={errorMessage(listQ.error, t.attLoadErr)}
          />
        ) : pg.rows.length ? (
          <Table>
            <TableHeader>
              <tr>
                <TableHead>{t.thEmp}</TableHead>
                <TableHead>NIK</TableHead>
                <TableHead>{t.lblDate}</TableHead>
                <TableHead className="max-xl:hidden">{t.thDept}</TableHead>
                <TableHead>{t.thRoster}</TableHead>
                <TableHead>{t.thIn}</TableHead>
                <TableHead>{t.thOut}</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {pg.rows.map((r) => (
                <TableRow key={`${r.nik}-${r.date}`}>
                  <TableCell
                    className={cn(
                      "font-semibold",
                      !r.name && "text-(--text-tertiary)"
                    )}
                  >
                    {r.name ?? "—"}
                  </TableCell>
                  <TableCell className="font-mono text-(--text-secondary) tabular-nums">
                    {r.nik}
                  </TableCell>
                  <TableCell className="font-mono whitespace-nowrap">
                    {dLabel(r.date)}
                  </TableCell>
                  <TableCell className="max-xl:hidden">
                    {r.department ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="info">{r.rosterCode ?? "–"}</Badge>
                  </TableCell>
                  <TableCell>
                    <IOCell time={clock(r.firstInAt)} />
                  </TableCell>
                  <TableCell>
                    <IOCell time={clock(r.firstOutAt)} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <StateBox
            icon={<Search className="text-(--color-primary-bright)" />}
            title={t.noResTitle}
            body={t.attEmptyB}
          />
        )}

        <PanelFoot>
          <FootSum>
            {t.attSumA} <b>{pg.range}</b> {t.attSumB} <b>{pg.total}</b>{" "}
            {t.attSumLog} · <b>{presentN}</b> {t.attSumD}
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
    </div>
  );
}
