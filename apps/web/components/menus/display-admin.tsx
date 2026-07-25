"use client";

import * as React from "react";
import { Eye, Monitor, Pencil, Plus, Trash2 } from "lucide-react";

import type { AccessMode } from "@/lib/access";
import {
  COLOR_VAL,
  DISPLAYS,
  FLEETS,
  RUNTEXT_COLORS,
  type CustomRunText,
  type Display as Disp,
  type FleetPick,
} from "@/lib/display-data";
import { useI18n } from "@/lib/i18n";
import { openDisplay } from "@/lib/open-display";
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

  const [displays, setDisplays] = React.useState<Disp[]>(() => DISPLAYS[kind]);
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
  const [fRuntexts, setFRuntexts] = React.useState<CustomRunText[]>([]);
  const [fActive, setFActive] = React.useState(true);

  const addRT = () =>
    setFRuntexts((p) => [...p, { text: "", color: RUNTEXT_COLORS[0]! }]);
  const updateRT = (i: number, patch: Partial<CustomRunText>) =>
    setFRuntexts((p) => p.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const removeRT = (i: number) =>
    setFRuntexts((p) => p.filter((_, j) => j !== i));
  const [nameErr, setNameErr] = React.useState(false);
  const [delTarget, setDelTarget] = React.useState<Disp | null>(null);

  function openAdd() {
    setEditing(null);
    setFName("");
    setFSel([]);
    setFRuntexts([]);
    setFActive(true);
    setNameErr(false);
    setDlgOpen(true);
  }
  function openEdit(d: Disp) {
    setEditing(d);
    setFName(d.name);
    setFSel([...(d.fleets ?? [])]);
    setFRuntexts(d.runtexts.map((r) => ({ ...r })));
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
    const runtexts = fRuntexts.filter((r) => r.text.trim());
    if (editing) {
      setDisplays((prev) =>
        prev.map((d) =>
          d.id === editing.id
            ? {
                ...d,
                name,
                fleets: kind === "fleet" ? fSel : undefined,
                runtexts,
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
          kind,
          fleets: kind === "fleet" ? fSel : undefined,
          online: true,
          hb: "baru saja",
          runtexts,
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
                <TableCell className="text-(--text-secondary)">
                  {d.runtexts.length ? (
                    <div className="flex max-w-[360px] flex-wrap gap-1.5">
                      {d.runtexts.map((r, i) => (
                        <span
                          key={`${r.text}-${i}`}
                          className="inline-flex items-center gap-1.5 rounded-full border border-(--glass-1-border) bg-(--fill-subtle) px-2.5 py-1 text-xs"
                        >
                          <i
                            className="inline-block size-2 flex-none rounded-full"
                            style={{ background: COLOR_VAL[r.color] }}
                          />
                          <span className="max-w-[160px] truncate">
                            {r.text}
                          </span>
                        </span>
                      ))}
                    </div>
                  ) : (
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
                      onClick={() =>
                        /* layar kiosk sungguhan (dark-only) — tab baru, fullscreen */
                        openDisplay(
                          `/display/${kind === "att" ? "attendance" : "fleet"}?name=${encodeURIComponent(d.name)}`
                        )
                      }
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
            <Field label={t.dspRuntext} helper={t.dspRuntextHelp}>
              <div className="flex flex-col gap-2">
                {fRuntexts.length === 0 ? (
                  <p className="rounded-control border border-dashed border-(--border-input) px-3 py-2.5 text-xs text-(--text-tertiary) italic">
                    {t.dspRtEmpty}
                  </p>
                ) : (
                  fRuntexts.map((r, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        aria-label={`${t.dspRuntext} ${i + 1}`}
                        placeholder={t.dspRuntext}
                        value={r.text}
                        onChange={(e) => updateRT(i, { text: e.target.value })}
                      />
                      <Select
                        wrapperClassName="w-[130px] flex-none"
                        aria-label={`Warna ${i + 1}`}
                        value={r.color}
                        onChange={(e) => updateRT(i, { color: e.target.value })}
                      >
                        {RUNTEXT_COLORS.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </Select>
                      <IconButton
                        danger
                        aria-label={t.empDel}
                        onClick={() => removeRT(i)}
                      >
                        <Trash2 />
                      </IconButton>
                    </div>
                  ))
                )}
                <Button
                  type="button"
                  variant="ghost"
                  className="self-start"
                  onClick={addRT}
                >
                  <Plus />
                  {t.dspRtAdd}
                </Button>
              </div>
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
