"use client";

import * as React from "react";
import { Pencil, Plus, Rows3, Search, Trash2 } from "lucide-react";

import { MENU_LABELS, type AccessMode, type MenuSlug } from "@/lib/access";
import { useI18n } from "@/lib/i18n";
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

export type MasterCat =
  "area-kerja" | "bus" | "lokasi-excavator" | "running-text";

type ColKey = "name" | "a" | "b";
type Col = {
  key: ColKey;
  label: string;
  kind?: "text" | "time" | "select" | "color";
  opts?: string[];
};
type Entry = {
  id: string;
  name: string;
  a: string;
  b: string;
  active: boolean;
};

const RUNTEXT_TARGETS = ["Semua kiosk", "Display Attendance", "Display Fleet"];
const RUNTEXT_COLORS = ["Cyan", "Oranye", "Putih", "Merah"];
const COLOR_VAL: Record<string, string> = {
  Cyan: "#00D4FF",
  Oranye: "#E99B2A",
  Putih: "#FFFFFF",
  Merah: "#FC3C3B",
};

function colsFor(
  cat: MasterCat,
  mdNama: string,
  thCat: string,
  mdJam: string
): Col[] {
  switch (cat) {
    case "area-kerja":
      return [
        { key: "name", label: mdNama },
        { key: "a", label: thCat },
      ];
    case "bus":
      return [
        { key: "name", label: "Kode" },
        { key: "a", label: "Tipe" },
        { key: "b", label: mdJam, kind: "time" },
      ];
    case "lokasi-excavator":
      return [
        { key: "name", label: mdNama },
        { key: "a", label: "Area" },
      ];
    case "running-text":
      return [
        { key: "name", label: "Teks" },
        { key: "a", label: "Target", kind: "select", opts: RUNTEXT_TARGETS },
        { key: "b", label: "Warna", kind: "color", opts: RUNTEXT_COLORS },
      ];
  }
}

const SAMPLE: Record<MasterCat, Entry[]> = {
  "area-kerja": [
    { id: "a1", name: "Pit 3", a: "Tambang", active: true, b: "" },
    { id: "a2", name: "Disposal Utara", a: "Disposal", active: true, b: "" },
    { id: "a3", name: "Workshop", a: "Support", active: false, b: "" },
  ],
  bus: [
    { id: "b1", name: "BUS-01", a: "Hino RK8", b: "05:30", active: true },
    { id: "b2", name: "BUS-02", a: "Mercedes OH", b: "17:30", active: true },
  ],
  "lokasi-excavator": [
    { id: "e1", name: "EX-22", a: "Pit 3", b: "", active: true },
    { id: "e2", name: "EX-07", a: "Disposal Utara", b: "", active: true },
  ],
  "running-text": [
    {
      id: "t1",
      name: "Selamat datang di UNIVERSE",
      a: "Semua kiosk",
      b: "Cyan",
      active: true,
    },
    {
      id: "t2",
      name: "Utamakan keselamatan kerja",
      a: "Display Fleet",
      b: "Oranye",
      active: true,
    },
  ],
};

