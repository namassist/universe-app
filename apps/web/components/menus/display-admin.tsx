"use client";

import * as React from "react";
import { Eye, Monitor, Pencil, Plus, Trash2 } from "lucide-react";

import type { AccessMode } from "@/lib/access";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
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
  DNote,
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

type FleetPick = { id: string; digger: string; unitCount: number };
type Disp = {
  id: string;
  name: string;
  fleets?: FleetPick[];
  online: boolean;
  hb: string;
  runtext: string;
  active: boolean;
  rotateSec?: number;
};

const FLEETS: FleetPick[] = [
  { id: "fl1", digger: "EX-22", unitCount: 6 },
  { id: "fl2", digger: "EX-07", unitCount: 5 },
  { id: "fl3", digger: "PC-11", unitCount: 4 },
  { id: "fl4", digger: "WA-03", unitCount: 3 },
];

const SAMPLE: Record<"att" | "fleet", Disp[]> = {
  att: [
    {
      id: "DSP-A01",
      name: "TV Gate Utara",
      online: true,
      hb: "baru saja",
      runtext: "",
      active: true,
    },
    {
      id: "DSP-A02",
      name: "TV Mess A",
      online: true,
      hb: "1m lalu",
      runtext: "Utamakan keselamatan",
      active: true,
    },
    {
      id: "DSP-A03",
      name: "TV Gate Barat",
      online: false,
      hb: "6m lalu",
      runtext: "",
      active: false,
    },
  ],
  fleet: [
    {
      id: "DSP-F01",
      name: "Fleet EX-22",
      fleets: [FLEETS[0]!],
      online: true,
      hb: "baru saja",
      runtext: "",
      active: true,
      rotateSec: 12,
    },
    {
      id: "DSP-F02",
      name: "Fleet EX-07 +1",
      fleets: [FLEETS[1]!, FLEETS[2]!],
      online: true,
      hb: "2m lalu",
      runtext: "",
      active: true,
      rotateSec: 15,
    },
  ],
};

