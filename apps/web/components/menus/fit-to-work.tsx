"use client";

import * as React from "react";
import Link from "next/link";
import { Search } from "lucide-react";

import type { AccessMode } from "@/lib/access";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useRole } from "@/components/providers/role-context";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
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

type StKey = "fit" | "kurang" | "belum";
type Strip = "ok" | "bad" | "na";
type Row = {
  nik: string;
  name: string;
  company: string;
  dept: string;
  pos: string;
  shift: "siang" | "malam";
  sleep: string;
  st: StKey;
  date: string; // ISO
  sendTime: string;
  hist: Strip[];
};

const sleepClass = (st: StKey) =>
  cn(
    "font-mono",
    st === "kurang" && "font-semibold text-(--color-danger-text)",
    st === "belum" && "text-(--text-tertiary)",
    st === "fit" && "text-(--text-secondary)"
  );

const STRIP_CLS: Record<Strip, string> = {
  ok: "bg-[rgba(23,206,100,.75)]",
  bad: "bg-[rgba(233,155,42,.85)]",
  na: "bg-(--fill-hover-strong)",
};

/* ---- static sample content ---- */
const UDU = "PT Unggul Dinamika Utama";
const ok7: Strip[] = ["ok", "ok", "ok", "ok", "ok", "ok", "ok"];
const ROWS: Row[] = [
  {
    nik: "OPS-0421",
    name: "Budi Santoso",
    company: UDU,
    dept: "Hauling",
    pos: "Driver OHT",
    shift: "siang",
    sleep: "7j 20m",
    st: "fit",
    date: "2026-07-21",
    sendTime: "04:41",
    hist: ok7,
  },
  {
    nik: "OPS-0388",
    name: "Andi Wijaya",
    company: UDU,
    dept: "Loading",
    pos: "Operator Excavator",
    shift: "siang",
    sleep: "3j 55m",
    st: "kurang",
    date: "2026-07-21",
    sendTime: "04:55",
    hist: ["ok", "ok", "bad", "ok", "ok", "bad", "bad"],
  },
  {
    nik: "OPS-0233",
    name: "Sari Lestari",
    company: UDU,
    dept: "Support",
    pos: "Admin Site",
    shift: "siang",
    sleep: "—",
    st: "belum",
    date: "2026-07-21",
    sendTime: "—",
    hist: ["ok", "ok", "ok", "ok", "ok", "ok", "na"],
  },
  {
    nik: "OPS-0510",
    name: "Rudi Hartono",
    company: UDU,
    dept: "Hauling",
    pos: "Driver OHT",
    shift: "siang",
    sleep: "6j 45m",
    st: "fit",
    date: "2026-07-21",
    sendTime: "04:38",
    hist: ok7,
  },
  {
    nik: "OPS-0367",
    name: "Hendra Gunawan",
    company: UDU,
    dept: "Loading",
    pos: "Operator Dozer",
    shift: "malam",
    sleep: "4j 10m",
    st: "kurang",
    date: "2026-07-21",
    sendTime: "16:12",
    hist: ["bad", "ok", "ok", "bad", "ok", "ok", "bad"],
  },
  {
    nik: "OPS-0455",
    name: "Fitri Handayani",
    company: UDU,
    dept: "Hauling",
    pos: "Checker",
    shift: "malam",
    sleep: "7j 05m",
    st: "fit",
    date: "2026-07-21",
    sendTime: "16:20",
    hist: ok7,
  },
  {
    nik: "OPS-0111",
    name: "Joko Prasetyo",
    company: UDU,
    dept: "Hauling",
    pos: "Driver OHT",
    shift: "siang",
    sleep: "7j 05m",
    st: "fit",
    date: "2026-07-20",
    sendTime: "04:47",
    hist: ok7,
  },
  {
    nik: "OPS-0290",
    name: "Dewi Anggraini",
    company: UDU,
    dept: "Support",
    pos: "Dispatcher",
    shift: "siang",
    sleep: "8j 10m",
    st: "fit",
    date: "2026-07-20",
    sendTime: "04:31",
    hist: ok7,
  },
  {
    nik: "OPS-0602",
    name: "Rina Marlina",
    company: UDU,
    dept: "SHE",
    pos: "Safety Officer",
    shift: "siang",
    sleep: "7j 40m",
    st: "fit",
    date: "2026-07-20",
    sendTime: "05:02",
    hist: ok7,
  },
];

