"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Pencil, Plus, Search, Trash2, Upload } from "lucide-react";

import type { AccessMode } from "@/lib/access";
import { api, errorMessage, fetchBlob } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { masterQueryOptions } from "@/lib/queries/master";
import {
  UNIT_UNASSIGNED,
  unitsQueryOptions,
  type UnitRow,
} from "@/lib/queries/units";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogIcon,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { useToast } from "@/components/ui/toast";

/** Long enough not to fire on every keystroke, short enough to feel live. */
const SEARCH_DEBOUNCE_MS = 250;

/** Matches `maxItems` on the bulk-delete route. */
const BULK_CHUNK = 200;

/**
 * The unit registry.
 *
 * Search and the class/brand filters are served by the API rather than applied
 * to a full list here: the filter has to reach the *joined* catalogue names,
 * which the browser has no index for, and the registry is five hundred to a
 * thousand rows at the site's real size.
 *
 * The import is the real preview-then-commit flow now, sharing its results
 * presentation with the account and roster imports. What used to be here was a
 * progress bar counting up on a timer with no file behind it.
 */
export function DatabaseUnitMenu({ mode }: { mode: AccessMode }) {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const router = useRouter();
  const base = `/database-unit`;
  const canW = mode === "manage";

  const [q, setQ] = React.useState("");
  const [debouncedQ, setDebouncedQ] = React.useState("");
  const [departmentId, setDepartmentId] = React.useState("");
  // Kept as the select's own strings — "" is no filter, and turning them into
  // booleans early would make "unfiltered" and "false" the same value.
  const [statusF, setStatusF] = React.useState("");
  const [ftwF, setFtwF] = React.useState("");
  const [delTarget, setDelTarget] = React.useState<UnitRow | null>(null);

  /**
   * Selection is a set of codes, not of rows: the list refetches after every
   * write and on every filter change, and holding row objects would keep a tick
   * attached to a stale copy of a unit.
   *
   * Codes rather than ids because that is what the unit API addresses a unit by
   * — the same key the single delete uses.
   */
  const [sel, setSel] = React.useState<ReadonlySet<string>>(() => new Set());
  const [bulkOpen, setBulkOpen] = React.useState(false);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q]);

  const unitsQ = useQuery(
    unitsQueryOptions({
      ...(debouncedQ.trim() ? { q: debouncedQ.trim() } : {}),
      ...(departmentId ? { departmentId } : {}),
      ...(statusF ? { active: statusF === "1" } : {}),
      ...(ftwF ? { ftw: ftwF === "1" } : {}),
    })
  );
  const rows = React.useMemo(() => unitsQ.data ?? [], [unitsQ.data]);

  // Active rows only — a retired department is not something anyone is
  // filtering for, and the units holding it still show its name in their own
  // column. Class and brand have no dropdown of their own any more: the search
  // box matches both by name, which is the same question with fewer controls.
  const departments = useQuery(masterQueryOptions("departemen", true));

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["units"] });

  const del = useMutation({
    mutationFn: async (unit: UnitRow) => {
      const { error } = await api.v1.units({ code: unit.code }).delete();
      if (error) throw error;
    },
    onSuccess: async (_d, unit) => {
      await invalidate();
      pushToast("success", t.mdDelToastT, unit.code);
      setDelTarget(null);
      setSel((prev) => {
        if (!prev.has(unit.code)) return prev;
        const next = new Set(prev);
        next.delete(unit.code);
        return next;
      });
    },
    // A unit with a bus schedule is refused with 409 and the API's wording.
    onError: (error) =>
      pushToast("error", t.udbDelT, errorMessage(error, t.loginErr)),
  });

  const bulkDel = useMutation({
    /** Chunked to the endpoint's own `maxItems`, as the master lists are. */
    mutationFn: async (codes: string[]) => {
      let deleted = 0;
      const blocked: { code: string; reason: string }[] = [];
      for (let i = 0; i < codes.length; i += BULK_CHUNK) {
        const result = await api.v1.units["bulk-delete"].post({
          codes: codes.slice(i, i + BULK_CHUNK),
        });
        if (result.error) throw result.error;
        deleted += result.data.deleted;
        blocked.push(...result.data.blocked);
      }
      return { deleted, blocked };
    },
    onSuccess: (result) => {
      setBulkOpen(false);
      // The refused units stay ticked — they are still in the table, and that
      // is what shows *which* ones need their bus schedule removed first.
      setSel(new Set(result.blocked.map((b) => b.code)));

      const shown = result.blocked.slice(0, 5).map((b) => b.code);
      const held = `${result.blocked.length} ${t.udbBulkHeld} ${shown.join(", ")}${
        result.blocked.length > shown.length ? ", …" : ""
      }`;

      if (!result.blocked.length)
        pushToast("success", t.mdDelToastT, `${result.deleted} ${t.udbSumB}`);
      else if (result.deleted)
        pushToast(
          "info",
          t.mdBulkPartT,
          `${result.deleted} ${t.udbSumB} — ${held}`
        );
      else pushToast("error", t.mdBulkNoneT, held);
    },
    onError: (error) =>
      pushToast("error", t.mdBulkDel, errorMessage(error, t.loginErr)),
    // A chunk that throws may have been preceded by chunks that landed.
    onSettled: () => invalidate(),
  });

  async function exportSheet() {
    try {
      // fetchBlob, not Eden — Treaty decodes an unrecognised body as text and
      // mangles the workbook past recovery (lib/api.ts).
      const blob = await fetchBlob("/v1/units/export");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "database_unit.xlsx";
      a.click();
      URL.revokeObjectURL(url);
      pushToast("success", t.toastExportT, "database_unit.xlsx");
    } catch (error) {
      pushToast(
        "error",
        t.toastExportT,
        error instanceof Error ? error.message : t.loginErr
      );
    }
  }

  const pg = usePagination(rows);

  // Resolved against the loaded list, so a code left over from a previous
  // filter never reaches the request.
  const selectedRows = rows.filter((r) => sel.has(r.code));

  // The header checkbox governs the page, not the whole filtered set: ticking
  // one box and silently arming a delete over rows on four other pages is the
  // kind of help nobody asks for. Selections still accumulate across pages.
  const pageCodes = pg.rows.map((r) => r.code);
  const allPageSel = pageCodes.length > 0 && pageCodes.every((c) => sel.has(c));
  const somePageSel = pageCodes.some((c) => sel.has(c));

  function toggleRow(code: string) {
    setSel((prev) => {
      const next = new Set(prev);
      if (!next.delete(code)) next.add(code);
      return next;
    });
  }
  function togglePage() {
    setSel((prev) => {
      const next = new Set(prev);
      for (const c of pageCodes) {
        if (allPageSel) next.delete(c);
        else next.add(c);
      }
      return next;
    });
  }

  const heads: { label: string; style?: React.CSSProperties }[] = [
    { label: t.thUnitCode },
    { label: "Kelas Unit" },
    { label: "Jenis Unit" },
    { label: "Model" },
    { label: "Merk" },
    { label: "Kode Simper" },
    { label: "Departemen" },
    { label: "Machine S/N" },
    { label: "Engine Brand" },
    { label: "Description" },
    { label: t.thStatus },
    { label: "FTW" },
    { label: t.thAct, style: { width: 110 } },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={t.navUnitDb} sub={t.udbSub}>
        {canW ? (
          <Button onClick={() => router.push(`${base}/new`)}>
            <Plus />
            {t.udbAdd}
          </Button>
        ) : null}
      </PageTitle>

      <Panel>
        <Toolbar>
          <ToolbarTitle>{t.udbListTitle}</ToolbarTitle>
          <ToolbarGroup>
            {/* Wider than the other lists', because this one carries six
                columns' worth of work: code, class, type, model, brand, and
                qualification code all resolve through it. */}
            <SearchInput
              className="w-[360px]"
              placeholder={t.searchUnit}
              aria-label={t.searchUnit}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <Select
              wrapperClassName="w-[190px]"
              aria-label={t.allDepts}
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
            >
              <option value="">{t.allDepts}</option>
              {(departments.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
              {/* Its own entry, not the blank one: "no department" is a
                  category to look for, and the blank means "don't filter". */}
              <option value={UNIT_UNASSIGNED}>{t.udbGlobal}</option>
            </Select>
            <Select
              wrapperClassName="w-[150px]"
              aria-label={t.allStatus}
              value={statusF}
              onChange={(e) => setStatusF(e.target.value)}
            >
              <option value="">{t.allStatus}</option>
              <option value="1">{t.stAktif}</option>
              <option value="0">{t.stNonaktif}</option>
            </Select>
            <Select
              wrapperClassName="w-[140px]"
              aria-label={t.allFtw}
              value={ftwF}
              onChange={(e) => setFtwF(e.target.value)}
            >
              <option value="">{t.allFtw}</option>
              <option value="1">FTW</option>
              <option value="0">Non-FTW</option>
            </Select>
            <Button variant="secondary" onClick={exportSheet}>
              <Download />
              {t.export}
            </Button>
            {/* A page of its own, as the account import is: the flow carries
                two tables and should not push this list off the screen. */}
            {canW ? (
              <Button
                variant="secondary"
                onClick={() => router.push(`${base}/import`)}
              >
                <Upload />
                {t.udbImport}
              </Button>
            ) : null}
            {/* Appended so the controls either side keep their position when a
                selection appears and disappears. */}
            {canW && selectedRows.length ? (
              <Button variant="destructive" onClick={() => setBulkOpen(true)}>
                <Trash2 />
                {t.mdBulkDel} ({selectedRows.length})
              </Button>
            ) : null}
          </ToolbarGroup>
        </Toolbar>

        {unitsQ.isPending ? (
          <TableSkeleton rows={8} />
        ) : pg.rows.length ? (
          <div className="overflow-x-auto">
            <Table className="min-w-[1500px]">
              <TableHeader>
                <tr>
                  {canW ? (
                    <TableHead style={{ width: 44 }}>
                      <Checkbox
                        ref={(el) => {
                          // Indeterminate is a DOM property, not an attribute —
                          // there is no way to express it in JSX.
                          if (el) el.indeterminate = somePageSel && !allPageSel;
                        }}
                        checked={allPageSel}
                        onChange={togglePage}
                        aria-label={t.mdSelAll}
                      />
                    </TableHead>
                  ) : null}
                  {heads.map((h) => (
                    <TableHead key={h.label} style={h.style}>
                      {h.label}
                    </TableHead>
                  ))}
                </tr>
              </TableHeader>
              <TableBody>
                {pg.rows.map((u) => (
                  <TableRow key={u.id} selected={sel.has(u.code)}>
                    {canW ? (
                      <TableCell>
                        <Checkbox
                          checked={sel.has(u.code)}
                          onChange={() => toggleRow(u.code)}
                          aria-label={`${t.mdSelRow} — ${u.code}`}
                        />
                      </TableCell>
                    ) : null}
                    <TableCell>
                      <NameCell name={u.code} />
                    </TableCell>
                    {/* Names come resolved from the API, so renaming a class
                        shows here immediately with no per-unit update. */}
                    <TableCell>
                      <Badge variant="info">{u.className}</Badge>
                    </TableCell>
                    <TableCell className="text-(--text-secondary)">
                      {u.typeName}
                    </TableCell>
                    <TableCell>{u.modelName}</TableCell>
                    <TableCell>{u.brandName}</TableCell>
                    <TableCell className="text-(--text-secondary)">
                      {u.simperCodeName ?? "—"}
                    </TableCell>
                    {/* Named rather than dashed: no department is a category
                        here — a company-wide asset — not a blank to be filled. */}
                    <TableCell className="text-(--text-secondary)">
                      {u.departmentName ?? (
                        <span className="text-(--text-tertiary) italic">
                          {t.udbGlobal}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-(--text-secondary)">
                      {u.serial}
                    </TableCell>
                    <TableCell className="text-(--text-secondary)">
                      {u.engineBrand}
                    </TableCell>
                    <TableCell className="text-(--text-secondary)">
                      {u.description}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        {u.active ? (
                          <Badge variant="success" dot>
                            {t.stAktif}
                          </Badge>
                        ) : (
                          <Badge variant="danger" dot>
                            {t.stNonaktif}
                          </Badge>
                        )}
                        {u.standby ? (
                          <Badge variant="warning" dot>
                            Standby
                          </Badge>
                        ) : null}
                        {u.breakdown ? (
                          <Badge variant="danger" dot>
                            Breakdown
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      {/* Both states get a badge. A dash reads as "not
                          recorded", and not being fit to work is a fact about
                          the unit rather than a field nobody filled in. */}
                      <Badge variant={u.ftw ? "success" : "danger"} dot>
                        {u.ftw ? "FTW" : "Non-FTW"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        {canW ? (
                          <>
                            <IconButton
                              aria-label={t.udbEditT}
                              onClick={() =>
                                router.push(
                                  `${base}/${encodeURIComponent(u.code)}/edit`
                                )
                              }
                            >
                              <Pencil />
                            </IconButton>
                            <IconButton
                              danger
                              aria-label={t.empDel}
                              onClick={() => setDelTarget(u)}
                            >
                              <Trash2 />
                            </IconButton>
                          </>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <StateBox
            icon={<Search className="text-(--color-primary-bright)" />}
            title={t.noResTitle}
            body={t.usEmptyB}
          />
        )}

        <PanelFoot>
          <FootSum>
            {t.attSumA} <b>{pg.range}</b> {t.attSumB} <b>{pg.total}</b>{" "}
            {t.udbSumB}
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

      <Dialog
        open={!!delTarget}
        onClose={() => setDelTarget(null)}
        labelledBy="udbd-t"
      >
        <DialogIcon variant="danger">
          <Trash2 />
        </DialogIcon>
        {/* Unit wording throughout. This dialog was reading from the master
            catalogue's strings, so it offered to delete an *entry* and its
            button said "Hapus karyawan". */}
        <DialogTitle id="udbd-t">
          {t.udbDelT} &ldquo;{delTarget?.code}&rdquo;?
        </DialogTitle>
        <DialogBody>{t.udbDelB}</DialogBody>
        <DialogActions>
          <Button variant="ghost" onClick={() => setDelTarget(null)}>
            {t.btnCancel}
          </Button>
          <Button
            variant="destructive"
            disabled={del.isPending}
            onClick={() => delTarget && del.mutate(delTarget)}
          >
            {t.udbDelDo}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        labelledBy="udbb-t"
      >
        <DialogIcon variant="danger">
          <Trash2 />
        </DialogIcon>
        <DialogTitle id="udbb-t">{t.udbBulkDelT}</DialogTitle>
        <DialogBody>
          <b>{selectedRows.length}</b> {t.udbSumB} — {t.udbBulkDelB}
        </DialogBody>
        <DialogActions>
          <Button variant="ghost" onClick={() => setBulkOpen(false)}>
            {t.btnCancel}
          </Button>
          <Button
            variant="destructive"
            disabled={bulkDel.isPending || !selectedRows.length}
            onClick={() => bulkDel.mutate(selectedRows.map((r) => r.code))}
          >
            {t.mdBulkDel}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
