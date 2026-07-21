"use client";

import * as React from "react";
import { Download, Pencil, Plus, Search, Truck, Upload } from "lucide-react";

import type { AccessMode } from "@/lib/access";
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
import { Dropzone } from "@/components/ui/dropzone";
import { Field, FormGrid } from "@/components/ui/field";
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
import { useToast } from "@/components/ui/toast";

type Unit = {
  uid: string;
  code: string;
  cls: string;
  egi: string; // model
  egiType: string; // jenis unit
  product: string;
  active: boolean;
  standby?: boolean;
  breakdown?: boolean;
  upd: string;
  by: string;
};

const CLS_OPTS = ["HD", "BIGDIGGER", "BUS", "LV"];
const MODEL_OPTS = ["HD785-7", "PC2000-8", "D375A-6", "GD825A"];
const EGI_OPTS = ["HD785", "PC2000", "D375A", "GD825A"];
const PROD_OPTS = ["Komatsu", "Hino", "Mercedes-Benz"];

/* ---- static sample content ---- */
const INITIAL: Unit[] = [
  {
    uid: "u1",
    code: "DT-101",
    cls: "HD",
    egi: "HD785-7",
    egiType: "HD785",
    product: "Komatsu",
    active: true,
    upd: "12 Jul 2026",
    by: "Admin Site",
  },
  {
    uid: "u2",
    code: "DT-102",
    cls: "HD",
    egi: "HD785-7",
    egiType: "HD785",
    product: "Komatsu",
    active: true,
    upd: "12 Jul 2026",
    by: "Admin Site",
  },
  {
    uid: "u3",
    code: "DT-104",
    cls: "HD",
    egi: "HD785-7",
    egiType: "HD785",
    product: "Komatsu",
    active: true,
    breakdown: true,
    upd: "21 Jul 2026",
    by: "Dispatcher",
  },
  {
    uid: "u4",
    code: "DT-106",
    cls: "HD",
    egi: "HD785-7",
    egiType: "HD785",
    product: "Komatsu",
    active: true,
    standby: true,
    upd: "21 Jul 2026",
    by: "Dispatcher",
  },
  {
    uid: "u5",
    code: "EX-22",
    cls: "BIGDIGGER",
    egi: "PC2000-8",
    egiType: "PC2000",
    product: "Komatsu",
    active: true,
    upd: "10 Jul 2026",
    by: "Admin Site",
  },
  {
    uid: "u6",
    code: "EX-07",
    cls: "BIGDIGGER",
    egi: "PC2000-8",
    egiType: "PC2000",
    product: "Komatsu",
    active: true,
    upd: "10 Jul 2026",
    by: "Admin Site",
  },
  {
    uid: "u7",
    code: "DZ-05",
    cls: "BIGDIGGER",
    egi: "D375A-6",
    egiType: "D375A",
    product: "Komatsu",
    active: true,
    upd: "08 Jul 2026",
    by: "Admin Site",
  },
  {
    uid: "u8",
    code: "BUS-01",
    cls: "BUS",
    egi: "GD825A",
    egiType: "Bus",
    product: "Hino",
    active: true,
    upd: "05 Jul 2026",
    by: "Admin Site",
  },
  {
    uid: "u9",
    code: "BUS-02",
    cls: "BUS",
    egi: "GD825A",
    egiType: "Bus",
    product: "Mercedes-Benz",
    active: true,
    upd: "05 Jul 2026",
    by: "Admin Site",
  },
  {
    uid: "u10",
    code: "LV-11",
    cls: "LV",
    egi: "GD825A",
    egiType: "LV",
    product: "Komatsu",
    active: false,
    upd: "01 Jul 2026",
    by: "Admin Site",
  },
];

type ImpState = {
  stage: "idle" | "progress" | "done";
  pct: number;
  name: string;
};

