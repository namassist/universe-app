"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Search } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
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

type StKey = "fit" | "kurang" | "belum";
type Row = {
  nik: string;
  name: string;
  company: string;
  dept: string;
  pos: string;
  shift: "siang" | "malam";
  st: StKey;
  sleepMin: number;
  date: string; // ISO
};

const UDU = "PT Unggul Dinamika Utama";
const CREW = [
  { nik: "OPS-0421", name: "Budi Santoso", dept: "Hauling", pos: "Driver OHT" },
  {
    nik: "OPS-0388",
    name: "Andi Wijaya",
    dept: "Loading",
    pos: "Operator Excavator",
  },
  { nik: "OPS-0510", name: "Rudi Hartono", dept: "Hauling", pos: "Driver OHT" },
  {
    nik: "OPS-0111",
    name: "Joko Prasetyo",
    dept: "Hauling",
    pos: "Driver OHT",
  },
  {
    nik: "OPS-0367",
    name: "Hendra Gunawan",
    dept: "Loading",
    pos: "Operator Dozer",
  },
  { nik: "OPS-0455", name: "Fitri Handayani", dept: "Hauling", pos: "Checker" },
] as const;

const sleepClass = (st: StKey) =>
  cn(
    "font-mono",
    st === "kurang" && "font-semibold text-(--color-danger-text)",
    st === "belum" && "text-(--text-tertiary)",
    st === "fit" && "text-(--text-secondary)"
  );

function isoAddDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function sleepLabel(m: number, lang: string): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return lang === "en" ? `${h}h ${mm}m` : `${h}j ${mm}m`;
}

/**
 * Riwayat FTW 90 hari — dibangkitkan deterministik per (nik, tanggal) supaya
 * stabil antar render: pola shift per paritas NIK, tidur bervariasi, sisipan
 * "kurang tidur" & "belum lapor" berkala. OFF (2 hari/minggu) dilewati.
 */
function historyRows(d1: string, d2: string): Row[] {
  const rows: Row[] = [];
  if (!d1 || !d2 || d1 > d2) return rows;
  let guard = 0;
  for (let iso = d2; iso >= d1 && guard < 120; iso = isoAddDays(iso, -1)) {
    guard++;
    const dayN = Math.floor(new Date(`${iso}T00:00:00`).getTime() / 86400000);
    CREW.forEach((c, i) => {
      const off = (dayN + i) % 7 >= 5; // 2 hari OFF bergilir per minggu
      if (off) return;
      const h = (dayN * 31 + i * 17) % 100;
      const st: StKey =
        h % 19 === 0 ? "kurang" : h % 23 === 0 ? "belum" : "fit";
      const sleepMin =
        st === "kurang" ? 200 + (h % 5) * 15 : 380 + ((h * 13) % 160);
      rows.push({
        nik: c.nik,
        name: c.name,
        company: UDU,
        dept: c.dept,
        pos: c.pos,
        shift: Number(c.nik.slice(-1)) % 2 === 0 ? "siang" : "malam",
        st,
        sleepMin: st === "belum" ? 0 : sleepMin,
        date: iso,
      });
    });
  }
  return rows;
}

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

  const todayIso = "2026-07-21";
  const startIso = "2026-04-22";

  const [fhOp, setFhOp] = React.useState(searchParams.get("nik") ?? "");
  const [q, setQ] = React.useState("");
  const [st, setSt] = React.useState("");
  const [shift, setShift] = React.useState("");
  const [d1, setD1] = React.useState(startIso);
  const [d2, setD2] = React.useState(todayIso);
  const [per, setPer] = React.useState("10");
  const [page, setPage] = React.useState(1);

  const selectedOp = CREW.find((o) => o.nik === fhOp);

  const stBadge = (key: StKey) => {
    const map: Record<StKey, { v: BadgeVariant; l: string }> = {
      fit: { v: "success", l: t.bFit },
      kurang: { v: "warning", l: t.ftwStatKurang },
      belum: { v: "neutral", l: t.ftwStatBelum },
    };
    return (
      <Badge variant={map[key].v} dot>
        {map[key].l}
      </Badge>
    );
  };

  const loc = lang === "en" ? "en-GB" : "id-ID";
  const dLabel = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(loc, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

  const needle = q.trim().toLowerCase();
  const all = React.useMemo(() => historyRows(d1, d2), [d1, d2]);
  const rows = all.filter((r) => {
    if (fhOp && r.nik !== fhOp) return false;
    if (shift && r.shift !== shift) return false;
    if (st && r.st !== st) return false;
    if (!needle) return true;
    return (
      r.name.toLowerCase().includes(needle) ||
      r.nik.toLowerCase().includes(needle)
    );
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
              {CREW.map((o) => (
                <option key={o.nik} value={o.nik}>
                  {o.name} — {o.nik}
                </option>
              ))}
            </Select>
            <Select
              wrapperClassName="w-[160px]"
              value={st}
              onChange={(e) => {
                setSt(e.target.value);
                setPage(1);
              }}
              aria-label={t.allStatus}
            >
              <option value="">{t.allStatus}</option>
              <option value="belum">{t.ftwStatBelum}</option>
              <option value="kurang">{t.ftwStatKurang}</option>
              <option value="fit">{t.bFit}</option>
            </Select>
            <Select
              wrapperClassName="w-[140px]"
              value={shift}
              onChange={(e) => {
                setShift(e.target.value);
                setPage(1);
              }}
              aria-label={t.allShift}
            >
              <option value="">{t.allShift}</option>
              <option value="siang">{t.shiftDay}</option>
              <option value="malam">{t.shiftNight}</option>
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

        {shown.length ? (
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
                </tr>
              </TableHeader>
              <TableBody>
                {shown.map((r) => (
                  <TableRow key={`${r.nik}-${r.date}`}>
                    <TableCell className="font-mono whitespace-nowrap">
                      {dLabel(r.date)}
                    </TableCell>
                    <TableCell>
                      <NameCell name={r.name} sub={r.nik} />
                    </TableCell>
                    <TableCell>{r.company}</TableCell>
                    <TableCell>{r.dept}</TableCell>
                    <TableCell>{r.pos}</TableCell>
                    <TableCell>
                      {r.shift === "malam" ? t.shiftNight : t.shiftDay}
                    </TableCell>
                    <TableCell className={sleepClass(r.st)}>
                      {r.st === "belum" ? "—" : sleepLabel(r.sleepMin, lang)}
                    </TableCell>
                    <TableCell>{stBadge(r.st)}</TableCell>
                  </TableRow>
                ))}
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
