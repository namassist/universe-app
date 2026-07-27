"use client";

import * as React from "react";
import { notFound, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, TriangleAlert, Upload } from "lucide-react";

import {
  MASTER_IMPORT_COLUMNS,
  MENU_LABELS,
  UNIT_IMPORT_COLUMNS,
  type MasterImportPreview,
  type MasterKind,
  type PendingMaster,
} from "@universe/contracts";

import { api, errorMessage, fetchBlob } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useRole } from "@/components/providers/role-context";
import { Badge } from "@/components/ui/badge";
import { Button, Spinner } from "@/components/ui/button";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogIcon,
  DialogTitle,
} from "@/components/ui/dialog";
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

/**
 * How many additions the confirmation names before summarising the rest.
 *
 * A first catalogue import can be four hundred rows, and four hundred chips is
 * not something anyone reads — but the point of the dialog is that the list is
 * scannable, so it names enough to spot a stray entry among familiar ones.
 */
const MASTER_CHIP_LIMIT = 50;

/**
 * The joined row, split back into the value it is keyed on and the rest.
 *
 * Split on the separator rather than sliced by the key's length: a unit code is
 * uppercased on the way in, so the key and the text the operator typed are not
 * always the same string even though they are the same column.
 */
const SEP = " - ";
const dataHead = (data: string) => data.split(SEP)[0] ?? data;
const dataTail = (data: string) => {
  const head = dataHead(data);
  return data.length > head.length ? data.slice(head.length) : "";
};

/** Every master screen that accepts a spreadsheet. */
export type ImportTarget = MasterKind | "database-unit";

/**
 * Preview-then-commit import for the master catalogues and the unit registry.
 *
 * A page of its own, exactly as the account import is: the flow carries two
 * full tables and a row of counts, and putting that in a dialog over the list
 * it is about means either a cramped scroll area or a modal taller than the
 * screen. A page also makes the step addressable — an operator can be sent the
 * URL — and lets an abandoned import be left by navigating back rather than by
 * hunting for a close button.
 *
 * One component for all ten targets, differing only in which endpoints it
 * calls, which menu governs it, and which list it returns to.
 */
