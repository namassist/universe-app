"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Download, Upload } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import { rosterGrid, upErrorRows } from "@/lib/roster-data";
import { Badge } from "@/components/ui/badge";
import { Button, Spinner } from "@/components/ui/button";
import { Dropzone } from "@/components/ui/dropzone";
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
import { Progress } from "@/components/ui/progress";
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

type Stage = "idle" | "progress" | "validating" | "results";

/**
 * Upload roster — static port. Progress & validasi disimulasikan (timer),
 * preview & hasil validasi dari data contoh; Import hanya toast.
 */
export function RosterUpload() {
  const { t, lang } = useI18n();
  const { pushToast } = useToast();
  const router = useRouter();
  const listHref = `/roster-data`;

  const [stage, setStage] = React.useState<Stage>("idle");
  const [pct, setPct] = React.useState(0);
  const [upName, setUpName] = React.useState("roster_juli_2026.xlsx");
  const [dragging, setDragging] = React.useState(false);
  const [importBusy, setImportBusy] = React.useState(false);

  const fileRef = React.useRef<HTMLInputElement>(null);
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startUpload = React.useCallback((name?: string) => {
    if (timerRef.current) clearInterval(timerRef.current);
    setUpName(name || "roster_juli_2026.xlsx");
    setStage("progress");
    setPct(0);
    timerRef.current = setInterval(() => {
      setPct((prev) => {
        const p = prev + 12 + Math.random() * 10;
        if (p >= 100) {
          if (timerRef.current) clearInterval(timerRef.current);
          timerRef.current = null;
          setStage("validating");
          setTimeout(() => setStage("results"), 700);
          return 100;
        }
        return p;
      });
    }, 150);
  }, []);

  function doImport() {
    setImportBusy(true);
    setTimeout(() => {
      setImportBusy(false);
      pushToast("success", t.toastImportT, t.toastImportD);
    }, 1200);
  }

  const preview = React.useMemo(() => rosterGrid(), []);
  const [qPrev, setQPrev] = React.useState("");
  const needlePrev = qPrev.trim().toLowerCase();
  const prevRows = preview.rows.filter(
    (r) =>
      !needlePrev ||
      r.name.toLowerCase().includes(needlePrev) ||
      r.nik.toLowerCase().includes(needlePrev)
  );
  const pgPrev = usePagination(prevRows);
  const errors = upErrorRows(lang);
  const [qErr, setQErr] = React.useState("");
  const needleErr = qErr.trim().toLowerCase();
  const errRows = errors.filter(
    (e) =>
      !needleErr ||
      e.nik.toLowerCase().includes(needleErr) ||
      e.emp.toLowerCase().includes(needleErr) ||
      e.issue.toLowerCase().includes(needleErr)
  );
  const pgErr = usePagination(errRows);

  /* Counted from the rows actually on screen rather than hardcoded. The chips
     used to read 2.140 / 3 / 5 while the tables below listed a different set
     entirely, so the summary contradicted the very data it summarised. */
  const dupCount = errors.filter((e) => e.badgeVariant === "warning").length;
  const errCount = errors.filter((e) => e.badgeVariant === "danger").length;
  const flagged = new Set(errors.map((e) => e.nik));
  const validCount = preview.rows.filter((r) => !flagged.has(r.nik)).length;

  const vchips = [
    {
      n: validCount,
      label: t.vValid,
      bg: "var(--badge-success-fill)",
      border: "var(--badge-success-border)",
      color: "var(--badge-success-text)",
    },
    {
      n: dupCount,
      label: t.vDup,
      bg: "var(--badge-warning-fill)",
      border: "var(--badge-warning-border)",
      color: "var(--badge-warning-text)",
    },
    {
      n: errCount,
      label: t.vErr,
      bg: "var(--badge-danger-fill)",
      border: "var(--badge-danger-border)",
      color: "var(--color-danger-text)",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={t.navR1} sub={t.upSub}>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => router.push(listHref)}>
            <ArrowLeft />
            {t.upBack}
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              pushToast("success", t.toastTemplateT, t.toastTemplateD)
            }
          >
            <Download />
            {t.upTemplate}
          </Button>
        </div>
      </PageTitle>

      <Panel>
        <Dropzone
          icon={<Upload />}
          title={t.dzTitle}
          hint={t.dzHint}
          aria-label={t.dzTitle}
          dragging={dragging}
          onDragChange={setDragging}
          onPick={() => fileRef.current?.click()}
          onDropFile={(name) => startUpload(name)}
        />
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={(e) => {
            const name = e.target.files?.[0]?.name;
            if (name) startUpload(name);
            e.target.value = "";
          }}
        />
        {stage === "progress" || stage === "validating" ? (
          <div className="mt-5">
            <div className="mb-2 flex justify-between text-sm">
              <span className="font-semibold">{upName}</span>
              <span className="font-mono text-(--text-secondary)">
                {Math.round(pct)}%
              </span>
            </div>
            <Progress value={pct} />
            <p className="mt-2 text-xs text-(--text-tertiary)">
              {stage === "validating" ? t.upValidating : t.upUploading}
            </p>
          </div>
        ) : null}
      </Panel>

      {stage === "results" ? (
        <div className="flex flex-col gap-6">
          <Panel>
            <Toolbar className="mb-4">
              <ToolbarTitle>
                {t.upPrevTitle} — {upName}
              </ToolbarTitle>
              <ToolbarGroup>
                <SearchInput
                  className="w-[240px]"
                  placeholder={t.searchEmp}
                  aria-label={t.searchEmp}
                  value={qPrev}
                  onChange={(e) => setQPrev(e.target.value)}
                />
                <span className="text-xs text-(--text-tertiary)">
                  {t.upPrevHint}
                </span>
              </ToolbarGroup>
            </Toolbar>
            <div className="overflow-x-auto pb-2">
              <Table className="min-w-[1600px]">
                <TableHeader>
                  <tr>
                    <TableHead className="w-[110px]">NIK</TableHead>
                    <TableHead className="w-[190px]">{t.thNama}</TableHead>
                    {preview.days.map((d) => (
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
                  {pgPrev.rows.map((r) => (
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
                {t.upPrevA} <b>{pgPrev.range}</b> {t.attSumB}{" "}
                <b>{pgPrev.total}</b> {t.upPrevB}
              </FootSum>
              <Pagination
                page={pgPrev.page}
                pageCount={pgPrev.pageCount}
                onPage={pgPrev.setPage}
                per={pgPrev.per}
                perOptions={["10", "25", "50"]}
                onPer={pgPrev.setPer}
              />
            </PanelFoot>
          </Panel>

          <Panel>
            <Toolbar className="mb-4">
              <ToolbarTitle>
                {t.upResults} — {upName}
              </ToolbarTitle>
              <ToolbarGroup>
                <SearchInput
                  className="w-[240px]"
                  placeholder={t.searchEmp}
                  aria-label={t.searchEmp}
                  value={qErr}
                  onChange={(e) => setQErr(e.target.value)}
                />
              </ToolbarGroup>
            </Toolbar>
            <div className="mb-5 flex flex-wrap gap-3">
              {vchips.map((c) => (
                <div
                  key={c.label}
                  className="flex min-w-[180px] flex-1 items-center gap-3 rounded-card border px-4 py-3"
                  style={{ background: c.bg, borderColor: c.border }}
                >
                  <div>
                    <div
                      className="text-xl font-bold tabular-nums"
                      style={{ color: c.color }}
                    >
                      {c.n}
                    </div>
                    <div className="text-xs" style={{ color: c.color }}>
                      {c.label}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <Table>
              <TableHeader>
                <tr>
                  <TableHead className="w-[90px]">{t.thRow}</TableHead>
                  <TableHead>NIK</TableHead>
                  <TableHead>{t.thEmp}</TableHead>
                  <TableHead>{t.thIssue}</TableHead>
                  <TableHead>{t.thType}</TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {pgErr.rows.map((e) => (
                  <TableRow key={e.row}>
                    <TableCell className="font-mono">{e.row}</TableCell>
                    <TableCell className="font-mono">{e.nik}</TableCell>
                    <TableCell>{e.emp}</TableCell>
                    <TableCell>{e.issue}</TableCell>
                    <TableCell>
                      <Badge variant={e.badgeVariant} dot>
                        {e.badge}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <PanelFoot>
              <FootSum>{t.upFootNote}</FootSum>
              <div className="flex flex-wrap items-center gap-4">
                <Pagination
                  page={pgErr.page}
                  pageCount={pgErr.pageCount}
                  onPage={pgErr.setPage}
                  per={pgErr.per}
                  perOptions={["10", "25", "50"]}
                  onPer={pgErr.setPer}
                />
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    onClick={() =>
                      pushToast("success", t.toastErrT, t.toastErrD)
                    }
                  >
                    <Download />
                    {t.upDlErrors}
                  </Button>
                  {/* Says how many rows it is about to import, so the button
                      and the summary above it cannot disagree. */}
                  <Button onClick={doImport} disabled={importBusy}>
                    {importBusy ? <Spinner /> : null}
                    {importBusy
                      ? t.upImporting
                      : `${t.upImport} ${validCount} ${t.upRowsValid}`}
                  </Button>
                </div>
              </div>
            </PanelFoot>
          </Panel>
        </div>
      ) : null}

      <RosterLegend />
    </div>
  );
}