export function FitToWorkMenu({ mode }: { mode: AccessMode }) {
  const { t, lang } = useI18n();
  const { role } = useRole();
  void mode; // log FTW bersifat baca; pelaporan ada di alur operator

  const [q, setQ] = React.useState("");
  const [st, setSt] = React.useState("");
  const [shift, setShift] = React.useState("");
  const [d1, setD1] = React.useState("2026-07-20");
  const [d2, setD2] = React.useState("2026-07-21");
  const [freshTime, setFreshTime] = React.useState("");

  React.useEffect(() => {
    const id = setTimeout(() => {
      const d = new Date();
      const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
      setFreshTime(`${pad(d.getHours())}:${pad(d.getMinutes())} WITA`);
    }, 0);
    return () => clearTimeout(id);
  }, []);

  const needle = q.trim().toLowerCase();
  const rows = ROWS.filter((r) => {
    if (r.date < d1 || r.date > d2) return false;
    if (shift && r.shift !== shift) return false;
    if (st && r.st !== st) return false;
    if (!needle) return true;
    return (
      r.name.toLowerCase().includes(needle) ||
      r.nik.includes(needle.toUpperCase())
    );
  }).sort((a, b) => b.date.localeCompare(a.date));
  const pg = usePagination(rows);

  const loc = lang === "en" ? "en-GB" : "id-ID";
  const dLabel = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(loc, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

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

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={t.navFtw} sub={t.ftwSub}>
        <Fresh>
          {t.dataAsOf}&nbsp;
          <b className="font-mono text-(--text-secondary)">{freshTime}</b>
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
              wrapperClassName="w-[170px]"
              value={st}
              onChange={(e) => setSt(e.target.value)}
              aria-label={t.allStatus}
            >
              <option value="">{t.allStatus}</option>
              <option value="belum">{t.ftwStatBelum}</option>
              <option value="kurang">{t.ftwStatKurang}</option>
              <option value="fit">{t.bFit}</option>
            </Select>
            <Select
              wrapperClassName="w-[150px]"
              value={shift}
              onChange={(e) => setShift(e.target.value)}
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
          </ToolbarGroup>
        </Toolbar>

        {pg.rows.length ? (
          <div className="overflow-x-auto">
            <Table className="min-w-[1280px]">
              <TableHeader>
                <tr>
                  <TableHead>{t.thOperator}</TableHead>
                  <TableHead>NIK</TableHead>
                  <TableHead>{t.thCompany}</TableHead>
                  <TableHead>{t.thDept}</TableHead>
                  <TableHead>{t.thPos}</TableHead>
                  <TableHead>{t.thShift}</TableHead>
                  <TableHead>{t.thSleep}</TableHead>
                  <TableHead>{t.thStatus}</TableHead>
                  <TableHead>{t.lblDate}</TableHead>
                  <TableHead>{t.thSendTime}</TableHead>
                  <TableHead>{t.thHist}</TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {pg.rows.map((r) => {
                  const bad = r.hist.filter((s) => s === "bad").length;
                  return (
                    <TableRow key={`${r.nik}-${r.date}`}>
                      <TableCell className="font-semibold">{r.name}</TableCell>
                      <TableCell className="font-mono text-(--text-secondary) tabular-nums">
                        {r.nik}
                      </TableCell>
                      <TableCell>{r.company}</TableCell>
                      <TableCell>{r.dept}</TableCell>
                      <TableCell>{r.pos}</TableCell>
                      <TableCell>
                        {r.shift === "malam" ? t.shiftNight : t.shiftDay}
                      </TableCell>
                      <TableCell className={sleepClass(r.st)}>
                        {r.sleep}
                      </TableCell>
                      <TableCell>{stBadge(r.st)}</TableCell>
                      <TableCell className="font-mono whitespace-nowrap">
                        {dLabel(r.date)}
                      </TableCell>
                      <TableCell className="font-mono">{r.sendTime}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {r.hist.map((s, i) => (
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
                          href={`/${role}/fit-to-work/history?nik=${r.nik}`}
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