export function MasterImport({ target }: { target: ImportTarget }) {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const { access } = useRole();
  const router = useRouter();

  const isUnits = target === "database-unit";
  const label = MENU_LABELS[target];
  const listHref = `/${target}`;
  const templatePath = isUnits
    ? "/v1/units/import/template"
    : `/v1/master/${target}/import/template`;
  const templateName = `template_${target}.xlsx`;

  /**
   * The columns this screen accepts, read from the same constant the API
   * validates against.
   *
   * Spelled out on screen rather than described in prose, and derived rather
   * than written by hand: prose next to a file input is where an instruction
   * for a *different* import ends up, and a hand-written list is one that
   * silently stops matching the parser the first time a column is added.
   */
  const columns = isUnits ? UNIT_IMPORT_COLUMNS : MASTER_IMPORT_COLUMNS[target];

  const previewFile = (file: File) =>
    isUnits
      ? api.v1.units.import.preview.post({ file })
      : api.v1.master({ kind: target }).import.preview.post({ file });
  const commitFile = (file: File) =>
    isUnits
      ? api.v1.units.import.post({ file })
      : api.v1.master({ kind: target }).import.post({ file });

  const [stage, setStage] = React.useState<Stage>("idle");
  const [pct, setPct] = React.useState(0);
  const [file, setFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<MasterImportPreview | null>(
    null
  );
  const [dragging, setDragging] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [fatal, setFatal] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const [qPrev, setQPrev] = React.useState("");
  const [qErr, setQErr] = React.useState("");
  const [confirmMasters, setConfirmMasters] = React.useState(false);

  /**
   * A blank template for *this* screen, named after it.
   *
   * The export shares these columns and would have served, but it is not the
   * same thing to reach for: an export of four hundred work areas is not
   * something to type a new one into. Leaving this screen without a template of
   * its own is what sends an operator looking for whichever template is at
   * hand — and a spreadsheet of account columns then arrives at a catalogue's
   * import and is refused for headers it was never going to have.
   */
  async function downloadTemplate() {
    try {
      // fetchBlob, not Eden — Treaty decodes an unrecognised body as text and
      // mangles the workbook past recovery (lib/api.ts).
      const blob = await fetchBlob(templatePath);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = templateName;
      a.click();
      URL.revokeObjectURL(url);
      pushToast("success", t.toastTemplateT, templateName);
    } catch (error) {
      pushToast(
        "error",
        t.mdImpTpl,
        error instanceof Error ? error.message : t.loginErr
      );
    }
  }

  async function validate(picked: File) {
    setFile(picked);
    setPreview(null);
    setFatal(null);
    setStage("uploading");
    setPct(15);

    const timer = setInterval(() => setPct((p) => (p < 85 ? p + 10 : p)), 120);
    const { data, error } = await previewFile(picked);
    clearInterval(timer);
    setPct(100);

    if (error || !data) {
      setStage("idle");
      setFatal(errorMessage(error, t.loginErr));
      return;
    }
    setStage("validating");
    setPreview(data as MasterImportPreview);
    setTimeout(() => setStage("results"), 300);
  }

  /**
   * The import button, which has one question to ask whenever a master gains
   * an entry — and none at all when it is only updating what already exists.
   *
   * The difference between a new entry and a misspelt one is something only the
   * operator can see, and a catalogue entry is permanent in a way a unit row is
   * not: everything that later points at it inherits the mistake. Nothing else
   * about the flow changes — the button is live, the validation table below is
   * untouched, and this only names what would be added.
   */
  function requestCommit() {
    if (pendingMasters.length) setConfirmMasters(true);
    else void commit();
  }

  async function commit() {
    if (!file) return;
    setConfirmMasters(false);
    setBusy(true);
    const { data, error } = await commitFile(file);
    setBusy(false);
    if (error || !data) {
      pushToast("error", t.upImport, errorMessage(error, t.loginErr));
      return;
    }
    // Both cache entries for this kind: the management list and the active-only
    // selection list are separate, and an import touches what both of them read.
    await queryClient.invalidateQueries({
      queryKey: isUnits ? ["units"] : ["master", target],
    });
    // A unit import that created catalogue records touched nine other screens,
    // so every master list is stale too, not just this one.
    if (data.mastersCreated > 0)
      await queryClient.invalidateQueries({ queryKey: ["master"] });
    pushToast(
      "success",
      t.umImpDoneT,
      `${data.created} ${t.umImpCreated} · ${data.updated} ${t.umImpUpdated}` +
        (data.mastersCreated > 0
          ? ` · ${data.mastersCreated} ${t.impMasterAdded}`
          : "")
    );
    setStage("idle");
    setPreview(null);
    setFile(null);
    router.push(listHref);
  }

  const prevRows = (preview?.rows ?? []).filter((r) => {
    const needle = qPrev.trim().toLowerCase();
    // Searched against the joined row, which is what the column now shows —
    // matching only the key would leave values visible on screen unfindable.
    return !needle || r.data.toLowerCase().includes(needle);
  });
  const pgPrev = usePagination(prevRows);

  /**
   * Blocking rows and warnings in one list, in file order.
   *
   * Two tables would mean an operator reconciling row numbers across them to
   * answer one question — what needs looking at before I approve this. The
   * severity is already carried per row by its badge.
   */
  const errRows = [...(preview?.errors ?? []), ...(preview?.warnings ?? [])]
    .sort((a, b) => Number(a.row) - Number(b.row))
    .filter((e) => {
      const needle = qErr.trim().toLowerCase();
      return (
        !needle ||
        e.nik.toLowerCase().includes(needle) ||
        e.emp.toLowerCase().includes(needle) ||
        e.issue.toLowerCase().includes(needle)
      );
    });
  const pgErr = usePagination(errRows);

  /**
   * What this import would add to a master, whichever screen it is.
   *
   * A unit file adds to a catalogue indirectly, by naming a class nobody has
   * entered yet, and the API works that out. A catalogue file adds to one
   * directly: every `new` row *is* a new master entry. Different mechanics, the
   * same thing to be sure about before approving — a misspelt name becomes a
   * permanent entry either way — so both go through one confirmation rather
   * than the unit import asking and the catalogue import writing silently.
   */
  /**
   * What this import would add to a *different* master than the one on screen.
   *
   * Only a unit file can do that, by naming a class nobody has entered yet, and
   * only that is worth a dialog: a catalogue import adding rows to its own
   * catalogue is the operator doing exactly what they came here to do. The
   * check that a new catalogue entry is not a misspelling is the near-match
   * warning in the table below, which does not need a modal to be read.
   */
  const pendingMasters: PendingMaster[] = preview?.newMasters ?? [];

  /** Grouped for the confirmation, which reads by catalogue rather than by row. */
  const mastersByKind = (() => {
    const groups = new Map<MasterKind, PendingMaster[]>();
    for (const m of pendingMasters) {
      const list = groups.get(m.kind);
      if (list) list.push(m);
      else groups.set(m.kind, [m]);
    }
    return [...groups.entries()];
  })();

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
        // A fourth count the account import has no use for: master files are
        // routinely round-tripped through the export, so "read and identical"
        // is a common and reassuring outcome rather than a curiosity.
        {
          n: preview.unchangedCount,
          label: t.mdImpSame,
          bg: "var(--fill-subtle)",
          border: "var(--divider)",
          color: "var(--text-secondary)",
        },
        {
          n: preview.errorCount,
          label: t.umImpErr,
          bg: "var(--badge-danger-fill)",
          border: "var(--badge-danger-border)",
          color: "var(--color-danger-text)",
        },
        // Units only, and only when there are any. A permanent "0 master baru"
        // would suggest the unit import routinely writes into the catalogues,
        // which is the opposite of what this count is for — and on a catalogue
        // screen it would repeat the "Baru" chip beside it, digit for digit.
        ...(isUnits && preview.newMasters.length
          ? [
              {
                n: preview.newMasters.length,
                label: t.impMasterChip,
                bg: "var(--badge-warning-fill)",
                border: "var(--badge-warning-border)",
                color: "var(--badge-warning-text)",
              },
            ]
          : []),
      ]
    : [];

  /* Presentation only — the API refuses every import endpoint without `manage`
     on this menu regardless of what renders here. */
  if (access(target) !== "manage") notFound();

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={`${t.mdImpTitle} — ${label}`} sub={t.mdImpSub}>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => router.push(listHref)}>
            <ArrowLeft />
            {t.umImpBack}
          </Button>
          <Button variant="secondary" onClick={downloadTemplate}>
            <Download />
            {t.mdImpTpl}
          </Button>
        </div>
      </PageTitle>

      <Panel>
        <Dropzone
          icon={<Upload />}
          title={t.mdImpDzTitle}
          hint={`${t.mdImpHint}: ${columns.join(", ")}`}
          aria-label={t.mdImpDzTitle}
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
            className="mt-4 rounded-control border border-(--badge-danger-border) bg-(--badge-danger-fill) px-3 py-2.5 text-xs text-danger-text"
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
                  className="w-60"
                  placeholder={t.mdSearchPh}
                  aria-label={t.mdSearchPh}
                  value={qPrev}
                  onChange={(e) => setQPrev(e.target.value)}
                />
              </ToolbarGroup>
            </Toolbar>

            <div className="mb-5 flex flex-wrap gap-3">
              {chips.map((c) => (
                <div
                  key={c.label}
                  className="flex min-w-45 flex-1 items-center gap-3 rounded-card border px-4 py-3"
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
                  <TableHead className="w-20">{t.thRow}</TableHead>
                  <TableHead className="w-27.5">{t.thType}</TableHead>
                  <TableHead>{t.thData}</TableHead>
                  <TableHead className="w-65">{t.umImpChanges}</TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {pgPrev.rows.map((r) => (
                  <TableRow key={r.row}>
                    <TableCell className="font-mono">{r.row}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          r.kind === "new"
                            ? "success"
                            : r.kind === "updated"
                              ? "warning"
                              : "neutral"
                        }
                        dot
                      >
                        {r.kind === "new"
                          ? t.umImpNew
                          : r.kind === "updated"
                            ? t.umImpUpd
                            : t.mdImpSame}
                      </Badge>
                    </TableCell>
                    {/* The row as typed, every column joined — so a preview can
                        be checked against the spreadsheet without opening it.
                        Wrapped rather than truncated: a twelve-column unit row
                        is long, and hiding the tail defeats the point of
                        showing the data at all. */}
                    <TableCell className="max-w-130">
                      <span className="wrap-break-word">
                        <b className="font-semibold">{dataHead(r.data)}</b>
                        <span className="text-(--text-secondary)">
                          {dataTail(r.data)}
                        </span>
                      </span>
                    </TableCell>
                    {/* Naming each field an update would overwrite is what
                        stops a hand-edited value vanishing into a re-upload. */}
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
                  className="w-60"
                  placeholder={t.mdSearchPh}
                  aria-label={t.mdSearchPh}
                  value={qErr}
                  onChange={(e) => setQErr(e.target.value)}
                />
              </ToolbarGroup>
            </Toolbar>
            <Table>
              <TableHeader>
                <tr>
                  <TableHead className="w-22.5">{t.thRow}</TableHead>
                  <TableHead>{t.mdNama}</TableHead>
                  {/* Not "description": for a near-match warning this holds the
                      existing entry the value resembles, and for a unit
                      reference the value that could not be resolved. */}
                  <TableHead>{t.thValue}</TableHead>
                  <TableHead>{t.thIssue}</TableHead>
                  <TableHead className="w-27.5">{t.thType}</TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {/* Indexed: one spreadsheet row can raise several warnings —
                    an unknown jenis and an unknown kode_simper — and those
                    share both their row number and their key. */}
                {pgErr.rows.map((e, i) => (
                  <TableRow key={`${e.row}-${e.nik}-${e.emp}-${i}`}>
                    <TableCell className="font-mono">{e.row}</TableCell>
                    <TableCell className="font-mono">{e.nik}</TableCell>
                    <TableCell className="text-(--text-secondary)">
                      {e.emp}
                    </TableCell>
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
                {preview.errorCount > 0
                  ? t.umImpBlocked
                  : preview.newCount + preview.updatedCount === 0
                    ? t.mdImpNothingB
                    : t.umImpFoot}
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
                  onClick={requestCommit}
                  disabled={
                    busy ||
                    preview.errorCount > 0 ||
                    preview.newCount + preview.updatedCount === 0
                  }
                >
                  {busy ? <Spinner /> : null}
                  {/* "Import 0" would read as a button that ought to work and
                      does not; naming the reason is the honest disabled state. */}
                  {busy
                    ? t.upImporting
                    : preview.newCount + preview.updatedCount === 0
                      ? t.mdImpNothing
                      : `${t.upImport} ${preview.newCount + preview.updatedCount} ${t.mdSumB}`}
                </Button>
              </div>
            </PanelFoot>
          </Panel>
        </>
      ) : null}

      {/* Every addition named, by catalogue. For a unit file the row count is
          the signal — a count of one beside a name close to an existing entry
          is what a typo looks like from here — while on a catalogue screen
          every entry is one row and the number would say nothing. */}
      <Dialog
        open={confirmMasters}
        onClose={() => setConfirmMasters(false)}
        labelledBy="imp-nm-t"
      >
        <DialogIcon variant="warning">
          <TriangleAlert />
        </DialogIcon>
        <DialogTitle id="imp-nm-t">{t.impMasterT}</DialogTitle>
        <DialogBody>{t.impMasterB}</DialogBody>
        <div className="mt-4 flex max-h-[40vh] flex-col gap-3 overflow-y-auto">
          {mastersByKind.map(([kind, items]) => (
            <div key={kind}>
              <div className="mb-1.5 text-xs font-semibold tracking-wider text-(--text-tertiary) uppercase">
                {MENU_LABELS[kind]}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {items.slice(0, MASTER_CHIP_LIMIT).map((m) => (
                  <span
                    key={m.name}
                    className={cn(
                      "rounded-control border px-2 py-1 text-xs",
                      // A suspected misspelling is the one thing in this list
                      // that should not be waved through, so it does not look
                      // like the entries beside it.
                      m.similarTo
                        ? "border-(--badge-danger-border) bg-(--badge-danger-fill) text-danger-text"
                        : "border-(--badge-warning-border) bg-(--badge-warning-fill) text-(--badge-warning-text)"
                    )}
                  >
                    {m.name}
                    <span className="ml-1.5 opacity-70">
                      {m.rows} {t.impMasterRows}
                    </span>
                    {m.similarTo ? (
                      <span className="ml-1.5 font-semibold">
                        · {t.impMasterLike} &ldquo;{m.similarTo}&rdquo;
                      </span>
                    ) : null}
                  </span>
                ))}
                {/* Said out loud rather than trimmed quietly: a list that stops
                    at fifty without saying so reads as the whole list. */}
                {items.length > MASTER_CHIP_LIMIT ? (
                  <span className="self-center text-xs text-(--text-tertiary)">
                    +{items.length - MASTER_CHIP_LIMIT} {t.impMasterMore}
                  </span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
        <DialogActions>
          <Button variant="ghost" onClick={() => setConfirmMasters(false)}>
            {t.btnCancel}
          </Button>
          <Button onClick={commit} disabled={busy}>
            {busy ? <Spinner /> : null}
            {t.impMasterDo}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
