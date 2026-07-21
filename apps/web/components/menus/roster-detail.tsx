"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import { findRosterDoc, rosterGrid } from "@/lib/roster-data";
import { useRole } from "@/components/providers/role-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";

import { RosterLegend } from "./roster-legend";

/** Detail roster — grid kode harian satu dokumen (?p= = kunci dokumen). */
export function RosterDetail() {
  const { t, lang } = useI18n();
  const { pushToast } = useToast();
  const { role } = useRole();
  const router = useRouter();
  const listHref = `/${role}/roster-data`;

  const key = useSearchParams().get("p");
  const doc = findRosterDoc(key);

  const monShort = new Date(`${doc.month}-01T00:00:00`).toLocaleDateString(
    lang === "en" ? "en-GB" : "id-ID",
    { month: "short" }
  );
  const grid = React.useMemo(
    () => rosterGrid(doc.month, monShort),
    [doc.month, monShort]
  );

  const [q, setQ] = React.useState("");
  const needle = q.trim().toLowerCase();
  const rows = grid.rows.filter(
    (r) =>
      !needle ||
      r.name.toLowerCase().includes(needle) ||
      r.nik.toLowerCase().includes(needle)
  );
  const pg = usePagination(rows);

  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        title={`${t.rdDetailTitle} — ${doc.label} · ${doc.dept}`}
        sub={t.rdDetailSub}
      >
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => router.push(listHref)}>
            <ArrowLeft />
            {t.upBack}
          </Button>
          <Button
            variant="secondary"
            onClick={() => pushToast("success", t.rdDlT, doc.file)}
          >
            <Download />
            {t.rdDl}
          </Button>
        </div>
      </PageTitle>

      <Panel>
        <Toolbar className="mb-4">
          <ToolbarTitle>{doc.file}</ToolbarTitle>
          <ToolbarGroup>
            <SearchInput
              className="w-[240px]"
              placeholder={t.searchEmp}
              aria-label={t.searchEmp}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <span className="text-xs text-(--text-tertiary)">
              {doc.emp} {t.thEmpN.toLowerCase()} · {doc.rows}{" "}
              {t.thRows.toLowerCase()} · {doc.by} · {doc.date}
            </span>
            <Badge variant={doc.status === "aktif" ? "success" : "neutral"} dot>
              {doc.status === "aktif" ? t.stAktif : t.stArsip}
            </Badge>
          </ToolbarGroup>
        </Toolbar>
        <div className="overflow-x-auto pb-2">
          <Table className="min-w-[1600px]">
            <TableHeader>
              <tr>
                <TableHead className="w-[110px]">NIK</TableHead>
                <TableHead className="w-[190px]">{t.thNama}</TableHead>
                {grid.days.map((d) => (
                  <TableHead
                    key={d}
                    className="px-1.5 py-3 text-center font-mono"
                  >
                    {d}
                  </TableHead>
                ))}
              </tr>
            </TableHeader>
            <TableBody>
              {pg.rows.map((r) => (
                <TableRow key={r.nik}>
                  <TableCell className="font-mono whitespace-nowrap">
                    {r.nik}
                  </TableCell>
                  <TableCell className="font-semibold whitespace-nowrap">
                    {r.name}
                  </TableCell>
                  {r.codes.map((c, i) => (
                    <TableCell
                      key={i}
                      className="px-1.5 py-3 text-center font-mono text-xs"
                      style={{ color: c.color }}
                    >
                      {c.v}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <PanelFoot>
          <FootSum>
            {t.rdSumA} <b>{pg.range}</b> {t.rdDetailFootB}
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

      <RosterLegend />
    </div>
  );
}
