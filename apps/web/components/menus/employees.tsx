"use client";

import * as React from "react";
import {
  Download,
  Eye,
  Filter,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";

import type { AccessMode } from "@/lib/access";
import { useI18n } from "@/lib/i18n";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Checkbox, ToggleRow } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogIcon,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropMenu,
  DropMenuHeading,
  DropMenuWrap,
} from "@/components/ui/drop-menu";
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

const DEPTS = ["Operation", "SDI", "HRGA", "Plant"] as const;

type Komp = { jenis: string; exp: string };
type EmpStatus = "aktif" | "cuti" | "nonaktif";
type Emp = {
  nik: string;
  name: string;
  dept: string;
  pos: string;
  komp: Komp[];
  status: EmpStatus;
};

function kompVariant(exp: string): BadgeVariant {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(`${exp}T00:00:00`);
  if (d.getTime() < today.getTime()) return "danger";
  const days = (d.getTime() - today.getTime()) / 86400000;
  return days <= 60 ? "warning" : "info";
}

/* ---- static sample content ---- */
const INITIAL: Emp[] = [
  {
    nik: "OPS-0421",
    name: "Budi Santoso",
    dept: "Operation",
    pos: "Driver OHT",
    komp: [{ jenis: "BII", exp: "2027-03-14" }],
    status: "aktif",
  },
  {
    nik: "OPS-0388",
    name: "Andi Wijaya",
    dept: "Operation",
    pos: "Operator Excavator",
    komp: [{ jenis: "BII", exp: "2026-08-02" }],
    status: "aktif",
  },
  {
    nik: "OPS-0510",
    name: "Rudi Hartono",
    dept: "Operation",
    pos: "Driver OHT",
    komp: [{ jenis: "BII", exp: "2026-07-18" }],
    status: "aktif",
  },
  {
    nik: "OPS-0233",
    name: "Sari Lestari",
    dept: "HRGA",
    pos: "Admin Site",
    komp: [],
    status: "aktif",
  },
  {
    nik: "OPS-0111",
    name: "Joko Prasetyo",
    dept: "Operation",
    pos: "Driver OHT",
    komp: [{ jenis: "BII", exp: "2026-06-30" }],
    status: "aktif",
  },
  {
    nik: "OPS-0290",
    name: "Dewi Anggraini",
    dept: "SDI",
    pos: "Dispatcher",
    komp: [],
    status: "aktif",
  },
  {
    nik: "OPS-0367",
    name: "Hendra Gunawan",
    dept: "Operation",
    pos: "Operator Dozer",
    komp: [{ jenis: "BII", exp: "2027-01-22" }],
    status: "cuti",
  },
  {
    nik: "OPS-0455",
    name: "Fitri Handayani",
    dept: "Operation",
    pos: "Checker",
    komp: [],
    status: "aktif",
  },
  {
    nik: "OPS-0129",
    name: "Agus Salim",
    dept: "Plant",
    pos: "Mekanik",
    komp: [{ jenis: "KIMPER", exp: "2027-05-08" }],
    status: "aktif",
  },
  {
    nik: "OPS-0602",
    name: "Rina Marlina",
    dept: "SDI",
    pos: "Safety Officer",
    komp: [],
    status: "nonaktif",
  },
];