export function DatabaseUnitMenu({ mode }: { mode: AccessMode }) {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const canW = mode === "manage";

  const [units, setUnits] = React.useState<Unit[]>(INITIAL);
  const [q, setQ] = React.useState("");
  const [cat, setCat] = React.useState("");
  const [prod, setProd] = React.useState("");

  /* dialog tambah/edit */
  const [dlgOpen, setDlgOpen] = React.useState(false);
  const [editUid, setEditUid] = React.useState<string | null>(null);
  const [fCode, setFCode] = React.useState("");
  const [fEgi, setFEgi] = React.useState(MODEL_OPTS[0]!);
  const [fEgiType, setFEgiType] = React.useState(EGI_OPTS[0]!);
  const [fCls, setFCls] = React.useState(CLS_OPTS[0]!);
  const [fProd, setFProd] = React.useState(PROD_OPTS[0]!);
  const [fActive, setFActive] = React.useState(true);
  const [errCode, setErrCode] = React.useState(false);

  /* dialog import (progress disimulasikan) */
  const [impOpen, setImpOpen] = React.useState(false);
  const [imp, setImp] = React.useState<ImpState>({
    stage: "idle",
    pct: 0,
    name: "",
  });
  const [dragging, setDragging] = React.useState(false);
  const impTimer = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    return () => {
      if (impTimer.current) clearInterval(impTimer.current);
    };
  }, []);

  const needle = q.trim().toLowerCase();
  const rows = units.filter((u) => {
    if (cat && u.cls !== cat) return false;
    if (prod && u.product !== prod) return false;
    if (!needle) return true;
    return (
      u.code.toLowerCase().includes(needle) ||
      u.egi.toLowerCase().includes(needle) ||
      u.product.toLowerCase().includes(needle)
    );
  });
  const pg = usePagination(rows);

  function openAdd() {
    setEditUid(null);
    setFCode("");
    setFEgi(MODEL_OPTS[0]!);
    setFEgiType(EGI_OPTS[0]!);
    setFCls(CLS_OPTS[0]!);
    setFProd(PROD_OPTS[0]!);
    setFActive(true);
    setErrCode(false);
    setDlgOpen(true);
  }
  function openEdit(u: Unit) {
    setEditUid(u.uid);
    setFCode(u.code);
    setFEgi(u.egi);
    setFEgiType(u.egiType);
    setFCls(u.cls);
    setFProd(u.product);
    setFActive(u.active);
    setErrCode(false);
    setDlgOpen(true);
  }
  function save(e: React.FormEvent) {
    e.preventDefault();
    const code = fCode.trim().toUpperCase();
    const dup = units.some((u) => u.code === code && u.uid !== editUid);
    setErrCode(!code || dup);
    if (!code || dup) return;
    const patch = {
      code,
      egi: fEgi,
      egiType: fEgiType,
      cls: fCls,
      product: fProd,
      active: fActive,
      upd: "21 Jul 2026",
      by: "Superadmin",
    };
    if (editUid) {
      setUnits((prev) =>
        prev.map((u) => (u.uid === editUid ? { ...u, ...patch } : u))
      );
      pushToast("success", t.udbEditToastT, `${code} — ${fEgi} · ${fProd}`);
    } else {
      setUnits((prev) => [{ uid: `n-${code}`, ...patch }, ...prev]);
      pushToast("success", t.udbToastT, `${code} — ${fEgi} · ${fProd}`);
    }
    setDlgOpen(false);
  }

  function startImport(name: string) {
    if (impTimer.current) clearInterval(impTimer.current);
    setImp({ stage: "progress", pct: 0, name: name || "unit_import.xlsx" });
    impTimer.current = setInterval(() => {
      setImp((prev) => {
        const pct = prev.pct + 15 + Math.random() * 12;
        if (pct >= 100) {
          if (impTimer.current) clearInterval(impTimer.current);
          impTimer.current = null;
          return { ...prev, pct: 100, stage: "done" };
        }
        return { ...prev, pct };
      });
    }, 130);
  }
  function openImport() {
    if (impTimer.current) clearInterval(impTimer.current);
    impTimer.current = null;
    setImp({ stage: "idle", pct: 0, name: "" });
    setDragging(false);
    setImpOpen(true);
  }
  function doImport() {
    setImpOpen(false);
    pushToast("success", t.udbImpToastT, `10 ${t.udbImpToastD}`);
  }

  const heads = [
    t.thUnitCode,
    "Kelas Unit",
    "Model",
    "Jenis Unit",
    "Product",
    t.thStatus,
    t.thLastUpd,
    t.thAct,
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={t.navUnitDb} sub={t.udbSub}>
        {canW ? (
          <Button onClick={openAdd}>
            <Plus />
            {t.udbAdd}
          </Button>
        ) : null}
      </PageTitle>

      <Panel>
        <Toolbar>
          <ToolbarTitle>{t.udbListTitle}</ToolbarTitle>
          <ToolbarGroup>
            <SearchInput
              className="w-[240px]"
              placeholder={t.searchUnit}
              aria-label={t.searchUnit}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <Select
              wrapperClassName="w-[170px]"
              aria-label={t.allCats}
              value={cat}
              onChange={(e) => setCat(e.target.value)}
            >
              <option value="">{t.allCats}</option>
              {CLS_OPTS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
            <Select
              wrapperClassName="w-[180px]"
              aria-label={t.allProds}
              value={prod}
              onChange={(e) => setProd(e.target.value)}
            >
              <option value="">{t.allProds}</option>
              {PROD_OPTS.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </Select>
            <Button
              variant="secondary"
              onClick={() =>
                pushToast("info", t.toastExportT, "unit_database.xlsx")
              }
            >
              <Download />
              {t.export}
            </Button>
            {canW ? (
              <Button variant="secondary" onClick={openImport}>
                <Upload />
                {t.udbImport}
              </Button>
            ) : null}
          </ToolbarGroup>
        </Toolbar>

        {pg.rows.length ? (
          <Table>
            <TableHeader>
              <tr>
                {heads.map((h, i) => (
                  <TableHead
                    key={h}
                    className={i === 6 ? "max-xl:hidden" : undefined}
                    style={i === 7 ? { width: 70 } : undefined}
                  >
                    {h}
                  </TableHead>
                ))}
              </tr>
            </TableHeader>
            <TableBody>
              {pg.rows.map((u) => (
                <TableRow key={u.uid}>
                  <TableCell>
                    <NameCell name={u.code} />
                  </TableCell>
                  <TableCell>
                    <Badge variant="info">{u.cls}</Badge>
                  </TableCell>
                  <TableCell>{u.egi}</TableCell>
                  <TableCell className="text-(--text-secondary)">
                    {u.egiType}
                  </TableCell>
                  <TableCell>{u.product}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      {u.active ? (
                        <Badge variant="success" dot>
                          Aktif
                        </Badge>
                      ) : (
                        <Badge variant="danger" dot>
                          Nonaktif
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
                  <TableCell className="max-xl:hidden">
                    <NameCell
                      name={<span className="font-medium">{u.upd}</span>}
                      sub={u.by}
                    />
                  </TableCell>
                  <TableCell>
                    {canW ? (
                      <IconButton
                        aria-label={t.udbEditT}
                        onClick={() => openEdit(u)}
                      >
                        <Pencil />
                      </IconButton>
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

      {/* dialog tambah/edit unit */}
      <Dialog
        open={dlgOpen}
        onClose={() => setDlgOpen(false)}
        className="w-[min(560px,100%)]"
        labelledBy="udb-t"
      >
        <DialogIcon variant="info">
          <Truck />
        </DialogIcon>
        <DialogTitle id="udb-t">
          {editUid ? `${t.udbEditT} — ${fCode}` : t.udbAdd}
        </DialogTitle>
        <DialogBody>{editUid ? t.udbEditB : t.udbAddB}</DialogBody>
        <form onSubmit={save} noValidate>
          <FormGrid className="mt-4">
            <Field
              label={t.thUnitCode}
              htmlFor="udb-code"
              required
              error={errCode}
              errorMessage={t.udbErrCode}
            >
              <Input
                id="udb-code"
                className="font-mono"
                value={fCode}
                onChange={(e) => setFCode(e.target.value)}
              />
            </Field>
            <Field label="Kelas Unit" htmlFor="udb-cls" required>
              <Select
                id="udb-cls"
                value={fCls}
                onChange={(e) => setFCls(e.target.value)}
              >
                {CLS_OPTS.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Field label="Model" htmlFor="udb-egi" required>
              <Select
                id="udb-egi"
                value={fEgi}
                onChange={(e) => setFEgi(e.target.value)}
              >
                {MODEL_OPTS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </Select>
            </Field>
            <Field label="Jenis Unit" htmlFor="udb-type" required>
              <Select
                id="udb-type"
                value={fEgiType}
                onChange={(e) => setFEgiType(e.target.value)}
              >
                {EGI_OPTS.map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </Select>
            </Field>
            <Field label="Product" htmlFor="udb-prod" required>
              <Select
                id="udb-prod"
                value={fProd}
                onChange={(e) => setFProd(e.target.value)}
              >
                {PROD_OPTS.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </Select>
            </Field>
          </FormGrid>
          <ToggleRow className="mt-4" htmlFor="udb-active">
            <Checkbox
              id="udb-active"
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
              {editUid ? t.udbSaveEdit : t.udbAddDo}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* dialog import unit (progress disimulasikan) */}
      <Dialog
        open={impOpen}
        onClose={() => setImpOpen(false)}
        className="w-[min(520px,100%)]"
        labelledBy="udbimp-t"
      >
        <DialogIcon variant="info">
          <Upload />
        </DialogIcon>
        <DialogTitle id="udbimp-t">{t.udbImpT}</DialogTitle>
        <DialogBody>{t.udbImpB}</DialogBody>
        <div className="mt-4">
          {imp.stage === "idle" ? (
            <>
              <Dropzone
                icon={<Upload />}
                title={t.udbImpDzTitle}
                hint=".xlsx"
                aria-label={t.udbImpDzTitle}
                dragging={dragging}
                onDragChange={setDragging}
                onPick={() => fileRef.current?.click()}
                onDropFile={(name) => startImport(name)}
              />
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={(e) => {
                  const name = e.target.files?.[0]?.name;
                  if (name) startImport(name);
                  e.target.value = "";
                }}
              />
            </>
          ) : (
            <div>
              <div className="mb-2 flex justify-between text-sm">
                <span className="font-semibold">{imp.name}</span>
                <span className="font-mono text-(--text-secondary)">
                  {Math.round(imp.pct)}%
                </span>
              </div>
              <Progress value={imp.pct} />
              {imp.stage === "done" ? (
                <p className="mt-3 text-sm text-(--text-secondary)">
                  {t.udbImpSummary}
                </p>
              ) : null}
            </div>
          )}
        </div>
        <DialogActions>
          <Button variant="ghost" onClick={() => setImpOpen(false)}>
            {t.btnCancel}
          </Button>
          <Button disabled={imp.stage !== "done"} onClick={doImport}>
            {t.udbImpDoBtn}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
