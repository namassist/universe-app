"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Search } from "lucide-react";

import { errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { ftwQueryOptions } from "@/lib/queries/readiness";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageButton } from "@/components/ui/pagination";
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
import { TableSkeleton } from "@/components/ui/table-skeleton";

import {
  daysAgo,
  FTW_CAT_BADGE,
  ftwCatOf,
  ftwDecisionBadge,
  ftwSleepClass,
  ftwSleepText,
  isoDate,
  spanDays,
  type FtwCatKey,
} from "./fit-to-work-shared";

/**
 * One person's (or everyone's) FTW trail, read from the same snapshots as
 * the list — history is the range the ingest has accumulated locally, which
 * is why this page never asks savera anything. The API caps a range at 62
 * days, so that is the window this page shows at a time.
 */
const MAX_SPAN_DAYS = 61;

/* Pagination berjendela — maksimal 5 nomor halaman, terpusat di halaman aktif */
function WindowPagination({
  page,
  pageCount,
  onPage,
  per,
  onPer,
}: {
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
  per: string;
  onPer: (per: string) => void;
}) {
  const { t } = useI18n();
  const size = Math.min(5, Math.max(1, pageCount));
  const startN = Math.max(1, Math.min(page - 2, pageCount - size + 1));
  const pages = Array.from({ length: size }, (_, i) => startN + i);
  return (
    <div className="flex items-center gap-5">
      <div className="flex items-center gap-2 text-xs text-(--text-tertiary)">
        {t.rppLabel}
        <Select
          value={per}
          onChange={(e) => onPer(e.target.value)}
          aria-label={t.rppLabel}
          wrapperClassName="w-auto"
          className="h-8 w-auto rounded-lg px-2 pr-8"
        >
          {["10", "25", "50"].map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex items-center gap-2">
        <PageButton
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          aria-label={t.pgPrev}
        >
          ‹
        </PageButton>
        {pages.map((n) => (
          <PageButton key={n} active={n === page} onClick={() => onPage(n)}>
            {n}
          </PageButton>
        ))}
        <PageButton
          onClick={() => onPage(page + 1)}
          disabled={page >= pageCount}
          aria-label={t.pgNext}
        >
          ›
        </PageButton>
      </div>
    </div>
  );
}

export function FitToWorkHistory() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const listHref = `/fit-to-work`;

  const today = isoDate(new Date());

  const [fhOp, setFhOp] = React.useState(searchParams.get("nik") ?? "");
  const [q, setQ] = React.useState("");
  const [cat, setCat] = React.useState("");
  const [shift, setShift] = React.useState("");
  const [d1, setD1] = React.useState(daysAgo(today, MAX_SPAN_DAYS));
  const [d2, setD2] = React.useState(today);
  const [per, setPer] = React.useState("10");
  const [page, setPage] = React.useState(1);

  const spanOk = d1 <= d2 && spanDays(d1, d2) <= MAX_SPAN_DAYS;
  const listQ = useQuery({ ...ftwQueryOptions(d1, d2), enabled: spanOk });
  const all = React.useMemo(() => listQ.data?.rows ?? [], [listQ.data]);

  /** Everyone the fetched window has seen — the operator dropdown's options. */
  const operators = React.useMemo(() => {
    const byNik = new Map<string, string>();
    for (const row of all)
      if (!byNik.has(row.nik)) byNik.set(row.nik, row.name);
    return [...byNik.entries()]
      .map(([nik, name]) => ({ nik, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [all]);

  const shiftOptions = React.useMemo(
    () => [...new Set(all.flatMap((r) => (r.shift ? [r.shift] : [])))].sort(),
    [all]
  );

  const selectedOp = operators.find((o) => o.nik === fhOp);

  const catLabel: Record<FtwCatKey, string> = {
    fit: t.bFit,
    istirahat: t.ftwStatKurang,
    tidak: "Tidak Boleh Bekerja",
    belum: t.ftwStatBelum,
  };

  const loc = lang === "en" ? "en-GB" : "id-ID";
  const dLabel = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(loc, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

  const needle = q.trim().toLowerCase();
  const rows = all.filter((r) => {
    if (fhOp && r.nik !== fhOp) return false;
    if (shift && r.shift !== shift) return false;
    if (cat && ftwCatOf(r.sleepCategory) !== cat) return false;
    if (!needle) return true;
    return r.name.toLowerCase().includes(needle) || r.nik.includes(needle);
  });

  const perN = parseInt(per, 10);
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / perN));
  const cur = Math.min(page, pageCount);
  const shown = rows.slice((cur - 1) * perN, cur * perN);
  const start = total === 0 ? 0 : (cur - 1) * perN + 1;
  const end = Math.min(total, cur * perN);

  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        title={t.ftwHistPage}
        sub={
          selectedOp ? `${selectedOp.name} — NIK ${selectedOp.nik}` : t.fhSubAll
        }
      >
        <Button variant="ghost" onClick={() => router.push(listHref)}>
          <ArrowLeft />
          {t.backFtw}
        </Button>
      </PageTitle>

      <Panel>
        <Toolbar>
          <ToolbarTitle>{t.ftwHistTitle}</ToolbarTitle>
          <ToolbarGroup>
            <SearchInput
              className="w-[240px]"
              placeholder={t.searchEmp}
              aria-label={t.searchEmp}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
            <Select
              wrapperClassName="w-[250px]"
              value={fhOp}
              onChange={(e) => {
                setFhOp(e.target.value);
                setPage(1);
              }}
              aria-label={t.allOps}
            >
              <option value="">{t.allOps}</option>
              {operators.map((o) => (
                <option key={o.nik} value={o.nik}>
                  {o.name} — {o.nik}
                </option>
              ))}
            </Select>
            <Select
              wrapperClassName="w-[190px]"
              value={cat}
              onChange={(e) => {
                setCat(e.target.value);
                setPage(1);
              }}
              aria-label={t.allStatus}
            >
              <option value="">{t.allStatus}</option>
              {(Object.keys(catLabel) as FtwCatKey[]).map((key) => (
                <option key={key} value={key}>
                  {catLabel[key]}
                </option>
              ))}
            </Select>
            <Select
              wrapperClassName="w-[150px]"
              value={shift}
              onChange={(e) => {
                setShift(e.target.value);
                setPage(1);
              }}
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
                onChange={(e) => {
                  setD1(e.target.value);
                  setPage(1);
                }}
                aria-label={t.lblDate}
              />
              <span className="text-(--text-tertiary)">—</span>
              <Input
                type="date"
                className="w-40 font-mono"
                value={d2}
                onChange={(e) => {
                  setD2(e.target.value);
                  setPage(1);
                }}
                aria-label={t.lblDateTo}
              />
            </div>
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
        ) : shown.length ? (
          <div className="overflow-x-auto">
            <Table className="min-w-[1280px]">
              <TableHeader>
                <tr>
                  <TableHead>{t.lblDate}</TableHead>
                  <TableHead>{t.thOperator}</TableHead>
                  <TableHead>{t.thCompany}</TableHead>
                  <TableHead>{t.thDept}</TableHead>
                  <TableHead>{t.thPos}</TableHead>
                  <TableHead>{t.thShift}</TableHead>
                  <TableHead>{t.thSleep}</TableHead>
                  <TableHead>{t.thStatus}</TableHead>
                  <TableHead>FTW</TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {shown.map((r) => {
                  const rowCat = ftwCatOf(r.sleepCategory);
                  return (
                    <TableRow key={`${r.nik}-${r.date}`}>
                      <TableCell className="font-mono whitespace-nowrap">
                        {dLabel(r.date)}
                      </TableCell>
                      <TableCell>
                        <NameCell name={r.name} sub={r.nik} />
                      </TableCell>
                      <TableCell>{r.company ?? "—"}</TableCell>
                      <TableCell>{r.department ?? "—"}</TableCell>
                      <TableCell>{r.position ?? "—"}</TableCell>
                      <TableCell>{r.shift ?? "—"}</TableCell>
                      <TableCell className={ftwSleepClass(rowCat)}>
                        {ftwSleepText(r.sleepMinutes)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={FTW_CAT_BADGE[rowCat]} dot>
                          {r.sleepCategory ?? t.ftwStatBelum}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {r.ftwDecision ? (
                          <Badge variant={ftwDecisionBadge(r.ftwDecision)}>
                            {r.ftwDecision}
                          </Badge>
                        ) : (
                          "—"
                        )}
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
            {t.attSumA} <b>{`${start}–${end}`}</b> {t.attSumB} <b>{total}</b>{" "}
            {t.ftwSumLogs}
          </FootSum>
          <WindowPagination
            page={cur}
            pageCount={pageCount}
            onPage={setPage}
            per={per}
            onPer={(v) => {
              setPer(v);
              setPage(1);
            }}
          />
        </PanelFoot>
      </Panel>
    </div>
  );
}
