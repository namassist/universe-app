"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Download,
  Pencil,
  Plus,
  Rows3,
  Search,
  Trash2,
  Upload,
} from "lucide-react";

import { MENU_LABELS, type MasterKind } from "@universe/contracts";

import type { AccessMode } from "@/lib/access";
import { api, errorMessage, fetchBlob } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
  masterQueryOptions,
  recordCode,
  recordDescription,
  recordFleetAllocation,
  recordParentId,
  type MasterRecord,
} from "@/lib/queries/master";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Checkbox, ToggleRow } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogIcon,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { useToast } from "@/components/ui/toast";

/**
 * The ten lookup catalogues, through one component and one route (design D3).
 *
 * The static port flattened every category into `{ name, a, b, c }`, where `a`
 * meant "description" here and "type" there. That is gone: `colsFor` names each
 * catalogue's real field, and a row is read by that name rather than by
 * position — which is also what lets the API describe each catalogue honestly
 * in its OpenAPI document.
 *
 * The four screens that used to ride this component and are not catalogues —
 * Bus, Running Text, Sound, Timeline — now have their own, because they never
 * shared a domain with these, only a table with a dialog.
 */

type Extra = "none" | "description";

const EXTRA_OF_KIND: Record<MasterKind, Extra> = {
  "jenis-unit": "none",
  "model-unit": "none",
  "merk-unit": "none",
  mess: "none",
  "kelas-unit": "description",
  simper: "description",
  "kode-simper": "description",
  departemen: "description",
  perusahaan: "description",
  jabatan: "description",
};

/**
 * Which catalogue owns which, mirroring the two foreign keys the API added.
 *
 * The owner is chosen when the record is created and never afterwards: moving
 * a department to another company would move every employee in it, so the
 * field is offered on add and disabled on edit. The API refuses the change
 * regardless — this only keeps the screen from suggesting it.
 */
const PARENT_OF_KIND: Partial<
  Record<MasterKind, { kind: MasterKind; field: "companyId" | "departmentId" }>
> = {
  departemen: { kind: "perusahaan", field: "companyId" },
  jabatan: { kind: "departemen", field: "departmentId" },
};

type Col = {
  key: "name" | "description" | "code" | "parent" | "fleet";
  label: string;
  kind?: "text" | "select" | "bool";
  opts?: readonly string[];
};

function colsFor(kind: MasterKind, t: ReturnType<typeof useI18n>["t"]): Col[] {
  const name: Col = {
    key: "name",
    label:
      kind === "kelas-unit" || kind === "simper" || kind === "kode-simper"
        ? "Kode"
        : kind === "departemen"
          ? "Departemen"
          : kind === "perusahaan" || kind === "jabatan"
            ? MENU_LABELS[kind]
            : t.mdNama,
  };
  // The owner leads, because it is what the row's identity starts with: two
  // departments may share a name and the company is what tells them apart.
  const parent = PARENT_OF_KIND[kind];
  const lead: Col[] = parent
    ? [{ key: "parent", label: MENU_LABELS[parent.kind], kind: "select" }]
    : [];
  const code: Col[] =
    kind === "perusahaan" ? [{ key: "code", label: t.mdCode }] : [];
  const fleet: Col[] =
    kind === "jabatan"
      ? [{ key: "fleet", label: t.mdFleet, kind: "bool" }]
      : [];

  switch (EXTRA_OF_KIND[kind]) {
    case "description":
      return [
        ...lead,
        name,
        ...code,
        { key: "description", label: t.mdDesc },
        ...fleet,
      ];
    default:
      return [name];
  }
}

/** Matches `maxItems` on the bulk-delete route; see the mutation for why. */
const BULK_CHUNK = 200;

const valueOf = (row: MasterRecord, key: Col["key"]): string =>
  key === "name"
    ? row.name
    : key === "description"
      ? recordDescription(row)
      : key === "code"
        ? recordCode(row)
        : key === "parent"
          ? recordParentId(row)
          : recordFleetAllocation(row)
            ? "1"
            : "0";

