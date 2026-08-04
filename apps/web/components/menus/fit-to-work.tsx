"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Search } from "lucide-react";

import type { AccessMode } from "@/lib/access";
import { errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { ftwQueryOptions, syncFtw, type FtwRow } from "@/lib/queries/readiness";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { useToast } from "@/components/ui/toast";

import {
  FTW_CAT_BADGE as CAT_BADGE,
  ftwCatOf as catOf,
  daysAgo,
  ftwDecisionBadge as decisionBadge,
  isoDate,
  ftwSleepClass as sleepClass,
  ftwSleepText as sleepText,
  type FtwCatKey as CatKey,
} from "./fit-to-work-shared";

type Strip = "ok" | "bad" | "na";

const STRIP_CLS: Record<Strip, string> = {
  ok: "bg-[rgba(23,206,100,.75)]",
  bad: "bg-[rgba(233,155,42,.85)]",
  na: "bg-(--fill-hover-strong)",
};

const STRIP_DAYS = 7;

/** The API refuses ranges past 62 days, and the fetch runs six days wider
 *  than the visible range for the history strips: 55 + 6 + 1 = 62, exactly
 *  the cap. One more visible day and a maximal range would 422. */
const MAX_SPAN_DAYS = 55;

export function FitToWorkMenu({ mode }: { mode: AccessMode }) {
  const { t, lang } = useI18n();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();

  const today = isoDate(new Date());
  const [q, setQ] = React.useState("");
  const [cat, setCat] = React.useState("");
  const [shift, setShift] = React.useState("");
  const [d1, setD1] = React.useState(daysAgo(today, 6));
  const [d2, setD2] = React.useState(today);

  const spanOk =
    d1 <= d2 &&
    (Date.parse(`${d2}T00:00:00Z`) - Date.parse(`${d1}T00:00:00Z`)) /
      86_400_000 <=
      MAX_SPAN_DAYS;

  // Fetched wider than shown: the history strip needs the week before each
  // visible day, and one fetch answers both.
  const fetchFrom = daysAgo(d1, STRIP_DAYS - 1);
  const listQ = useQuery({
    ...ftwQueryOptions(fetchFrom, d2),
    enabled: spanOk,
  });

  const sync = useMutation({
    mutationFn: syncFtw,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["fit-to-work"] });
      pushToast(
        "success",
        t.refreshDoneT,
        `${result.upserted} ${t.ftwSumLogs}`
      );
    },
    onError: (error) =>
      pushToast("error", t.navFtw, errorMessage(error, t.ftwLoadErr)),
  });

  const all = React.useMemo(() => listQ.data?.rows ?? [], [listQ.data]);

  // nik+date → group, for the strips.
  const catByNikDate = React.useMemo(() => {
    const map = new Map<string, CatKey>();
    for (const row of all)
      map.set(`${row.nik} ${row.date}`, catOf(row.sleepCategory));
    return map;
  }, [all]);

  const shiftOptions = React.useMemo(
    () => [...new Set(all.flatMap((r) => (r.shift ? [r.shift] : [])))].sort(),
    [all]
  );

  const needle = q.trim().toLowerCase();
  const rows = all
    .filter((r) => {
      if (r.date < d1) return false; // strip context, not a visible day
      if (shift && r.shift !== shift) return false;
      if (cat && catOf(r.sleepCategory) !== cat) return false;
      if (!needle) return true;
      return r.name.toLowerCase().includes(needle) || r.nik.includes(needle);
    })
    .sort(
      (a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name)
    );
  const pg = usePagination(rows);

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

  const stripOf = (row: FtwRow): Strip[] =>
    Array.from({ length: STRIP_DAYS }, (_, i) => {
      const day = daysAgo(row.date, STRIP_DAYS - 1 - i);
      const dayCat = catByNikDate.get(`${row.nik} ${day}`);
      return dayCat === undefined ? "na" : dayCat === "fit" ? "ok" : "bad";
    });

  const catLabel: Record<CatKey, string> = {
    fit: t.bFit,
    istirahat: t.ftwStatKurang,
    tidak: "Tidak Boleh Bekerja",
    belum: t.ftwStatBelum,
  };

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={t.navFtw} sub={t.ftwSub}>
        <Fresh>
          {t.dataAsOf}&nbsp;
          <b className="font-mono text-(--text-secondary)">{syncedLabel}</b>
        </Fresh>
      </PageTitle>

      <Panel>
        <Toolbar>
          <ToolbarTitle>{t.ftwLog}</ToolbarTitle>
          <ToolbarGroup>
            <SearchInput
              className="w-[240px]"
              placeholder={t.searchOp}
              aria-label={t.searchOp}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <Select
              wrapperClassName="w-[190px]"
              value={cat}
              onChange={(e) => setCat(e.target.value)}
              aria-label={t.allStatus}
            >
              <option value="">{t.allStatus}</option>
              {(Object.keys(catLabel) as CatKey[]).map((key) => (
                <option key={key} value={key}>
                  {catLabel[key]}
                </option>
              ))}
            </Select>
            <Select
              wrapperClassName="w-[150px]"
              value={shift}
              onChange={(e) => setShift(e.target.value)}
              aria-label={t.allShift}
            >
              <option value="">{t.allShift}</option>
              {shiftOptions.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
            <div className="flex items-center gap-2">
              <Input
                type="date"
                className="w-40 font-mono"
                value={d1}
                onChange={(e) => setD1(e.target.value)}
                aria-label={t.lblDate}
              />
              <span className="text-(--text-tertiary)">—</span>
              <Input
                type="date"
                className="w-40 font-mono"
                value={d2}
                onChange={(e) => setD2(e.target.value)}
                aria-label={t.lblDateTo}
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
            title={t.ftwLoadErr}
            body={errorMessage(listQ.error, t.ftwLoadErr)}
          />
        ) : pg.rows.length ? (
          <div className="overflow-x-auto">
            <Table className="min-w-[1440px]">
              <TableHeader>
                <tr>
                  <TableHead>{t.thOperator}</TableHead>
                  <TableHead>NIK</TableHead>
                  <TableHead>{t.thCompany}</TableHead>
                  <TableHead>{t.thDept}</TableHead>
                  <TableHead>{t.thPos}</TableHead>
                  <TableHead>Mess</TableHead>
                  <TableHead>{t.thShift}</TableHead>
                  <TableHead>{t.thSleep}</TableHead>
                  <TableHead>{t.thStatus}</TableHead>
                  <TableHead>FTW</TableHead>
                  <TableHead>{t.lblDate}</TableHead>
                  <TableHead>{t.thSendTime}</TableHead>
                  <TableHead>{t.thHist}</TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {pg.rows.map((r) => {
                  const rowCat = catOf(r.sleepCategory);
                  const strip = stripOf(r);
                  const bad = strip.filter((s) => s === "bad").length;
                  return (
                    <TableRow key={`${r.nik}-${r.date}`}>
                      <TableCell className="font-semibold">{r.name}</TableCell>
                      <TableCell className="font-mono text-(--text-secondary) tabular-nums">
                        {r.nik}
                      </TableCell>
                      <TableCell>{r.company ?? "—"}</TableCell>
                      <TableCell>{r.department ?? "—"}</TableCell>
                      <TableCell>{r.position ?? "—"}</TableCell>
                      <TableCell>{r.mess ?? "—"}</TableCell>
                      <TableCell>{r.shift ?? "—"}</TableCell>
                      <TableCell className={sleepClass(rowCat)}>
                        {sleepText(r.sleepMinutes)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={CAT_BADGE[rowCat]} dot>
                          {r.sleepCategory ?? t.ftwStatBelum}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {r.ftwDecision ? (
                          <Badge variant={decisionBadge(r.ftwDecision)}>
                            {r.ftwDecision}
                          </Badge>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="font-mono whitespace-nowrap">
                        {dLabel(r.date)}
                      </TableCell>
                      <TableCell className="font-mono">
                        {r.sentAt ? r.sentAt.slice(11, 16) : "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {strip.map((s, i) => (
                            <i
                              key={i}
                              className={cn(
                                "size-2.5 flex-none rounded-[3px]",
                                STRIP_CLS[s]
                              )}
                            />
                          ))}
                          <span className="ml-1.5 text-xs text-(--text-tertiary)">
                            {bad === 0 ? t.histStable : `${bad}${t.histBad}`}
                          </span>
                        </div>
                        <Link
                          href={`/fit-to-work/history?nik=${r.nik}`}
                          className="mt-1 inline-block text-xs"
                        >
                          {t.ftwSeeAll}
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <StateBox
            icon={<Search className="text-(--color-primary-bright)" />}
            title={t.noResTitle}
            body={t.ftwEmptyB}
          />
        )}

        <PanelFoot>
          <FootSum>
            {t.attSumA} <b>{pg.range}</b> {t.attSumB} <b>{pg.total}</b>{" "}
            {t.ftwSumLogs}
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
