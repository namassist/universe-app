"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Download, Pencil, Plus, Search, Upload } from "lucide-react";

import type { AccessMode } from "@/lib/access";
import { useI18n } from "@/lib/i18n";
import { CLS_OPTS, PROD_OPTS, UNITS } from "@/lib/unit-data";
import { useRole } from "@/components/providers/role-context";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
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

type ImpState = {
  stage: "idle" | "progress" | "done";
  pct: number;
  name: string;
};

export function DatabaseUnitMenu({ mode }: { mode: AccessMode }) {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const { role } = useRole();
  const router = useRouter();
  const base = `/${role}/database-unit`;
  const canW = mode === "manage";

  const [q, setQ] = React.useState("");
  const [cat, setCat] = React.useState("");
  const [prod, setProd] = React.useState("");

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
  const rows = UNITS.filter((u) => {
    if (cat && u.cls !== cat) return false;
    if (prod && u.product !== prod) return false;
    if (!needle) return true;
    return (
      u.code.toLowerCase().includes(needle) ||
      u.egi.toLowerCase().includes(needle) ||
      u.product.toLowerCase().includes(needle) ||
      u.serial.toLowerCase().includes(needle) ||
      u.simper.toLowerCase().includes(needle) ||
      u.departemen.toLowerCase().includes(needle)
    );
  });
  const pg = usePagination(rows);

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

  const heads: {
    label: string;
    className?: string;
    style?: React.CSSProperties;
  }[] = [
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
    { label: t.thAct, style: { width: 70 } },
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
          <div className="overflow-x-auto">
            <Table className="min-w-[1500px]">
              <TableHeader>
                <tr>
                  {heads.map((h) => (
                    <TableHead
                      key={h.label}
                      className={h.className}
                      style={h.style}
                    >
                      {h.label}
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
                    <TableCell className="text-(--text-secondary)">
                      {u.egiType}
                    </TableCell>
                    <TableCell>{u.egi}</TableCell>
                    <TableCell>{u.product}</TableCell>
                    <TableCell className="text-(--text-secondary)">
                      {u.simper}
                    </TableCell>
                    <TableCell className="text-(--text-secondary)">
                      {u.departemen}
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
                    <TableCell>
                      {u.ftw ? (
                        <Badge variant="success" dot>
                          FTW
                        </Badge>
                      ) : (
                        <span className="text-(--text-secondary)">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {canW ? (
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
                      ) : null}
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
