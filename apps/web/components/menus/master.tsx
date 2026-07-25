"use client";

import * as React from "react";
import {
  Download,
  Pencil,
  Play,
  Plus,
  Rows3,
  Search,
  Trash2,
  Upload,
  Volume2,
} from "lucide-react";

import { MENU_LABELS, type AccessMode, type MenuSlug } from "@/lib/access";
import { AREA_KERJA, AREA_TIPE } from "@/lib/area-data";
import { DEPARTEMEN } from "@/lib/departemen-data";
import {
  COLOR_VAL,
  RUNNING_TEXTS,
  RUNTEXT_COLORS,
  soundFileByName,
  SOUNDS,
  soundSrc,
  TIMELINE,
} from "@/lib/display-data";
import { useI18n } from "@/lib/i18n";
import { UNITS } from "@/lib/unit-data";
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
  | "jenis-unit"
  | "model-unit"
  | "merk-unit"
  | "kelas-unit"
  | "simper"
  | "departemen"
  | "area-kerja"
  | "bus"
  | "mess"
  | "running-text"
  | "sound"
  | "timeline";

type ColKey = "name" | "a" | "b" | "c";
type Col = {
  key: ColKey;
  label: string;
  kind?: "text" | "time" | "select" | "color" | "file";
  opts?: string[];
};
type Entry = {
  id: string;
  name: string;
  a: string;
  b: string;
  c?: string;
  active: boolean;
};

/* kode bus = unit dgn jenis BUS (belum ada di fleet saat ini) */
const BUS_UNIT_CODES = UNITS.filter((u) => u.egiType === "BUS").map(
  (u) => u.code
);

const SAMPLE: Record<MasterCat, Entry[]> = {
  "jenis-unit": [
    { id: "g1", name: "EXCAVATOR", a: "", b: "", active: true },
    { id: "g2", name: "WHEEL EXCAVATOR", a: "", b: "", active: true },
    { id: "g3", name: "RIGID", a: "", b: "", active: true },
    { id: "g4", name: "DUMPTRUCK", a: "", b: "", active: true },
  ],
  "model-unit": [
    { id: "m1", name: "EX2600-7BH", a: "", b: "", active: true },
    { id: "m2", name: "EX2000-7BH", a: "", b: "", active: true },
    { id: "m3", name: "ZX870LCH-5G", a: "", b: "", active: true },
    { id: "m4", name: "ZX470LC-5G", a: "", b: "", active: true },
    { id: "m5", name: "SY215W", a: "", b: "", active: true },
    { id: "m6", name: "777E", a: "", b: "", active: true },
    { id: "m7", name: "773E", a: "", b: "", active: true },
    { id: "m8", name: "SYZ440C", a: "", b: "", active: true },
    { id: "m9", name: "SYZ320C-8W(R)", a: "", b: "", active: true },
  ],
  "merk-unit": [
    { id: "p1", name: "HITACHI", a: "", b: "", active: true },
    { id: "p2", name: "SANY", a: "", b: "", active: true },
    { id: "p3", name: "CATERPILLAR", a: "", b: "", active: true },
  ],
  "kelas-unit": [
    {
      id: "k1",
      name: "BIGDIGGER",
      a: "Excavator besar (250T)",
      b: "",
      active: true,
    },
    {
      id: "k2",
      name: "MEDIUMDIGGER",
      a: "Excavator sedang (80T)",
      b: "",
      active: true,
    },
    {
      id: "k3",
      name: "SMALLDIGGER",
      a: "Excavator kecil (40T)",
      b: "",
      active: true,
    },
    {
      id: "k4",
      name: "WHEEL EXCAVATOR",
      a: "Excavator roda (20T)",
      b: "",
      active: true,
    },
    {
      id: "k5",
      name: "DUMPTRUCKCAT100T",
      a: "Rigid dump truck 100T",
      b: "",
      active: true,
    },
    {
      id: "k6",
      name: "DUMPTRUCK60T",
      a: "Rigid dump truck 60T",
      b: "",
      active: true,
    },
    {
      id: "k7",
      name: "DUMPTRUCK40T",
      a: "Dump truck 40T",
      b: "",
      active: true,
    },
    {
      id: "k8",
      name: "DUMPTRUCK30T",
      a: "Dump truck 30T",
      b: "",
      active: true,
    },
  ],
  simper: [
    { id: "sp1", name: "F", a: "Full permit", b: "", active: true },
    { id: "sp2", name: "P", a: "Probation", b: "", active: true },
  ],
  departemen: DEPARTEMEN.map((d, i) => ({
    id: `dp${i + 1}`,
    name: d.name,
    a: d.desc,
    b: "",
    active: true,
  })),
  "area-kerja": AREA_KERJA.map((a) => ({
    id: a.id,
    name: a.name,
    a: a.tipe,
    b: "",
    active: true,
  })),
  bus: [],
  mess: [
    { id: "ms1", name: "Mess A", a: "", b: "", active: true },
    { id: "ms2", name: "Mess B", a: "", b: "", active: true },
    { id: "ms3", name: "Mess C", a: "", b: "", active: true },
  ],
  /* Running Text, Sound & Timeline berbagi sumber dgn kiosk (lib/display-data) */
  "running-text": RUNNING_TEXTS.map((r) => ({
    id: r.id,
    name: r.text,
    a: "",
    b: r.color,
    active: r.active,
  })),
  sound: SOUNDS.map((s) => ({
    id: s.id,
    name: s.name,
    a: s.file,
    b: "",
    active: s.active,
  })),
  timeline: TIMELINE.map((e) => ({
    id: e.id,
    name: e.name,
    a: e.time,
    b: e.runningText,
    c: e.sound,
    active: e.active,
  })),
};

