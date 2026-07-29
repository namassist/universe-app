"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, Upload } from "lucide-react";

import { api, API_URL, errorMessage, fetchBlob } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { masterQueryOptions } from "@/lib/queries/master";
import { rosterTemplateUrl } from "@/lib/queries/roster";
import { rosterCodeColor } from "@/lib/roster-data";
import { useRole } from "@/components/providers/role-context";
import { Badge } from "@/components/ui/badge";
import { Button, Spinner } from "@/components/ui/button";
import { Dropzone } from "@/components/ui/dropzone";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
import { Select } from "@/components/ui/select";
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

type Preview = Awaited<
  ReturnType<typeof api.v1.roster.import.preview.post>
>["data"];

/**
 * Upload a monthly roster.
 *
 * Three things changed when this stopped being a static port, and all three are
 * decisions rather than plumbing:
 *
 * - **The department and the month are chosen here** (API design D6), because
 *   neither can be trusted to the file: a file name survives one "Copy of", and
 *   a header cell is the first thing forgotten when last month's sheet is
 *   reused. The upload button stays disabled until both are set, and so does
 *   the template — which is why the template button was moved down out of the
 *   page header to sit directly under those two fields. A control in the header
 *   that greys out because of an input further down the page reads as a broken
 *   download, not as a prerequisite.
 * - **The progress bar follows the real request.** It used to be a
 *   `setInterval` counting to 100 while nothing was in flight.
 * - **The preview's grid is paged by the API**, not sliced here. The errors and
 *   the remarks come back whole, because those are what an operator reads.
 */