export function EmployeesMenu({ mode }: { mode: AccessMode }) {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const canW = mode === "manage";

  const [emps, setEmps] = React.useState<Emp[]>(INITIAL);
  const [q, setQ] = React.useState("");
  const [fOpen, setFOpen] = React.useState(false);
  const [fStatus, setFStatus] = React.useState("");
  const [fDepts, setFDepts] = React.useState<Record<string, boolean>>({});
  const [sel, setSel] = React.useState<Record<string, boolean>>({});
  const [delAsk, setDelAsk] = React.useState<{
    nik: string;
    name: string;
  } | null>(null);
  const selAllRef = React.useRef<HTMLInputElement>(null);

  const fN = DEPTS.filter((d) => fDepts[d]).length;
  const needle = q.trim().toLowerCase();
  const rows = emps.filter((r) => {
    if (fStatus && r.status !== fStatus) return false;
    if (fN && !fDepts[r.dept]) return false;
    if (!needle) return true;
    return (
      r.name.toLowerCase().includes(needle) ||
      r.nik.toLowerCase().includes(needle)
    );
  });
  const pg = usePagination(rows);
  const shown = pg.rows;

  const allShownSel = shown.length > 0 && shown.every((r) => sel[r.nik]);
  const someShownSel = shown.some((r) => sel[r.nik]);

  React.useEffect(() => {
    if (selAllRef.current)
      selAllRef.current.indeterminate = !allShownSel && someShownSel;
  }, [allShownSel, someShownSel]);

  function toggleDept(d: string) {
    setFDepts((prev) => ({ ...prev, [d]: !prev[d] }));
  }
  function toggleSelAll() {
    setSel((prev) => {
      const next = { ...prev };
      for (const r of shown) next[r.nik] = !allShownSel;
      return next;
    });
  }
  function exportNow() {
    pushToast(
      "info",
      t.toastExportT,
      `karyawan_${new Date().toISOString().slice(0, 10)}.xlsx`
    );
  }
  function resetFilters() {
    setQ("");
    setFStatus("");
    setFDepts({});
  }
  function delDo() {
    if (!delAsk) return;
    const target = delAsk;
    setDelAsk(null);
    setEmps((prev) => prev.filter((r) => r.nik !== target.nik));
    pushToast("success", t.toastDelT, `${target.name} ${t.toastDelD}`);
  }

  function statusBadge(r: Emp) {
    const map: Record<EmpStatus, { v: BadgeVariant; l: string }> = {
      aktif: { v: "success", l: "Aktif" },
      cuti: { v: "neutral", l: t.stCuti },
      nonaktif: { v: "danger", l: t.stNonaktif },
    };
    const m = map[r.status];
    return (
      <Badge variant={m.v} dot>
        {m.l}
      </Badge>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={t.navEmployees} sub={t.empSub}>
        {canW ? (
          <Button onClick={() => pushToast("success", t.empAdd, t.empSub)}>
            <Plus />
            {t.empAdd}
          </Button>
        ) : null}
      </PageTitle>

      <Panel>
        <Toolbar>
          <ToolbarTitle>{t.empListTitle}</ToolbarTitle>
          <ToolbarGroup>
            <SearchInput
              className="w-[240px]"
              placeholder={t.searchEmp}
              aria-label={t.searchEmp}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onClear={() => setQ("")}
              clearLabel={t.clearSearch}
            />
            <Select
              wrapperClassName="w-[160px]"
              aria-label={t.thStatus}
              value={fStatus}
              onChange={(e) => setFStatus(e.target.value)}
            >
              <option value="">{t.allStatus}</option>
              <option value="aktif">{t.stAktif}</option>
              <option value="cuti">{t.stCuti}</option>
              <option value="nonaktif">{t.stNonaktif}</option>
            </Select>
            <DropMenuWrap open={fOpen} onClose={() => setFOpen(false)}>
              <Button
                variant="secondary"
                onClick={() => setFOpen((v) => !v)}
                aria-expanded={fOpen}
              >
                <Filter />
                {t.filter}
              </Button>
              {fN > 0 ? (
                <span className="absolute -top-1.5 -right-1.5 z-10 grid h-4.5 min-w-4.5 place-items-center rounded-full bg-(--color-primary) px-[5px] text-[11px] font-bold text-(--color-on-cta)">
                  {fN}
                </span>
              ) : null}
              <DropMenu open={fOpen} className="w-[220px] p-3 text-left">
                <DropMenuHeading className="px-1 pt-0 pb-2">
                  {t.thDept}
                </DropMenuHeading>
                {DEPTS.map((d) => (
                  <ToggleRow key={d} className="rounded-md px-1 py-1.5">
                    <Checkbox
                      checked={!!fDepts[d]}
                      onChange={() => toggleDept(d)}
                    />
                    {d}
                  </ToggleRow>
                ))}
              </DropMenu>
            </DropMenuWrap>
            <Button variant="secondary" onClick={exportNow}>
              <Download />
              {t.export}
            </Button>
          </ToolbarGroup>
        </Toolbar>

        {shown.length ? (
          <Table>
            <TableHeader>
              <tr>
                <TableHead className="w-10">
                  <Checkbox
                    ref={selAllRef}
                    checked={allShownSel}
                    onChange={toggleSelAll}
                    aria-label={t.selAll}
                  />
                </TableHead>
                <TableHead>{t.thNama}</TableHead>
                <TableHead>NIK</TableHead>
                <TableHead className="max-xl:hidden">{t.thDept}</TableHead>
                <TableHead>{t.thPos}</TableHead>
                <TableHead>SIMPER</TableHead>
                <TableHead>{t.thStatus}</TableHead>
                <TableHead className="w-[140px]">{t.thAct}</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {shown.map((r) => (
                <TableRow key={r.nik} selected={!!sel[r.nik]}>
                  <TableCell>
                    <Checkbox
                      checked={!!sel[r.nik]}
                      onChange={() =>
                        setSel((prev) => ({ ...prev, [r.nik]: !prev[r.nik] }))
                      }
                      aria-label={r.name}
                    />
                  </TableCell>
                  <TableCell>
                    <span className="font-semibold">{r.name}</span>
                  </TableCell>
                  <TableCell className="font-mono text-(--text-secondary) tabular-nums">
                    {r.nik}
                  </TableCell>
                  <TableCell className="max-xl:hidden">{r.dept}</TableCell>
                  <TableCell>{r.pos}</TableCell>
                  <TableCell>
                    {r.komp.length ? (
                      <div className="flex max-w-[220px] flex-wrap gap-1">
                        {r.komp.map((k) => (
                          <Badge
                            key={k.jenis}
                            variant={kompVariant(k.exp)}
                            title={`s/d ${k.exp}`}
                          >
                            {k.jenis}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-(--text-tertiary)">—</span>
                    )}
                  </TableCell>
                  <TableCell>{statusBadge(r)}</TableCell>
                  <TableCell>
                    <div className="flex gap-1.5">
                      <IconButton
                        aria-label={t.empSee}
                        onClick={() => pushToast("success", t.empSee, r.name)}
                      >
                        <Eye />
                      </IconButton>
                      {canW ? (
                        <>
                          <IconButton
                            aria-label={t.empChange}
                            onClick={() =>
                              pushToast("success", t.empChange, r.name)
                            }
                          >
                            <Pencil />
                          </IconButton>
                          <IconButton
                            danger
                            aria-label={t.empDel}
                            onClick={() =>
                              setDelAsk({ nik: r.nik, name: r.name })
                            }
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
            body={t.empEmptyB}
          >
            <Button
              variant="secondary"
              className="mx-auto"
              onClick={resetFilters}
            >
              {t.empResetF}
            </Button>
          </StateBox>
        )}

        <PanelFoot>
          <FootSum>
            {t.attSumA} <b>{pg.range}</b> {t.attSumB} <b>{pg.total}</b>{" "}
            {t.empSumB}
          </FootSum>
          <Pagination
            page={pg.page}
            pageCount={pg.pageCount}
            onPage={pg.setPage}
            per={pg.per}
            perOptions={["5", "10", "25"]}
            onPer={pg.setPer}
          />
        </PanelFoot>
      </Panel>

      <Dialog
        open={!!delAsk}
        onClose={() => setDelAsk(null)}
        labelledBy="del-t"
      >
        <DialogIcon variant="danger">
          <Trash2 />
        </DialogIcon>
        <DialogTitle id="del-t">{`${t.empDelT1} ${delAsk?.name}?`}</DialogTitle>
        <DialogBody>{t.empDelBody}</DialogBody>
        <DialogActions>
          <Button variant="ghost" onClick={() => setDelAsk(null)}>
            {t.btnCancel}
          </Button>
          <Button variant="destructive" onClick={delDo}>
            {t.empDelDo}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