export function MasterMenu({
  mode,
  cat,
}: {
  mode: AccessMode;
  cat: MasterKind;
}) {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const router = useRouter();
  const canW = mode === "manage";
  const catLabel = MENU_LABELS[cat];
  const cols = colsFor(cat, t);
  const extra = EXTRA_OF_KIND[cat];
  const parent = PARENT_OF_KIND[cat];

  /**
   * The owner catalogue, for the two kinds that have one.
   *
   * Active-only, matching every other selection list: a retired company is not
   * somewhere to file a new department. `enabled` rather than a conditional
   * hook — the kind is a prop and could change under the same mounted
   * component.
   */
  const parentQ = useQuery({
    ...masterQueryOptions(parent?.kind ?? "perusahaan", true),
    enabled: Boolean(parent),
  });
  /** Only for `jabatan`, to say which company a department belongs to. */
  const grandparentQ = useQuery({
    ...masterQueryOptions("perusahaan", true),
    enabled: cat === "jabatan",
  });

  const parentLabel = React.useCallback(
    (id: string) => {
      const row = (parentQ.data ?? []).find((r) => r.id === id);
      if (!row) return "—";
      if (cat !== "jabatan") return row.name;
      const company = (grandparentQ.data ?? []).find(
        (c) => c.id === recordParentId(row)
      );
      return company ? `${recordCode(company)} / ${row.name}` : row.name;
    },
    [parentQ.data, grandparentQ.data, cat]
  );

  // The management list, not the selection list: inactive records belong here
  // and nowhere a value is being chosen.
  const listQ = useQuery(masterQueryOptions(cat));
  const entries = React.useMemo(() => listQ.data ?? [], [listQ.data]);

  const [q, setQ] = React.useState("");
  const [stF, setStF] = React.useState("");

  const [dlgOpen, setDlgOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<MasterRecord | null>(null);
  const [fName, setFName] = React.useState("");
  const [fDesc, setFDesc] = React.useState("");
  const [fCode, setFCode] = React.useState("");
  const [fParent, setFParent] = React.useState("");
  const [fFleet, setFFleet] = React.useState(false);
  /** Toolbar filter: which owner's rows to show. `""` is all of them. */
  const [parentF, setParentF] = React.useState("");
  const [fActive, setFActive] = React.useState(true);
  const [errName, setErrName] = React.useState(false);
  const [errParent, setErrParent] = React.useState(false);
  const [delTarget, setDelTarget] = React.useState<MasterRecord | null>(null);

  /**
   * Selection is a set of ids, not of rows: the list is refetched after every
   * write, and holding row objects would keep a tick attached to a stale copy
   * of a record whose name has since changed underneath it.
   */
  const [sel, setSel] = React.useState<ReadonlySet<string>>(() => new Set());
  const [bulkOpen, setBulkOpen] = React.useState(false);

  // Resolved against the whole list rather than the filtered one, so typing in
  // the search box does not silently drop entries already ticked on another
  // page. Ids that no longer exist fall out here without needing to be pruned.
  const selectedRows = React.useMemo(
    () => entries.filter((r) => sel.has(r.id)),
    [entries, sel]
  );

  /**
   * Invalidate rather than `router.refresh()`: the list is client state owned
   * by the query cache, and a route refresh would re-render the shell around it
   * without touching the data that changed.
   *
   * Both entries for this kind, not just the one this screen reads: the
   * management list and the active-only selection list are separate cache
   * entries, and a record deactivated here has to leave every dropdown too.
   */
  const invalidateAll = () =>
    queryClient.invalidateQueries({ queryKey: ["master", cat] });

  const save = useMutation({
    mutationFn: async (input: {
      id: string | null;
      name: string;
      description: string;
      code: string;
      parentId: string;
      fleetAllocation: boolean;
      active: boolean;
    }) => {
      const body = {
        name: input.name,
        ...(extra === "description" ? { description: input.description } : {}),
        ...(cat === "perusahaan" ? { code: input.code } : {}),
        ...(cat === "jabatan"
          ? { fleetAllocation: input.fleetAllocation }
          : {}),
        active: input.active,
      };
      const result = input.id
        ? await api.v1.master({ kind: cat })({ id: input.id }).patch(body)
        : // The owner is sent on create only. The API ignores it on an edit,
          // so sending it would be a promise this screen cannot keep.
          await api.v1
            .master({ kind: cat })
            .post(parent ? { ...body, [parent.field]: input.parentId } : body);
      if (result.error) throw result.error;
      return result.data;
    },
    onSuccess: async (_data, input) => {
      await invalidateAll();
      pushToast(
        "success",
        input.id ? t.mdEditToastT : t.mdAddToastT,
        input.name
      );
      setDlgOpen(false);
    },
    // The API's own message, not a generic one: a 409 here is a
    // case-insensitive duplicate, and saying so is the difference between the
    // operator fixing it and retyping the same name.
    onError: (error) =>
      pushToast("error", t.mdAdd, errorMessage(error, t.loginErr)),
  });

  const del = useMutation({
    mutationFn: async (row: MasterRecord) => {
      const { error } = await api.v1
        .master({ kind: cat })({ id: row.id })
        .delete();
      if (error) throw error;
    },
    onSuccess: async (_data, row) => {
      await invalidateAll();
      pushToast("success", t.mdDelToastT, row.name);
      setDelTarget(null);
      setSel((prev) => {
        if (!prev.has(row.id)) return prev;
        const next = new Set(prev);
        next.delete(row.id);
        return next;
      });
    },
    // A refused delete carries the referencing count, which is what tells the
    // operator to deactivate instead. The list is untouched either way.
    onError: (error) =>
      pushToast("error", t.mdDelT, errorMessage(error, t.loginErr)),
  });

  const bulkDel = useMutation({
    /**
     * Chunked to the endpoint's own `maxItems`, so a selection accumulated
     * across pages cannot fail as a whole on a cap the operator never sees.
     * The route deletes one row per statement and reports what it refused, so
     * merging chunk results loses nothing.
     */
    mutationFn: async (ids: string[]) => {
      let deleted = 0;
      const blocked: { id: string; name: string; references: number }[] = [];
      for (let i = 0; i < ids.length; i += BULK_CHUNK) {
        const result = await api.v1
          .master({ kind: cat })
          ["bulk-delete"].post({ ids: ids.slice(i, i + BULK_CHUNK) });
        if (result.error) throw result.error;
        deleted += result.data.deleted;
        blocked.push(...result.data.blocked);
      }
      return { deleted, blocked };
    },
    onSuccess: (result) => {
      setBulkOpen(false);
      // The refused entries stay ticked. They are still in the table, and
      // leaving them selected is what shows *which* ones need dealing with,
      // rather than making the operator re-find the names from a toast.
      setSel(new Set(result.blocked.map((b) => b.id)));

      const shown = result.blocked.slice(0, 5).map((b) => b.name);
      const used = `${result.blocked.length} ${t.mdBulkUsed} ${shown.join(", ")}${
        result.blocked.length > shown.length ? ", …" : ""
      }`;

      if (!result.blocked.length)
        pushToast("success", t.mdDelToastT, `${result.deleted} ${t.mdSumB}`);
      else if (result.deleted)
        pushToast(
          "info",
          t.mdBulkPartT,
          `${result.deleted} ${t.mdSumB} — ${used}`
        );
      else pushToast("error", t.mdBulkNoneT, used);
    },
    onError: (error) =>
      pushToast("error", t.mdBulkDel, errorMessage(error, t.loginErr)),
    // In `onSettled` rather than `onSuccess`: a chunk that throws may still
    // have been preceded by chunks that landed, and the list has to catch up
    // either way.
    onSettled: () => invalidateAll(),
  });

  async function exportSheet() {
    try {
      // fetchBlob, not Eden: Treaty decodes an unrecognised body as text and
      // mangles every invalid UTF-8 byte, so the workbook downloads and then
      // refuses to open (lib/api.ts).
      const blob = await fetchBlob(`/v1/master/${cat}/export`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${cat}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      pushToast("success", t.toastExportT, `${cat}.xlsx`);
    } catch (error) {
      pushToast(
        "error",
        t.toastExportT,
        error instanceof Error ? error.message : t.loginErr
      );
    }
  }

  const rows = entries.filter((r) => {
    if (stF === "1" && !r.active) return false;
    if (stF === "0" && r.active) return false;
    // A department belongs to one company and a position to one department, so
    // "show me one owner's rows" is the question this list is most often opened
    // with once there is more than one company on site.
    if (parentF && recordParentId(r) !== parentF) return false;
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return cols.some((c) =>
      // The owner column holds an id; searching it would match nothing a person
      // could have typed, so it is searched by the name that is on screen.
      (c.key === "parent" ? parentLabel(valueOf(r, c.key)) : valueOf(r, c.key))
        .toLowerCase()
        .includes(needle)
    );
  });
  const pg = usePagination(rows);

  // The header checkbox governs the page, not the whole filtered set: ticking
  // one box and silently arming a delete over rows on four other pages is the
  // kind of help nobody asks for. Selections still accumulate across pages.
  const pageIds = pg.rows.map((r) => r.id);
  const allPageSel = pageIds.length > 0 && pageIds.every((id) => sel.has(id));
  const somePageSel = pageIds.some((id) => sel.has(id));

  function toggleRow(id: string) {
    setSel((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }
  function togglePage() {
    setSel((prev) => {
      const next = new Set(prev);
      for (const id of pageIds) {
        if (allPageSel) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  function openAdd() {
    setEditing(null);
    setFName("");
    setFDesc("");
    setFCode("");
    setFFleet(false);
    // Pre-selected when there is exactly one to choose, which is the common
    // case for a single-company installation and saves a click that has no
    // decision in it.
    setFParent(
      (parentQ.data ?? []).length === 1 ? (parentQ.data![0]!.id ?? "") : ""
    );
    setFActive(true);
    setErrName(false);
    setErrParent(false);
    setDlgOpen(true);
  }
  function openEdit(r: MasterRecord) {
    setEditing(r);
    setFName(r.name);
    setFDesc(recordDescription(r));
    setFCode(recordCode(r));
    setFParent(recordParentId(r));
    setFFleet(recordFleetAllocation(r));
    setFActive(r.active);
    setErrName(false);
    setErrParent(false);
    setDlgOpen(true);
  }
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const name = fName.trim();
    // Only on create: the owner is not editable, so an edit cannot be missing
    // one it is not being asked for.
    const missingParent = Boolean(parent) && !editing && !fParent;
    setErrName(!name);
    setErrParent(missingParent);
    if (!name || missingParent) return;
    save.mutate({
      id: editing?.id ?? null,
      name,
      description: fDesc,
      code: fCode.trim(),
      parentId: fParent,
      fleetAllocation: fFleet,
      active: fActive,
    });
  }

  const fieldValue = (key: Col["key"]) =>
    key === "name"
      ? fName
      : key === "description"
        ? fDesc
        : key === "code"
          ? fCode
          : fParent;
  const setFieldValue = (key: Col["key"], v: string) =>
    key === "name"
      ? setFName(v)
      : key === "description"
        ? setFDesc(v)
        : key === "code"
          ? setFCode(v)
          : setFParent(v);

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={catLabel} sub={t.mdSub}>
        {/* Presentation only — the API refuses every write without `manage` on
            this catalogue's own menu, regardless of what renders here. */}
        {canW ? (
          <Button onClick={openAdd}>
            <Plus />
            {t.mdAdd}
          </Button>
        ) : null}
      </PageTitle>

      <Panel>
        <Toolbar>
          <ToolbarTitle>{catLabel}</ToolbarTitle>
          <ToolbarGroup>
            <SearchInput
              className="w-[240px]"
              placeholder={t.mdSearchPh}
              aria-label={t.mdSearchPh}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {parent ? (
              <Select
                wrapperClassName="w-[220px]"
                value={parentF}
                onChange={(e) => setParentF(e.target.value)}
                aria-label={MENU_LABELS[parent.kind]}
              >
                <option value="">{`${t.allPrefix} ${MENU_LABELS[parent.kind]}`}</option>
                {(parentQ.data ?? []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {parentLabel(o.id)}
                  </option>
                ))}
              </Select>
            ) : null}
            <Select
              wrapperClassName="w-[160px]"
              value={stF}
              onChange={(e) => setStF(e.target.value)}
              aria-label={t.allStatus}
            >
              <option value="">{t.allStatus}</option>
              <option value="1">{t.stAktif}</option>
              <option value="0">{t.stNonaktif}</option>
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
                onClick={() => router.push(`/${cat}/import`)}
              >
                <Upload />
                {t.udbImport}
              </Button>
            ) : null}
            {/* Appended rather than prepended so the controls either side keep
                their position when a selection appears and disappears. */}
            {canW && selectedRows.length ? (
              <Button variant="destructive" onClick={() => setBulkOpen(true)}>
                <Trash2 />
                {t.mdBulkDel} ({selectedRows.length})
              </Button>
            ) : null}
          </ToolbarGroup>
        </Toolbar>

        {rows.length ? (
          <Table>
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
                {cols.map((c) => (
                  <TableHead key={c.key}>{c.label}</TableHead>
                ))}
                <TableHead>{t.thStatus}</TableHead>
                <TableHead style={{ width: 110 }}>{t.thAct}</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {pg.rows.map((r) => (
                <TableRow key={r.id} selected={sel.has(r.id)}>
                  {canW ? (
                    <TableCell>
                      <Checkbox
                        checked={sel.has(r.id)}
                        onChange={() => toggleRow(r.id)}
                        aria-label={`${t.mdSelRow} — ${r.name}`}
                      />
                    </TableCell>
                  ) : null}
                  {cols.map((c) => (
                    <TableCell key={c.key} className="max-w-[420px]">
                      {c.key === "name" ? (
                        <span className="font-semibold">{r.name}</span>
                      ) : c.key === "fleet" ? (
                        <Badge
                          variant={
                            recordFleetAllocation(r) ? "success" : "neutral"
                          }
                          dot
                        >
                          {recordFleetAllocation(r)
                            ? t.mdFleetYes
                            : t.mdFleetNo}
                        </Badge>
                      ) : (
                        <span className="text-(--text-secondary)">
                          {/* The stored value is an id; the column shows the
                              name, which is the only form anyone reads by. */}
                          {c.key === "parent"
                            ? parentLabel(valueOf(r, c.key))
                            : valueOf(r, c.key)}
                        </span>
                      )}
                    </TableCell>
                  ))}
                  <TableCell>
                    <Badge variant={r.active ? "success" : "danger"} dot>
                      {r.active ? t.stAktif : t.stNonaktif}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      {canW ? (
                        <>
                          <IconButton
                            aria-label={t.mdEditT}
                            onClick={() => openEdit(r)}
                          >
                            <Pencil />
                          </IconButton>
                          <IconButton
                            danger
                            aria-label={t.empDel}
                            onClick={() => setDelTarget(r)}
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
        ) : (
          <StateBox
            icon={<Search className="text-(--color-primary-bright)" />}
            title={listQ.isPending ? t.mdSub : t.noResTitle}
            body={t.mdEmptyB}
          />
        )}

        <PanelFoot>
          <FootSum>
            {t.attSumA} <b>{pg.range}</b> {t.attSumB} <b>{pg.total}</b>{" "}
            {t.mdSumB} — {catLabel}
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
        open={dlgOpen}
        onClose={() => setDlgOpen(false)}
        labelledBy="md-t"
      >
        <DialogIcon variant="info">
          <Rows3 />
        </DialogIcon>
        <DialogTitle id="md-t">{editing ? t.mdEditT : t.mdAdd}</DialogTitle>
        <DialogBody>{t.mdDlgB}</DialogBody>
        <form onSubmit={submit} noValidate>
          {cols.map((c) => (
            <Field
              key={c.key}
              className="mt-4"
              label={c.label}
              htmlFor={`md-f-${c.key}`}
              required={
                c.key === "name" || c.key === "code" || c.key === "parent"
              }
              error={
                (c.key === "name" && errName) ||
                (c.key === "parent" && errParent)
              }
              errorMessage={
                c.key === "name"
                  ? t.mdErrName
                  : c.key === "parent"
                    ? t.mdErrParent
                    : undefined
              }
              helper={
                c.key === "parent" && editing ? t.mdParentLocked : undefined
              }
            >
              {c.key === "fleet" ? (
                <ToggleRow htmlFor="md-f-fleet">
                  <Checkbox
                    id="md-f-fleet"
                    checked={fFleet}
                    onChange={(e) => setFFleet(e.target.checked)}
                  />
                  {t.mdFleetHint}
                </ToggleRow>
              ) : c.key === "parent" ? (
                <Select
                  id="md-f-parent"
                  value={fParent}
                  // Set once, at creation. Changing it would move every
                  // employee filed under this row to somewhere nobody chose,
                  // and the API refuses it regardless.
                  disabled={Boolean(editing)}
                  onChange={(e) => setFParent(e.target.value)}
                >
                  <option value="">{t.mdPickParent}</option>
                  {(parentQ.data ?? []).map((o) => (
                    <option key={o.id} value={o.id}>
                      {parentLabel(o.id)}
                    </option>
                  ))}
                </Select>
              ) : c.kind === "select" ? (
                <Select
                  id={`md-f-${c.key}`}
                  value={fieldValue(c.key)}
                  onChange={(e) => setFieldValue(c.key, e.target.value)}
                >
                  {(c.opts ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  id={`md-f-${c.key}`}
                  value={fieldValue(c.key)}
                  onChange={(e) => setFieldValue(c.key, e.target.value)}
                />
              )}
            </Field>
          ))}
          <ToggleRow className="mt-4" htmlFor="md-active">
            <Checkbox
              id="md-active"
              checked={fActive}
              onChange={(e) => setFActive(e.target.checked)}
            />
            {t.stAktif}
          </ToggleRow>
          <DialogActions>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDlgOpen(false)}
            >
              {t.btnCancel}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {editing ? t.udbSaveEdit : t.mdSaveAdd}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      <Dialog
        open={!!delTarget}
        onClose={() => setDelTarget(null)}
        labelledBy="mdd-t"
      >
        <DialogIcon variant="danger">
          <Trash2 />
        </DialogIcon>
        <DialogTitle id="mdd-t">
          {t.mdDelT} &ldquo;{delTarget?.name}&rdquo;?
        </DialogTitle>
        <DialogBody>{t.mdDelB}</DialogBody>
        <DialogActions>
          <Button variant="ghost" onClick={() => setDelTarget(null)}>
            {t.btnCancel}
          </Button>
          <Button
            variant="destructive"
            disabled={del.isPending}
            onClick={() => delTarget && del.mutate(delTarget)}
          >
            {t.mdDelDo}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        labelledBy="mdb-t"
      >
        <DialogIcon variant="danger">
          <Trash2 />
        </DialogIcon>
        <DialogTitle id="mdb-t">{t.mdBulkDelT}</DialogTitle>
        <DialogBody>
          <b>{selectedRows.length}</b> {t.mdSumB} — {t.mdBulkDelB}
        </DialogBody>
        <DialogActions>
          <Button variant="ghost" onClick={() => setBulkOpen(false)}>
            {t.btnCancel}
          </Button>
          <Button
            variant="destructive"
            disabled={bulkDel.isPending || !selectedRows.length}
            onClick={() => bulkDel.mutate(selectedRows.map((r) => r.id))}
          >
            {t.mdBulkDel}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