export function RosterUpload() {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { scope, roleLabel } = useRole();
  const listHref = `/roster-data`;

  /* A caller whose scope names one department does not choose one — the server
     resolves it from that caller's own employee record and ignores anything
     sent. Hiding the control is a courtesy; the API is the boundary. */
  const scopedToOwnDepartment = scope !== "all";

  const [departmentId, setDepartmentId] = React.useState("");
  const [month, setMonth] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [pct, setPct] = React.useState(0);
  const [dragging, setDragging] = React.useState(false);
  const [preview, setPreview] = React.useState<Preview>(null);
  /* The rows on screen: the preview's first page to begin with, then whatever
     `loadPage` fetched. Kept beside the preview rather than derived from it,
     because paging replaces these and leaves the counts alone. */
  const [rows, setRows] = React.useState<NonNullable<Preview>["rows"]>([]);
  const [token, setToken] = React.useState<string | null>(null);
  const [page, setPage] = React.useState(1);
  const [per, setPer] = React.useState("25");

  const fileRef = React.useRef<HTMLInputElement>(null);
  const departmentsQ = useQuery(masterQueryOptions("departemen", true));

  const ready =
    Boolean(month) && (scopedToOwnDepartment || Boolean(departmentId));

  /* ------------------------------------------------------------- preview */

  /**
   * Uploaded with `XMLHttpRequest` rather than `fetch`, for one reason: it is
   * the only way to observe *upload* progress in a browser. A roster file is
   * megabytes on a site link, so a bar that reflects the real transfer is worth
   * the older API.
   */
  function upload<T>(path: string, form: FormData): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API_URL}${path}`);
      xhr.withCredentials = true;
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setPct((e.loaded / e.total) * 100);
      };
      xhr.onload = () => {
        let body: unknown = null;
        try {
          body = JSON.parse(xhr.responseText) as unknown;
        } catch {
          // A non-JSON body from a 5xx; the status is all there is.
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(body as T);
        else reject({ status: xhr.status, value: body });
      };
      xhr.onerror = () => reject(new Error("network"));
      xhr.send(form);
    });
  }

  const previewM = useMutation({
    mutationFn: async (picked: File) => {
      const form = new FormData();
      form.append("file", picked);
      form.append("month", month);
      if (!scopedToOwnDepartment) form.append("departmentId", departmentId);
      return upload<NonNullable<Preview>>("/v1/roster/import/preview", form);
    },
    onSuccess: (data) => {
      setPreview(data);
      setRows(data.rows);
      setToken(data.token);
      setPage(1);
    },
    onError: (error) => {
      setPreview(null);
      setRows([]);
      setToken(null);
      pushToast("error", t.upPreviewErrT, errorMessage(error, t.rdLoadErr));
    },
  });

  function pick(picked: File | null) {
    if (!picked || !ready) return;
    setFile(picked);
    setPct(0);
    previewM.mutate(picked);
  }

  /* --------------------------------------------------------- grid paging */

  /**
   * A later page of the *same* file (API design D8).
   *
   * The staged copy is what makes this possible, and its absence is not an
   * error worth blocking on: a lost token degrades the preview to its first
   * page, and the commit re-parses the file regardless.
   */
  const loadPage = React.useCallback(
    async (next: number, size: number) => {
      if (!token) return;
      const { data, error } = await api.v1.roster.import
        .preview({ token })
        .rows.get({ query: { page: next, pageSize: size } });
      if (error) {
        pushToast("error", t.upPreviewErrT, t.upPrevExpired);
        setToken(null);
        return;
      }
      setRows(data.rows);
      setPage(data.page);
    },
    [token, pushToast, t.upPreviewErrT, t.upPrevExpired]
  );

  /**
   * The preview grid's day columns.
   *
   * Derived from the rows on screen rather than from the month picked above,
   * because the two can legitimately disagree for one render — the preview is
   * of a file that was already parsed, and a file whose width does not match
   * the month is refused whole before any row arrives. Taking the width from
   * the data means the header always describes what is under it.
   */
  const dayCount = React.useMemo(
    () => rows.reduce((max, r) => Math.max(max, r.data.split(" - ").length), 0),
    [rows]
  );

  const rowTotal = preview?.rowTotal ?? 0;
  const pageCount = Math.max(1, Math.ceil(rowTotal / Number(per)));
  const range = rowTotal
    ? `${(page - 1) * Number(per) + 1}–${Math.min(rowTotal, page * Number(per))}`
    : "0";

  /* ------------------------------------------------------------- remarks */

  const [qIssue, setQIssue] = React.useState("");
  const issues = React.useMemo(() => {
    // One table, both severities, exactly as the other importers render them
    // (design D9, D19): an operator scanning the bottom of the screen should
    // find one list of everything worth looking at.
    const all = [...(preview?.errors ?? []), ...(preview?.warnings ?? [])];
    const needle = qIssue.trim().toLowerCase();
    if (!needle) return all;
    return all.filter(
      (e) =>
        e.nik.toLowerCase().includes(needle) ||
        e.emp.toLowerCase().includes(needle) ||
        e.issue.toLowerCase().includes(needle)
    );
  }, [preview, qIssue]);
  const pgIssue = usePagination(issues);

  /* -------------------------------------------------------------- commit */

  const importM = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("no file");
      const form = new FormData();
      form.append("file", file);
      form.append("month", month);
      if (!scopedToOwnDepartment) form.append("departmentId", departmentId);
      if (token) form.append("token", token);
      return upload<{
        created: number;
        archivedDocumentId: string | null;
        rejectedRevisions: number;
        employeeCount: number;
      }>("/v1/roster/import", form);
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["roster-documents"] });
      await queryClient.invalidateQueries({ queryKey: ["roster-in-force"] });
      await queryClient.invalidateQueries({ queryKey: ["roster-revisions"] });
      await queryClient.invalidateQueries({
        queryKey: ["roster-approval-queue"],
      });
      pushToast(
        "success",
        t.upImportedT,
        [
          `${result.created} ${t.upImportedD}`,
          result.archivedDocumentId ? t.upArchived : null,
          result.rejectedRevisions
            ? `${result.rejectedRevisions} ${t.upRejected}`
            : null,
        ]
          .filter(Boolean)
          .join(" ")
      );
      router.push(listHref);
    },
    onError: (error) =>
      pushToast("error", t.upImportErrT, errorMessage(error, t.rdLoadErr)),
  });

  async function downloadTemplate() {
    if (!ready) return;
    try {
      const blob = await fetchBlob(
        rosterTemplateUrl(
          month,
          scopedToOwnDepartment ? undefined : departmentId
        )
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `template_roster_${month}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      pushToast("success", t.toastTemplateT, `template_roster_${month}.xlsx`);
    } catch (error) {
      pushToast("error", t.rdDlErrT, errorMessage(error, t.rdLoadErr));
    }
  }

  const errorCount = preview?.errorCount ?? 0;
  const warnCount = preview?.warnings.length ?? 0;
  const validCount =
    (preview?.newCount ?? 0) +
    (preview?.updatedCount ?? 0) +
    (preview?.unchangedCount ?? 0);

  const chips = [
    {
      n: validCount,
      label: t.vValid,
      bg: "var(--badge-success-fill)",
      border: "var(--badge-success-border)",
      color: "var(--badge-success-text)",
    },
    {
      n: warnCount,
      label: t.upWarnCount,
      bg: "var(--badge-warning-fill)",
      border: "var(--badge-warning-border)",
      color: "var(--badge-warning-text)",
    },
    {
      n: errorCount,
      label: t.vErr,
      bg: "var(--badge-danger-fill)",
      border: "var(--badge-danger-border)",
      color: "var(--color-danger-text)",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={t.navR1} sub={t.upSub}>
        <Button variant="ghost" onClick={() => router.push(listHref)}>
          <ArrowLeft />
          {t.upBack}
        </Button>
      </PageTitle>

      <Panel>
        {/* Stated, never inferred (design D6). Both sit above the dropzone
            because the file cannot be read without them. */}
        <div className="mb-5 grid gap-4 sm:grid-cols-2">
          {scopedToOwnDepartment ? (
            <Field label={t.upDept} helper={t.upOwnDept}>
              <Input value={roleLabel} readOnly disabled />
            </Field>
          ) : (
            <Field label={t.upDept}>
              <Select
                aria-label={t.upDept}
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
              >
                <option value="">{t.upPickDept}</option>
                {(departmentsQ.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label={t.upMonthField}>
            <Input
              type="month"
              aria-label={t.upMonthField}
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </Field>
        </div>

        {/* Under the two fields rather than up in the page header, where it
            used to sit. The template *is* the department's month — it carries
            that department's people and that month's columns — so a button
            placed before the inputs that decide it reads as a download that
            the page is refusing for no reason. Adjacency is the explanation;
            the hint below is only the second line of it. */}
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-icon border border-(--divider) bg-(--fill-subtle) px-4 py-3">
          <Button
            variant="secondary"
            disabled={!ready}
            onClick={() => void downloadTemplate()}
          >
            <Download />
            {t.upTemplate}
          </Button>
          <p className="text-xs text-(--text-tertiary)">
            {ready ? t.upTemplateReady : t.upTemplateNeed}
          </p>
        </div>

        <Dropzone
          icon={<Upload />}
          title={t.dzTitle}
          hint={ready ? t.dzHint : t.upNeedBoth}
          aria-label={t.dzTitle}
          dragging={dragging}
          onDragChange={setDragging}
          onPick={() => (ready ? fileRef.current?.click() : undefined)}
          onDropFile={() => fileRef.current?.click()}
        />
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={(e) => {
            pick(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />

        {previewM.isPending ? (
          <div className="mt-5">
            <div className="mb-2 flex justify-between text-sm">
              <span className="font-semibold">{file?.name}</span>
              <span className="font-mono text-(--text-secondary)">
                {Math.round(pct)}%
              </span>
            </div>
            <Progress value={pct} />
            <p className="mt-2 text-xs text-(--text-tertiary)">
              {pct >= 100 ? t.upValidating : t.upUploading}
            </p>
          </div>
        ) : null}
      </Panel>

      {preview ? (
        <div className="flex flex-col gap-6">
          <Panel>
            <Toolbar className="mb-4">
              <ToolbarTitle>
                {t.upPrevTitle} — {preview.fileName}
              </ToolbarTitle>
              <ToolbarGroup>
                <span className="text-xs text-(--text-tertiary)">
                  {t.upPrevHint}
                </span>
              </ToolbarGroup>
            </Toolbar>
            {/* One column per day rather than one cell holding all of them.
                A roster is read down a date — "who is on nights on the 14th" —
                and a run of thirty-one codes in a single cell cannot be read
                that way at all, however it is spaced. The three identifying
                columns keep their fixed widths so the days line up between
                rows. */}
            <div className="overflow-x-auto pb-2">
              <Table style={{ minWidth: 400 + dayCount * 42 }}>
                <TableHeader>
                  <tr>
                    <TableHead className="w-[70px]">{t.thRow}</TableHead>
                    <TableHead className="w-[110px]">NIK</TableHead>
                    <TableHead className="w-[190px]">{t.thNama}</TableHead>
                    {Array.from({ length: dayCount }, (_, i) => (
                      <TableHead
                        key={i}
                        className="text-center font-mono text-xs"
                      >
                        {String(i + 1).padStart(2, "0")}
                      </TableHead>
                    ))}
                  </tr>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const codes = r.data.split(" - ");
                    return (
                      <TableRow key={r.row}>
                        <TableCell className="font-mono">{r.row}</TableCell>
                        <TableCell className="font-mono whitespace-nowrap">
                          {r.key}
                        </TableCell>
                        <TableCell className="font-semibold whitespace-nowrap">
                          {r.label}
                        </TableCell>
                        {Array.from({ length: dayCount }, (_, i) => (
                          <TableCell
                            key={i}
                            className="text-center font-mono text-xs"
                            style={{ color: rosterCodeColor(codes[i] ?? "") }}
                          >
                            {codes[i] ?? ""}
                          </TableCell>
                        ))}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <PanelFoot>
              <FootSum>
                {t.upPrevA} <b>{range}</b> {t.attSumB} <b>{rowTotal}</b>{" "}
                {t.upPrevB}
              </FootSum>
              <Pagination
                page={page}
                pageCount={pageCount}
                onPage={(next) => void loadPage(next, Number(per))}
                per={per}
                perOptions={["10", "25", "50"]}
                onPer={(next) => {
                  setPer(next);
                  void loadPage(1, Number(next));
                }}
              />
            </PanelFoot>
          </Panel>

          <Panel>
            <Toolbar className="mb-4">
              <ToolbarTitle>
                {t.upResults} — {preview.fileName}
              </ToolbarTitle>
              <ToolbarGroup>
                <SearchInput
                  className="w-[240px]"
                  placeholder={t.searchEmp}
                  aria-label={t.searchEmp}
                  value={qIssue}
                  onChange={(e) => setQIssue(e.target.value)}
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
                  <TableHead className="w-[90px]">{t.thRow}</TableHead>
                  <TableHead>NIK</TableHead>
                  <TableHead>{t.thEmp}</TableHead>
                  <TableHead>{t.thIssue}</TableHead>
                  <TableHead>{t.thType}</TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {pgIssue.rows.map((e, i) => (
                  <TableRow key={`${e.row}-${e.badge}-${i}`}>
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
                  page={pgIssue.page}
                  pageCount={pgIssue.pageCount}
                  onPage={pgIssue.setPage}
                  per={pgIssue.per}
                  perOptions={["10", "25", "50"]}
                  onPer={pgIssue.setPer}
                />
                {/* Blocked by errors, never by remarks: reverting a day is
                    sometimes exactly what the operator means to do. */}
                <Button
                  onClick={() => importM.mutate()}
                  disabled={
                    importM.isPending || errorCount > 0 || validCount === 0
                  }
                >
                  {importM.isPending ? <Spinner /> : null}
                  {importM.isPending
                    ? t.upImporting
                    : `${t.upImport} ${validCount} ${t.upRowsValid}`}
                </Button>
              </div>
            </PanelFoot>
          </Panel>
        </div>
      ) : null}

      <RosterLegend />
    </div>
  );
}