export function MasterMenu({
  mode,
  cat,
}: {
  mode: AccessMode;
  cat: MasterCat;
}) {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const canW = mode === "manage";
  const catLabel = MENU_LABELS[cat as MenuSlug];
  const cols = colsFor(cat, t.mdNama, t.thCat, t.mdJam);

  const [entries, setEntries] = React.useState<Entry[]>(() => SAMPLE[cat]);
  const [q, setQ] = React.useState("");
  const [stF, setStF] = React.useState("");

  // add/edit dialog
  const [dlgOpen, setDlgOpen] = React.useState(false);
  const [editId, setEditId] = React.useState<string | null>(null);
  const [fName, setFName] = React.useState("");
  const [fA, setFA] = React.useState("");
  const [fB, setFB] = React.useState("");
  const [fActive, setFActive] = React.useState(true);
  const [errName, setErrName] = React.useState(false);
  const [delTarget, setDelTarget] = React.useState<Entry | null>(null);

  const rows = entries.filter((r) => {
    if (stF === "1" && !r.active) return false;
    if (stF === "0" && r.active) return false;
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return `${r.name} ${r.a} ${r.b}`.toLowerCase().includes(needle);
  });
  const pg = usePagination(rows);

  function openAdd() {
    setEditId(null);
    setFName("");
    setFA(cols.find((c) => c.key === "a")?.opts?.[0] ?? "");
    setFB(cols.find((c) => c.key === "b")?.opts?.[0] ?? "");
    setFActive(true);
    setErrName(false);
    setDlgOpen(true);
  }
  function openEdit(r: Entry) {
    setEditId(r.id);
    setFName(r.name);
    setFA(r.a);
    setFB(r.b);
    setFActive(r.active);
    setErrName(false);
    setDlgOpen(true);
  }
  function save(e: React.FormEvent) {
    e.preventDefault();
    const name = fName.trim();
    setErrName(!name);
    if (!name) return;
    if (editId) {
      setEntries((prev) =>
        prev.map((r) =>
          r.id === editId ? { ...r, name, a: fA, b: fB, active: fActive } : r
        )
      );
      pushToast("success", t.mdEditToastT, name);
    } else {
      setEntries((prev) => [
        {
          id: `n${prev.length + 1}-${name}`,
          name,
          a: fA,
          b: fB,
          active: fActive,
        },
        ...prev,
      ]);
      pushToast("success", t.mdAddToastT, name);
    }
    setDlgOpen(false);
  }
  function doDelete() {
    if (!delTarget) return;
    setEntries((prev) => prev.filter((r) => r.id !== delTarget.id));
    pushToast("success", t.mdDelToastT, delTarget.name);
    setDelTarget(null);
  }

  const fieldValue = (key: ColKey) =>
    key === "name" ? fName : key === "a" ? fA : fB;
  const setFieldValue = (key: ColKey, v: string) =>
    key === "name" ? setFName(v) : key === "a" ? setFA(v) : setFB(v);

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={catLabel} sub={t.mdSub}>
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
          </ToolbarGroup>
        </Toolbar>

        {rows.length ? (
          <Table>
            <TableHeader>
              <tr>
                {cols.map((c) => (
                  <TableHead key={c.key}>{c.label}</TableHead>
                ))}
                <TableHead>{t.thStatus}</TableHead>
                <TableHead style={{ width: 110 }}>{t.thAct}</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {pg.rows.map((r) => (
                <TableRow key={r.id}>
                  {cols.map((c) => (
                    <TableCell key={c.key} className="max-w-[420px]">
                      {c.kind === "color" ? (
                        <span className="inline-flex items-center gap-2">
                          <i
                            className="inline-block size-3 rounded"
                            style={{ background: COLOR_VAL[r[c.key]] }}
                          />
                          {r[c.key]}
                        </span>
                      ) : c.key === "name" ? (
                        <span className="font-semibold">{r.name}</span>
                      ) : (
                        <span className="text-(--text-secondary)">
                          {r[c.key]}
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
                    {canW ? (
                      <div className="flex gap-2">
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
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <StateBox
            icon={<Search className="text-(--color-primary-bright)" />}
            title={t.noResTitle}
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
        <DialogTitle id="md-t">{editId ? t.mdEditT : t.mdAdd}</DialogTitle>
        <DialogBody>{t.mdDlgB}</DialogBody>
        <form onSubmit={save} noValidate>
          {cols.map((c) => (
            <Field
              key={c.key}
              className="mt-4"
              label={c.label}
              htmlFor={`md-f-${c.key}`}
              required={c.key === "name"}
              error={c.key === "name" && errName}
              errorMessage={c.key === "name" ? t.mdErrName : undefined}
            >
              {c.kind === "select" || c.kind === "color" ? (
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
              ) : c.kind === "time" ? (
                <Input
                  id={`md-f-${c.key}`}
                  type="time"
                  className="font-mono"
                  value={fieldValue(c.key)}
                  onChange={(e) => setFieldValue(c.key, e.target.value)}
                />
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
            <Button type="submit">
              {editId ? t.udbSaveEdit : t.mdSaveAdd}
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
          <Button variant="destructive" onClick={doDelete}>
            {t.empDelDo}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
