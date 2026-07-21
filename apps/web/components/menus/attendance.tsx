"use client";

import * as React from "react";
import { Download, Search } from "lucide-react";

import type { AccessMode } from "@/lib/access";
import { useI18n } from "@/lib/i18n";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
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
import { useToast } from "@/components/ui/toast";

type AttStatus = "hadir" | "terlambat" | "belum" | "unfit" | "off";
type Row = {
  nik: string;
  name: string;
  date: string; // ISO
  dept: string;
  code: string | null;
  checkin?: string;
  checkout?: string;
  status: AttStatus;
};

const stBadge: Record<AttStatus, BadgeVariant> = {
  hadir: "success",
  terlambat: "warning",
  belum: "neutral",
  unfit: "danger",
  off: "neutral",
};

/* ---- static sample content ---- */
const ROWS: Row[] = [
  {
    nik: "OPS-0421",
    name: "Budi Santoso",
    date: "2026-07-21",
    dept: "Operation",
    code: "P-2",
    checkin: "05:42",
    checkout: undefined,
    status: "hadir",
  },
  {
    nik: "OPS-0388",
    name: "Andi Wijaya",
    date: "2026-07-21",
    dept: "Operation",
    code: "P-1",
    checkin: "06:05",
    checkout: undefined,
    status: "terlambat",
  },
  {
    nik: "OPS-0510",
    name: "Rudi Hartono",
    date: "2026-07-21",
    dept: "Operation",
    code: "P-2",
    status: "belum",
  },
  {
    nik: "OPS-0233",
    name: "Sari Lestari",
    date: "2026-07-21",
    dept: "HRGA",
    code: "P-1",
    checkin: "06:48",
    checkout: undefined,
    status: "hadir",
  },
  {
    nik: "OPS-0367",
    name: "Hendra Gunawan",
    date: "2026-07-21",
    dept: "Operation",
    code: "P-1",
    status: "unfit",
  },
  {
    nik: "OPS-0129",
    name: "Agus Salim",
    date: "2026-07-21",
    dept: "Plant",
    code: null,
    status: "off",
  },
  {
    nik: "OPS-0290",
    name: "Dewi Anggraini",
    date: "2026-07-20",
    dept: "SDI",
    code: "P-1",
    checkin: "06:31",
    checkout: "17:04",
    status: "hadir",
  },
  {
    nik: "OPS-0455",
    name: "Fitri Handayani",
    date: "2026-07-20",
    dept: "Operation",
    code: "M-1",
    checkin: "17:20",
    checkout: "05:55",
    status: "hadir",
  },
  {
    nik: "OPS-0602",
    name: "Rina Marlina",
    date: "2026-07-20",
    dept: "HRGA",
    code: "P-1",
    checkin: "07:12",
    checkout: "16:58",
    status: "terlambat",
  },
  {
    nik: "OPS-0111",
    name: "Joko Prasetyo",
    date: "2026-07-20",
    dept: "Operation",
    code: "P-2",
    checkin: "05:38",
    checkout: "16:40",
    status: "hadir",
  },
];

export function AttendanceMenu({ mode }: { mode: AccessMode }) {
  const { t, lang } = useI18n();
  const { pushToast } = useToast();
  void mode; // log absensi bersifat baca; ekspor tersedia untuk semua

  const [from, setFrom] = React.useState("2026-07-20");
  const [to, setTo] = React.useState("2026-07-21");
  const [status, setStatus] = React.useState("");
  const [dept, setDept] = React.useState("");
  const [q, setQ] = React.useState("");
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
    if (r.date < from || r.date > to) return false;
    if (status && r.status !== status) return false;
    if (dept && r.dept !== dept) return false;
    if (!needle) return true;
    return (
      r.name.toLowerCase().includes(needle) ||
      r.nik.toLowerCase().includes(needle)
    );
  });
  const pg = usePagination(rows);
  const presentN = rows.filter(
    (r) => r.status === "hadir" || r.status === "terlambat"
  ).length;

  const loc = lang === "en" ? "en-GB" : "id-ID";
  const dLabel = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(loc, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

  const stLabel = (s: AttStatus) =>
    s === "hadir"
      ? t.bHadir
      : s === "terlambat"
        ? t.bLate
        : s === "belum"
          ? t.bBelum
          : s === "unfit"
            ? t.bUnfit
            : t.bOff;

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
          <b className="font-mono text-(--text-secondary)">{freshTime}</b>
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
              aria-label={t.allStatus}
              wrapperClassName="w-[170px]"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">{t.allStatus}</option>
              <option value="hadir">{t.bHadir}</option>
              <option value="terlambat">{t.bLate}</option>
              <option value="belum">{t.bBelum}</option>
              <option value="unfit">{t.bUnfit}</option>
              <option value="off">{t.bOff}</option>
            </Select>
            <Select
              aria-label={t.allDepts}
              wrapperClassName="w-[180px]"
              value={dept}
              onChange={(e) => setDept(e.target.value)}
            >
              <option value="">{t.allDepts}</option>
              <option>Operation</option>
              <option>SDI</option>
              <option>HRGA</option>
              <option>Plant</option>
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
            <Button
              variant="secondary"
              onClick={() =>
                pushToast("success", t.toastExportT, t.toastExportD)
              }
            >
              <Download />
              {t.export}
            </Button>
          </ToolbarGroup>
        </Toolbar>

        {rows.length ? (
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
                <TableHead>{t.thStatus}</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {pg.rows.map((r, i) => (
                <TableRow key={`${r.nik}-${r.date}-${i}`}>
                  <TableCell className="font-semibold">{r.name}</TableCell>
                  <TableCell className="font-mono text-(--text-secondary) tabular-nums">
                    {r.nik}
                  </TableCell>
                  <TableCell className="font-mono whitespace-nowrap">
                    {dLabel(r.date)}
                  </TableCell>
                  <TableCell className="max-xl:hidden">{r.dept}</TableCell>
                  <TableCell>
                    <Badge variant="info">{r.code ?? "–"}</Badge>
                  </TableCell>
                  <TableCell>
                    <IOCell time={r.checkin} />
                  </TableCell>
                  <TableCell>
                    <IOCell time={r.checkout} />
                  </TableCell>
                  <TableCell>
                    <Badge variant={stBadge[r.status]} dot>
                      {stLabel(r.status)}
                    </Badge>
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