export function DisplayAdminMenu({
  mode,
  kind,
}: {
  mode: AccessMode;
  kind: "att" | "fleet";
}) {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const canW = mode === "manage";

  const [displays, setDisplays] = React.useState<Disp[]>(() => SAMPLE[kind]);
  const [q, setQ] = React.useState("");
  const [statusF, setStatusF] = React.useState("");

  const fleetsOf = (d: Disp) => d.fleets ?? [];
  const subOf = (d: Disp) => {
    const fls = fleetsOf(d);
    if (!fls.length) return d.id;
    const units = fls.reduce((n, f) => n + f.unitCount, 0);
    return `${units} unit · ${d.id}`;
  };

  const filtered = displays.filter((d) => {
    const needle = q.trim().toLowerCase();
    const okQ =
      !needle ||
      d.name.toLowerCase().includes(needle) ||
      d.id.toLowerCase().includes(needle) ||
      fleetsOf(d).some((f) => f.digger.toLowerCase().includes(needle));
    const okS = statusF === "" || d.active === (statusF === "1");
    return okQ && okS;
  });
  const pg = usePagination(filtered, "5");

  // add/edit dialog
  const [dlgOpen, setDlgOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Disp | null>(null);
  const [fName, setFName] = React.useState("");
  const [fSel, setFSel] = React.useState<FleetPick[]>([]);
  const [fRuntext, setFRuntext] = React.useState("");
  const [fActive, setFActive] = React.useState(true);
  const [nameErr, setNameErr] = React.useState(false);
  const [delTarget, setDelTarget] = React.useState<Disp | null>(null);

  function openAdd() {
    setEditing(null);
    setFName("");
    setFSel([]);
    setFRuntext("");
    setFActive(true);
    setNameErr(false);
    setDlgOpen(true);
  }
  function openEdit(d: Disp) {
    setEditing(d);
    setFName(d.name);
    setFSel([...(d.fleets ?? [])]);
    setFRuntext(d.runtext);
    setFActive(d.active);
    setNameErr(false);
    setDlgOpen(true);
  }
  function toggleFleet(f: FleetPick) {
    setFSel((prev) => {
      const next = prev.some((x) => x.id === f.id)
        ? prev.filter((x) => x.id !== f.id)
        : [...prev, f];
      if (next.length) setNameErr(false);
      return next;
    });
  }
  function save(e: React.FormEvent) {
    e.preventDefault();
    if (kind === "fleet" ? !fSel.length : !fName.trim()) {
      setNameErr(true);
      return;
    }
    const name =
      kind === "fleet"
        ? fSel.length === 1
          ? `Fleet ${fSel[0]!.digger}`
          : `Fleet ${fSel[0]!.digger} +${fSel.length - 1}`
        : fName.trim();
    if (editing) {
      setDisplays((prev) =>
        prev.map((d) =>
          d.id === editing.id
            ? {
                ...d,
                name,
                fleets: kind === "fleet" ? fSel : undefined,
                runtext: fRuntext,
                active: fActive,
              }
            : d
        )
      );
      pushToast("success", t.dspToastEdit);
    } else {
      const id = `DSP-${kind === "att" ? "A" : "F"}${String(displays.length + 1).padStart(2, "0")}`;
      setDisplays((prev) => [
        {
          id,
          name,
          fleets: kind === "fleet" ? fSel : undefined,
          online: true,
          hb: "baru saja",
          runtext: fRuntext,
          active: fActive,
          rotateSec: 12,
        },
        ...prev,
      ]);
      pushToast("success", t.dspToastAdd);
    }
    setDlgOpen(false);
  }
  function delDo() {
    if (!delTarget) return;
    setDisplays((prev) => prev.filter((d) => d.id !== delTarget.id));
    pushToast("success", t.dspToastDel);
    setDelTarget(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        title={kind === "att" ? t.navDispAtt : t.navDispFleet}
        sub={kind === "att" ? t.dspSubAtt : t.dspSubFleet}
      >
        {canW ? (
          <Button onClick={openAdd}>
            <Plus />
            {t.dspAdd}
          </Button>
        ) : null}
      </PageTitle>

      <Panel>
        <Toolbar>
          <ToolbarTitle>{t.dspListTitle}</ToolbarTitle>
          <ToolbarGroup>
            <SearchInput
              className="w-[240px]"
              placeholder={t.dspSearchPh}
              aria-label={t.dspSearchPh}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <Select
              wrapperClassName="w-[160px]"
              aria-label={t.thStatus}
              value={statusF}
              onChange={(e) => setStatusF(e.target.value)}
            >
              <option value="">{t.allStatus}</option>
              <option value="1">{t.stAktif}</option>
              <option value="0">{t.stNonaktif}</option>
            </Select>
          </ToolbarGroup>
        </Toolbar>
        <Table>
          <TableHeader>
            <tr>
              <TableHead>
                {kind === "fleet" ? t.dspFleetsCol : t.dspName}
              </TableHead>
              <TableHead>{t.dspRuntext}</TableHead>
              <TableHead>{t.dspConn}</TableHead>
              <TableHead>{t.thStatus}</TableHead>
              <TableHead className="w-[110px]">{t.thAct}</TableHead>
            </tr>
          </TableHeader>
          <TableBody>
            {pg.rows.map((d) => (
              <TableRow key={d.id}>
                <TableCell>
                  {kind === "fleet" ? (
                    <div className="flex flex-col gap-1.5">
                      <div className="flex max-w-[300px] flex-wrap gap-1">
                        {fleetsOf(d)
                          .slice(0, 4)
                          .map((f) => (
                            <Badge key={f.id} variant="info">
                              {f.digger}
                            </Badge>
                          ))}
                        {fleetsOf(d).length > 4 ? (
                          <Badge variant="neutral">
                            +{fleetsOf(d).length - 4}
                          </Badge>
                        ) : null}
                      </div>
                      <span className="font-mono text-xs text-(--text-tertiary)">
                        {subOf(d)}
                        {(d.fleets?.length ?? 0) > 1
                          ? ` · ${d.rotateSec ?? 12} dtk/fleet`
                          : ""}
                      </span>
                    </div>
                  ) : (
                    <NameCell name={d.name} sub={subOf(d)} />
                  )}
                </TableCell>
                <TableCell className="max-w-[360px] text-(--text-secondary)">
                  {d.runtext || (
                    <span className="text-(--text-tertiary) italic">
                      {t.dspRuntextDefault}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={d.online ? "success" : "danger"} dot>
                    {d.online ? "Online" : "Offline"}
                  </Badge>
                  <div className="mt-1 font-mono text-xs text-(--text-tertiary)">
                    {d.hb}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={d.active ? "success" : "danger"} dot>
                    {d.active ? t.stAktif : t.stNonaktif}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex gap-2">
                    <IconButton
                      aria-label={t.dspPreview}
                      onClick={() => pushToast("success", t.dspPreview, d.name)}
                    >
                      <Eye />
                    </IconButton>
                    {canW ? (
                      <>
                        <IconButton
                          aria-label={t.udbEditT}
                          onClick={() => openEdit(d)}
                        >
                          <Pencil />
                        </IconButton>
                        <IconButton
                          danger
                          aria-label={t.empDel}
                          onClick={() => setDelTarget(d)}
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
        <PanelFoot>
          <FootSum>
            {t.attSumA} <b>{pg.range}</b> {t.attSumB} <b>{pg.total}</b>{" "}
            {t.dspSumB}
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

      <DNote title={t.dspNoteT}>{t.dspNoteB}</DNote>

      <Dialog
        open={dlgOpen}
        onClose={() => setDlgOpen(false)}
        className="w-[min(560px,100%)]"
        labelledBy="dsp-t"
      >
        <DialogIcon variant="info">
          <Monitor />
        </DialogIcon>
        <DialogTitle id="dsp-t">
          {editing ? `${t.dspEditT} — ${editing.name}` : t.dspAdd}
        </DialogTitle>
        <DialogBody>{t.dspDlgB}</DialogBody>
        <form onSubmit={save} noValidate>
          <div className="mt-4 flex flex-col gap-5">
            {kind === "fleet" ? (
              <Field
                label={
                  <span className="flex w-full items-center gap-2">
                    <span>
                      Fleet
                      <span className="text-(--color-danger-text)"> *</span>
                    </span>
                    <Badge variant={fSel.length ? "info" : "neutral"}>
                      {fSel.length} {t.dspPicked}
                    </Badge>
                  </span>
                }
                helper={t.dspFleetHelp}
                error={nameErr}
                errorMessage={t.dspErrFleet}
              >
                <div className="grid max-h-64 grid-cols-2 gap-1 overflow-y-auto rounded-control border border-(--border-input) bg-(--fill-input) p-2">
                  {FLEETS.map((f) => (
                    <ToggleRow
                      key={f.id}
                      className={cn(
                        "rounded-md px-1.5 py-1.5",
                        fSel.some((x) => x.id === f.id) &&
                          "bg-[rgba(0,212,255,.08)]"
                      )}
                    >
                      <Checkbox
                        checked={fSel.some((x) => x.id === f.id)}
                        onChange={() => toggleFleet(f)}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {`Fleet ${f.digger}`}
                        <span className="text-(--text-tertiary)">{` — ${f.unitCount} unit`}</span>
                      </span>
                    </ToggleRow>
                  ))}
                </div>
              </Field>
            ) : (
              <Field
                label={t.dspName}
                htmlFor="dsp-name"
                required
                error={nameErr}
                errorMessage={t.mdErrName}
              >
                <Input
                  id="dsp-name"
                  placeholder="TV Gate Utara"
                  value={fName}
                  onChange={(e) => {
                    setFName(e.target.value);
                    if (e.target.value.trim()) setNameErr(false);
                  }}
                />
              </Field>
            )}
            <Field
              label={t.dspRuntext}
              htmlFor="dsp-runtext"
              helper={t.dspRuntextHelp}
            >
              <Input
                id="dsp-runtext"
                placeholder={t.dspRuntextDefault}
                value={fRuntext}
                onChange={(e) => setFRuntext(e.target.value)}
              />
            </Field>
            <ToggleRow htmlFor="dsp-active">
              <Checkbox
                id="dsp-active"
                checked={fActive}
                onChange={(e) => setFActive(e.target.checked)}
              />
              {t.stAktif}
            </ToggleRow>
          </div>
          <DialogActions>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDlgOpen(false)}
            >
              {t.btnCancel}
            </Button>
            <Button type="submit">
              {editing ? t.udbSaveEdit : t.dspSaveAdd}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      <Dialog
        open={delTarget !== null}
        onClose={() => setDelTarget(null)}
        labelledBy="dspd-t"
      >
        <DialogIcon variant="danger">
          <Trash2 />
        </DialogIcon>
        <DialogTitle id="dspd-t">{`${t.dspDelT} "${delTarget?.name ?? ""}"?`}</DialogTitle>
        <DialogBody>{t.dspDelB}</DialogBody>
        <DialogActions>
          <Button variant="ghost" onClick={() => setDelTarget(null)}>
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
