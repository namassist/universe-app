"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, Eye, Search, Upload } from "lucide-react";

import type { AccessMode } from "@/lib/access";
import { useI18n } from "@/lib/i18n";
import { ROSTER_DOCS } from "@/lib/roster-data";
import { useRole } from "@/components/providers/role-context";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
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
import { useToast } from "@/components/ui/toast";

export function RosterDataMenu({ mode }: { mode: AccessMode }) {
  const { t, lang } = useI18n();
  const { pushToast } = useToast();
  const { role } = useRole();
  const router = useRouter();
  const base = `/${role}/roster-data`;
  const canW = mode === "manage";

  const [month, setMonth] = React.useState("");
  const [dept, setDept] = React.useState("");
  const [q, setQ] = React.useState("");
  const [st, setSt] = React.useState("");

  const depts = Array.from(new Set(ROSTER_DOCS.map((r) => r.dept))).sort();
  const monthNames = React.useMemo(() => {
    const loc = lang === "en" ? "en-GB" : "id-ID";
    return Array.from({ length: 12 }, (_, i) =>
      new Date(2026, i, 1).toLocaleDateString(loc, { month: "long" })
    );
  }, [lang]);

  const rows = ROSTER_DOCS.filter((r) => {
    if (st && r.status !== st) return false;
    if (dept && r.dept !== dept) return false;
    if (month && r.month.slice(5) !== month) return false;
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return (
      r.label.toLowerCase().includes(needle) ||
      r.file.toLowerCase().includes(needle) ||
      r.dept.toLowerCase().includes(needle) ||
      r.by.toLowerCase().includes(needle)
    );
  });
  const pg = usePagination(rows);

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={t.navRD} sub={t.rdSub}>
        {canW ? (
          <Button onClick={() => router.push(`${base}/upload`)}>
            <Upload />
            {t.rdUpload}
          </Button>
        ) : null}
      </PageTitle>

      <Panel>
        <Toolbar>
          <ToolbarTitle>{t.rdListTitle}</ToolbarTitle>
          <ToolbarGroup>
            <SearchInput
              className="w-[240px]"
              placeholder={t.rdSearchPh}
              aria-label={t.rdSearchPh}
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
              {depts.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
            <Select
              aria-label={t.allStatus}
              wrapperClassName="w-[170px]"
              value={st}
              onChange={(e) => setSt(e.target.value)}
            >
              <option value="">{t.allStatus}</option>
              <option value="aktif">{t.stAktif}</option>
              <option value="arsip">{t.stArsip}</option>
            </Select>
            <Select
              aria-label={t.lblMonth}
              wrapperClassName="w-[160px]"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            >
              <option value="">{t.allMonths}</option>
              {monthNames.map((m, i) => (
                <option key={m} value={String(i + 1).padStart(2, "0")}>
                  {m}
                </option>
              ))}
            </Select>
          </ToolbarGroup>
        </Toolbar>

        {rows.length ? (
          <Table>
            <TableHeader>
              <tr>
                <TableHead>{t.thPeriod}</TableHead>
                <TableHead>{t.thDept}</TableHead>
                <TableHead className="max-xl:hidden">{t.thUploaded}</TableHead>
                <TableHead>{t.thEmpN}</TableHead>
                <TableHead>{t.thRows}</TableHead>
                <TableHead>{t.thStatus}</TableHead>
                <TableHead>{t.thAct}</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {pg.rows.map((r) => (
                <TableRow key={r.key}>
                  <TableCell>
                    <NameCell name={r.label} sub={r.file} />
                  </TableCell>
                  <TableCell>{r.dept}</TableCell>
                  <TableCell className="max-xl:hidden">
                    <NameCell
                      name={<span className="font-medium">{r.by}</span>}
                      sub={r.date}
                    />
                  </TableCell>
                  <TableCell className="font-mono">{r.emp}</TableCell>
                  <TableCell className="font-mono">{r.rows}</TableCell>
                  <TableCell>
                    <Badge
                      variant={r.status === "aktif" ? "success" : "neutral"}
                      dot
                    >
                      {r.status === "aktif" ? t.stAktif : t.stArsip}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/${role}/attendance`}
                        className="text-sm whitespace-nowrap"
                      >
                        {t.rdView}
                      </Link>
                      <IconButton
                        aria-label={t.rdDetail}
                        onClick={() =>
                          pushToast("success", t.rdDetail, r.label)
                        }
                      >
                        <Eye />
                      </IconButton>
                      <IconButton
                        aria-label={t.rdDl}
                        onClick={() => pushToast("success", t.rdDlT, r.file)}
                      >
                        <Download />
                      </IconButton>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <StateBox
            icon={<Search className="text-(--color-primary-bright)" />}
            title={t.noResTitle}
            body={t.rdEmptyB}
          />
        )}

        <PanelFoot>
          <FootSum>
            {t.attSumA} <b>{pg.range}</b> {t.attSumB} <b>{pg.total}</b>{" "}
            {t.rdSumB}
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
