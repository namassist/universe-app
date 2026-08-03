"use client";

import * as React from "react";
import { notFound, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, Upload } from "lucide-react";

import type { FleetImportPreview } from "@universe/contracts";

import { api, errorMessage, fetchBlob } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { fleetsKey } from "@/lib/queries/fleets";
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

const LIST_HREF = "/fleet-setting";

/**
 * Bulk fleet composition, following the shape `um-users-import.tsx`
 * established: template → dropzone → server-side validation preview →
 * explicit commit. One fleet per row, keyed by its digger; the API refuses
 * with the same rules the fleet dialog goes through.
 */
export function FleetImport() {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const { access } = useRole();
  const router = useRouter();

  const [stage, setStage] = React.useState<Stage>("idle");

  const [pct, setPct] = React.useState(0);
  const [file, setFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<FleetImportPreview | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [fatal, setFatal] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const [qPrev, setQPrev] = React.useState("");
  const [qErr, setQErr] = React.useState("");

  async function downloadTemplate() {
    let blob: Blob;
    try {
      // fetchBlob, not Eden — Treaty decodes an unrecognised body as text,
      // which mangles the workbook past recovery.
      blob = await fetchBlob("/v1/fleets/import/template");
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
    a.download = "template_fleet.xlsx";
    a.click();
    URL.revokeObjectURL(url);
    pushToast("success", t.toastTemplateT, t.flImpTplD);
  }

  async function validate(picked: File) {
    setFile(picked);
    setPreview(null);
    setFatal(null);
    setStage("uploading");
    setPct(15);

    const timer = setInterval(() => setPct((p) => (p < 85 ? p + 10 : p)), 120);
    const { data, error } = await api.v1.fleets.import.validate.post({
      file: picked,
    });
    clearInterval(timer);
    setPct(100);

    if (error || !data) {
      setStage("idle");
      setFatal(errorMessage(error, t.loginErr));
      return;
    }
    setStage("validating");
    setPreview(data as FleetImportPreview);
    setTimeout(() => setStage("results"), 300);
  }

  async function commit() {
    if (!file) return;
    setBusy(true);
    const { data, error } = await api.v1.fleets.import.commit.post({ file });
    setBusy(false);
    if (error || !data) {
      pushToast("error", t.upImport, errorMessage(error, t.loginErr));
      return;
    }
    await queryClient.invalidateQueries({ queryKey: fleetsKey });
    pushToast(
      "success",
      t.flImpDoneT,
      `${data.created} ${t.umImpCreated} · ${data.updated} ${t.umImpUpdated}`
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
      r.digger.toLowerCase().includes(needle) ||
      r.units.some((u) => u.toLowerCase().includes(needle))
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
          n: preview.updatedCount,
          label: t.umImpUpd,
          bg: "var(--badge-warning-fill)",
          border: "var(--badge-warning-border)",
          color: "var(--badge-warning-text)",
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
     `manage` on the fleet-setting menu regardless of what this renders. */
  if (access("fleet-setting") !== "manage") notFound();

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={t.flImpTitle} sub={t.flImpSub}>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => router.push(LIST_HREF)}>
            <ArrowLeft />
            {t.flImpBack}
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
          title={t.flImpDzTitle}
          hint={t.flImpHint}
          aria-label={t.flImpDzTitle}
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
                  placeholder={t.searchUnit}
                  aria-label={t.searchUnit}
                  value={qPrev}
                  onChange={(e) => setQPrev(e.target.value)}
                />
              </ToolbarGroup>
            </Toolbar>

            <div className="mb-5 flex flex-wrap gap-3">
              {chips.map((c) => (
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
                  <TableHead className="w-[80px]">{t.thRow}</TableHead>
                  <TableHead className="w-[110px]">{t.thType}</TableHead>
                  <TableHead>Digger</TableHead>
                  <TableHead>{t.flLoc}</TableHead>
                  <TableHead>{t.flBus}</TableHead>
                  <TableHead>{t.flUnits}</TableHead>
                  <TableHead>{t.umImpChanges}</TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {pgPrev.rows.map((r) => (
                  <TableRow key={r.row}>
                    <TableCell className="font-mono">{r.row}</TableCell>
                    <TableCell>
                      <Badge
                        variant={r.kind === "new" ? "success" : "warning"}
                        dot
                      >
                        {r.kind === "new" ? t.umImpNew : t.umImpUpd}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono font-semibold">
                      {r.digger}
                    </TableCell>
                    <TableCell>{r.area}</TableCell>
                    <TableCell className="font-mono">{r.bus ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex max-w-[320px] flex-wrap gap-1">
                        {r.units.map((u) => (
                          <Badge key={u} variant="info">
                            {u}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    {/* Naming each field an update would overwrite is what
                        stops a hand-edited composition vanishing quietly. */}
                    <TableCell className="text-(--text-secondary)">
                      {r.changes.length ? (
                        <div className="flex flex-col gap-0.5 text-xs">
                          {r.changes.map((c) => (
                            <span key={c.field}>
                              <b>{c.field}</b>: {c.from ?? "—"} → {c.to ?? "—"}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-(--text-tertiary)">—</span>
                      )}
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
                  placeholder={t.searchUnit}
                  aria-label={t.searchUnit}
                  value={qErr}
                  onChange={(e) => setQErr(e.target.value)}
                />
              </ToolbarGroup>
            </Toolbar>
            <Table>
              <TableHeader>
                <tr>
                  <TableHead className="w-[90px]">{t.thRow}</TableHead>
                  <TableHead>Digger</TableHead>
                  <TableHead>Detail</TableHead>
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
                    : `${t.upImport} ${preview.newCount + preview.updatedCount} ${t.flImpFleets}`}
                </Button>
              </div>
            </PanelFoot>
          </Panel>
        </>
      ) : null}
    </div>
  );
}