/* opsi dropdown timeline ditarik dari master Running Text & Sound */
const RUNTEXT_OPTS = RUNNING_TEXTS.map((r) => r.text);
const SOUND_OPTS = SOUNDS.map((s) => s.name);

function colsFor(
  cat: MasterCat,
  mdNama: string,
  thCat: string,
  mdJam: string
): Col[] {
  switch (cat) {
    case "jenis-unit":
    case "model-unit":
    case "merk-unit":
      return [{ key: "name", label: mdNama }];
    case "kelas-unit":
      return [
        { key: "name", label: "Kode" },
        { key: "a", label: "Deskripsi" },
      ];
    case "simper":
      return [
        { key: "name", label: "Kode" },
        { key: "a", label: "Tipe SIMPER" },
      ];
    case "departemen":
      return [
        { key: "name", label: "Departemen" },
        { key: "a", label: "Deskripsi" },
      ];
    case "area-kerja":
      return [
        { key: "name", label: mdNama },
        { key: "a", label: thCat, kind: "select", opts: AREA_TIPE },
      ];
    case "bus":
      return [
        { key: "name", label: "Kode", kind: "select", opts: BUS_UNIT_CODES },
        { key: "b", label: mdJam, kind: "time" },
      ];
    case "mess":
      return [{ key: "name", label: mdNama }];
    case "running-text":
      return [
        { key: "name", label: "Teks" },
        { key: "b", label: "Warna", kind: "color", opts: RUNTEXT_COLORS },
      ];
    case "sound":
      return [
        { key: "name", label: mdNama },
        { key: "a", label: "File", kind: "file" },
      ];
    case "timeline":
      return [
        { key: "name", label: mdNama },
        { key: "a", label: mdJam, kind: "time" },
        { key: "b", label: "Running Text", kind: "select", opts: RUNTEXT_OPTS },
        { key: "c", label: "Sound", kind: "select", opts: SOUND_OPTS },
      ];
  }
}

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
  const [fC, setFC] = React.useState("");
  const [fActive, setFActive] = React.useState(true);
  const [errName, setErrName] = React.useState(false);
  const [delTarget, setDelTarget] = React.useState<Entry | null>(null);
  // upload file (Sound): input tersembunyi + object URL utk preview file baru
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [fFileUrl, setFFileUrl] = React.useState<string | null>(null);
  // import/export Excel (stub — logika parsing menyusul)
  const importRef = React.useRef<HTMLInputElement>(null);
  const exportStub = () => pushToast("info", t.toastExportT, `${cat}.xlsx`);

  const rows = entries.filter((r) => {
    if (stF === "1" && !r.active) return false;
    if (stF === "0" && r.active) return false;
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return `${r.name} ${r.a} ${r.b} ${r.c ?? ""}`
      .toLowerCase()
      .includes(needle);
  });
  const pg = usePagination(rows);

  function openAdd() {
    setEditId(null);
    setFName(cols.find((c) => c.key === "name")?.opts?.[0] ?? "");
    setFA(cols.find((c) => c.key === "a")?.opts?.[0] ?? "");
    setFB(cols.find((c) => c.key === "b")?.opts?.[0] ?? "");
    setFC(cols.find((c) => c.key === "c")?.opts?.[0] ?? "");
    setFActive(true);
    setErrName(false);
    setFFileUrl(null);
    setDlgOpen(true);
  }
  function openEdit(r: Entry) {
    setEditId(r.id);
    setFName(r.name);
    setFA(r.a);
    setFB(r.b);
    setFC(r.c ?? "");
    setFActive(r.active);
    setErrName(false);
    setFFileUrl(null);
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
          r.id === editId
            ? { ...r, name, a: fA, b: fB, c: fC, active: fActive }
            : r
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
          c: fC,
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
    key === "name" ? fName : key === "a" ? fA : key === "b" ? fB : fC;
  const setFieldValue = (key: ColKey, v: string) =>
    key === "name"
      ? setFName(v)
      : key === "a"
        ? setFA(v)
        : key === "b"
          ? setFB(v)
          : setFC(v);

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
            {/* Import/Export Excel — sejajar toolbar spt Database Unit (stub) */}
            <Button variant="secondary" onClick={exportStub}>
              <Download />
              {t.export}
            </Button>
            {canW ? (
              <>
                <input
                  ref={importRef}
                  type="file"
                  accept=".csv,.xlsx"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) pushToast("success", `Import ${catLabel}`, f.name);
                    e.target.value = "";
                  }}
                />
                <Button
                  variant="secondary"
                  onClick={() => importRef.current?.click()}
                >
                  <Upload />
                  {t.udbImport}
                </Button>
              </>
            ) : null}
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
                            style={{ background: COLOR_VAL[r[c.key] ?? ""] }}
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
                    <div className="flex gap-2">
                      {cat === "sound" && r.a ? (
                        <IconButton
                          aria-label="Putar"
                          onClick={() =>
                            void new Audio(soundSrc(r.a)).play().catch(() => {})
                          }
                        >
                          <Volume2 />
                        </IconButton>
                      ) : null}
                      {cat === "timeline" ? (
                        <IconButton
                          aria-label="Preview"
                          onClick={() => {
                            const file = soundFileByName(r.c ?? "");
                            if (file)
                              void new Audio(soundSrc(file))
                                .play()
                                .catch(() => {});
                            pushToast("success", r.b, r.name);
                          }}
                        >
                          <Play />
                        </IconButton>
                      ) : null}
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
              ) : c.kind === "file" ? (
                <div className="flex items-center gap-3">
                  <input
                    ref={fileRef}
                    id={`md-f-${c.key}`}
                    type="file"
                    accept="audio/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        setFieldValue(c.key, f.name);
                        setFFileUrl(URL.createObjectURL(f));
                      }
                      e.target.value = "";
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => fileRef.current?.click()}
                  >
                    <Upload />
                    Pilih file
                  </Button>
                  {fieldValue(c.key) ? (
                    <>
                      <span className="min-w-0 flex-1 truncate text-sm text-(--text-secondary)">
                        {fieldValue(c.key)}
                      </span>
                      <IconButton
                        type="button"
                        aria-label="Putar"
                        onClick={() =>
                          void new Audio(
                            fFileUrl ?? soundSrc(fieldValue(c.key))
                          )
                            .play()
                            .catch(() => {})
                        }
                      >
                        <Volume2 />
                      </IconButton>
                    </>
                  ) : (
                    <span className="flex-1 text-sm text-(--text-tertiary) italic">
                      Belum ada file
                    </span>
                  )}
                </div>
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
