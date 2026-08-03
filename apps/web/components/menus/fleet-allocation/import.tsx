"use client";

import * as React from "react";
import { notFound, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, Upload } from "lucide-react";

import type { PlanImportPreview } from "@universe/contracts";

import { api, errorMessage, fetchBlob } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { planBoardKey } from "@/lib/queries/fleet-allocation";
import { useRole } from "@/components/providers/role-context";
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

type Stage = "idle" | "uploading" | "validating" | "results";

const LIST_HREF = "/fleet-allocation";

const KIND_BADGE = {
  new: "success",
  moved: "warning",
  unchanged: "neutral",
} as const;

/**
 * Bulk PLAN pairing, following the shape `um-users-import.tsx` established:
 * template → dropzone → server-side validation preview → explicit commit.
 * One `unit, nik` row per pairing; the API refuses with the same rules the
 * assignment dialog goes through, and a re-upload that reassigns an operator
 * previews as a *move* naming the unit they leave.
 */
export function PlanImport() {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const { access } = useRole();
  const router = useRouter();

  const [stage, setStage] = React.useState<Stage>("idle");

  const [pct, setPct] = React.useState(0);
  const [file, setFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<PlanImportPreview | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [fatal, setFatal] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const [qPrev, setQPrev] = React.useState("");
  const [qErr, setQErr] = React.useState("");

  const plan = api.v1["fleet-allocation"].plan;

  async function downloadTemplate() {
    let blob: Blob;
    try {
      // fetchBlob, not Eden — Treaty decodes an unrecognised body as text,
      // which mangles the workbook past recovery.
      blob = await fetchBlob("/v1/fleet-allocation/plan/import/template");
    } catch (error) {
      pushToast(
        "error",
        t.upTemplate,
        error instanceof Error ? error.message : t.loginErr
      );
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "template_plan.xlsx";
    a.click();
    URL.revokeObjectURL(url);
    pushToast("success", t.toastTemplateT, t.faImpTplD);
  }

  async function validate(picked: File) {
    setFile(picked);
    setPreview(null);
    setFatal(null);
    setStage("uploading");
    setPct(15);

    const timer = setInterval(() => setPct((p) => (p < 85 ? p + 10 : p)), 120);
    const { data, error } = await plan.import.validate.post({ file: picked });
    clearInterval(timer);
    setPct(100);

    if (error || !data) {
      setStage("idle");
      setFatal(errorMessage(error, t.loginErr));
      return;
    }
    setStage("validating");
    setPreview(data as PlanImportPreview);
    setTimeout(() => setStage("results"), 300);
  }

  async function commit() {
    if (!file) return;
    setBusy(true);
    const { data, error } = await plan.import.commit.post({ file });
    setBusy(false);
    if (error || !data) {
      pushToast("error", t.upImport, errorMessage(error, t.loginErr));
      return;
    }
    await queryClient.invalidateQueries({ queryKey: planBoardKey });
    pushToast(
      "success",
      t.faImpDoneT,
      `${data.created} ${t.umImpCreated} · ${data.moved} ${t.faImpMovedN}`
    );
    setStage("idle");
    setPreview(null);
    setFile(null);
    router.push(LIST_HREF);
  }

  const prevRows = (preview?.rows ?? []).filter((r) => {
    const needle = qPrev.trim().toLowerCase();
    return (
      !needle ||
      r.unit.toLowerCase().includes(needle) ||
      r.nik.toLowerCase().includes(needle) ||
      r.name.toLowerCase().includes(needle)
    );
  });
  const pgPrev = usePagination(prevRows);

  const errRows = (preview?.errors ?? []).filter((e) => {
    const needle = qErr.trim().toLowerCase();
    return (
      !needle ||
      e.nik.toLowerCase().includes(needle) ||
      e.emp.toLowerCase().includes(needle) ||
      e.issue.toLowerCase().includes(needle)
    );
  });
  const pgErr = usePagination(errRows);

  const chips = preview
    ? [
        {
          n: preview.newCount,
          label: t.umImpNew,
          bg: "var(--badge-success-fill)",
          border: "var(--badge-success-border)",
          color: "var(--badge-success-text)",
        },
        {
          n: preview.movedCount,
          label: t.faImpMoved,
          bg: "var(--badge-warning-fill)",
          border: "var(--badge-warning-border)",
          color: "var(--badge-warning-text)",
        },
        {
          n: preview.unchangedCount,
          label: t.faImpUnchanged,
          bg: "var(--badge-neutral-fill)",
          border: "var(--badge-neutral-border)",
          color: "var(--badge-neutral-text)",
        },
        {
          n: preview.errorCount,
          label: t.umImpErr,
          bg: "var(--badge-danger-fill)",
          border: "var(--badge-danger-border)",
          color: "var(--color-danger-text)",
        },
      ]
    : [];

  /* Presentation only — the API refuses every import endpoint without
     `manage` on the fleet-allocation menu regardless of what this renders. */
  if (access("fleet-allocation") !== "manage") notFound();

  const kindLabel = (kind: "new" | "moved" | "unchanged") =>
    kind === "new"
      ? t.umImpNew
      : kind === "moved"
        ? t.faImpMoved
        : t.faImpUnchanged;

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={t.faImpTitle} sub={t.faImpSub}>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => router.push(LIST_HREF)}>
            <ArrowLeft />
            {t.faImpBack}
          </Button>
          <Button variant="secondary" onClick={downloadTemplate}>
            <Download />
            {t.upTemplate}
          </Button>
        </div>
      </PageTitle>

      <Panel>
        <Dropzone
          icon={<Upload />}
          title={t.faImpDzTitle}
          hint={t.faImpHint}
          aria-label={t.faImpDzTitle}
          dragging={dragging}
          onDragChange={setDragging}
          onPick={() => fileRef.current?.click()}
          onDropFile={() => fileRef.current?.click()}
        />
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={(e) => {
            const picked = e.target.files?.[0];
            if (picked) void validate(picked);
            e.target.value = "";
          }}
        />

        {stage === "uploading" || stage === "validating" ? (
          <div className="mt-5">
            <div className="mb-2 flex justify-between text-sm">
              <span className="font-semibold">{file?.name}</span>
              <span className="font-mono text-(--text-secondary)">
                {Math.round(pct)}%
              </span>
            </div>
            <Progress value={pct} />
            <p className="mt-2 text-xs text-(--text-tertiary)">
              {stage === "validating" ? t.umImpValidating : t.upUploading}
            </p>
          </div>
        ) : null}

        {fatal ? (
          <p
            role="alert"
            className="mt-4 rounded-control border border-(--badge-danger-border) bg-(--badge-danger-fill) px-3 py-2.5 text-xs text-(--color-danger-text)"
          >
            {fatal}
          </p>
        ) : null}
      </Panel>

      {stage === "results" && preview ? (
        <>
          <Panel>
            <Toolbar className="mb-4">
              <ToolbarTitle>
                {t.upPrevTitle} — {preview.fileName}
              </ToolbarTitle>
              <ToolbarGroup>
                <SearchInput
                  className="w-[240px]"
                  placeholder={t.searchOp}
                  aria-label={t.searchOp}
                  value={qPrev}
                  onChange={(e) => setQPrev(e.target.value)}
                />
              </ToolbarGroup>
            </Toolbar>

            <div className="mb-5 flex flex-wrap gap-3">
              {chips.map((c) => (
                <div
                  key={c.label}
                  className="flex min-w-[150px] flex-1 items-center gap-3 rounded-card border px-4 py-3"
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
                  <TableHead className="w-[80px]">{t.thRow}</TableHead>
                  <TableHead className="w-[120px]">{t.thType}</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>NIK</TableHead>
                  <TableHead>{t.thNama}</TableHead>
                  <TableHead>{t.faImpFrom}</TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {pgPrev.rows.map((r) => (
                  <TableRow key={r.row}>
                    <TableCell className="font-mono">{r.row}</TableCell>
                    <TableCell>
                      <Badge variant={KIND_BADGE[r.kind]} dot>
                        {kindLabel(r.kind)}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono font-semibold">
                      {r.unit}
                    </TableCell>
                    <TableCell className="font-mono">{r.nik}</TableCell>
                    <TableCell className="font-semibold">{r.name}</TableCell>
                    {/* A move names the unit it empties — the reassignment
                        is visible before it happens, never after. */}
                    <TableCell className="font-mono text-(--text-secondary)">
                      {r.fromUnit ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <PanelFoot>
              <FootSum>
                {t.attSumA} <b>{pgPrev.range}</b> {t.attSumB}{" "}
                <b>{pgPrev.total}</b> {t.umImpPrevB}
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
              <ToolbarTitle>{t.upResults}</ToolbarTitle>
              <ToolbarGroup>
                <SearchInput
                  className="w-[240px]"
                  placeholder={t.searchOp}
                  aria-label={t.searchOp}
                  value={qErr}
                  onChange={(e) => setQErr(e.target.value)}
                />
              </ToolbarGroup>
            </Toolbar>
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
                  <TableRow key={`${e.row}-${e.nik}`}>
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
              <FootSum>
                {preview.errorCount > 0 ? t.umImpBlocked : t.umImpFoot}
              </FootSum>
              <div className="flex flex-wrap items-center gap-4">
                <Pagination
                  page={pgErr.page}
                  pageCount={pgErr.pageCount}
                  onPage={pgErr.setPage}
                  per={pgErr.per}
                  perOptions={["10", "25", "50"]}
                  onPer={pgErr.setPer}
                />
                <Button
                  onClick={commit}
                  disabled={busy || preview.errorCount > 0}
                >
                  {busy ? <Spinner /> : null}
                  {busy
                    ? t.upImporting
                    : `${t.upImport} ${preview.newCount + preview.movedCount} ${t.faImpRows}`}
                </Button>
              </div>
            </PanelFoot>
          </Panel>
        </>
      ) : null}
    </div>
  );
}
