"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { History, Zap } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import { useRole } from "@/components/providers/role-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogIcon,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  DNote,
  FootSum,
  Panel,
  PanelFoot,
  Toolbar,
  ToolbarGroup,
  ToolbarTitle,
} from "@/components/ui/panel";
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

import { ACTUAL_INIT, type ActualRow, type FaShift } from "./data";

const TODAY = "2026-07-21";

/* Tab ACTUAL — tabel riwayat per tanggal+shift + dialog Tambah (hari ini
   saja) + Generate; mutasi bekerja di state lokal (static-only). */
export function ActualTable({ canManage }: { canManage: boolean }) {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const { role } = useRole();
  const router = useRouter();

  const [rowsAll, setRowsAll] = React.useState<ActualRow[]>(ACTUAL_INIT);
  const [shiftF, setShiftF] = React.useState("");
  const [d1, setD1] = React.useState("");
  const [d2, setD2] = React.useState("");
  const [addOpen, setAddOpen] = React.useState(false);
  const [addShift, setAddShift] = React.useState<FaShift>("pagi");

  const rows = rowsAll
    .filter((r) => {
      if (shiftF && r.shift !== shiftF) return false;
      if (d1 && r.date < d1) return false;
      if (d2 && r.date > d2) return false;
      return true;
    })
    .sort((a, b) =>
      a.date !== b.date
        ? a.date < b.date
          ? 1
          : -1
        : a.shift === b.shift
          ? 0
          : a.shift === "pagi"
            ? -1
            : 1
    );

  const shiftLabel = (s: FaShift) =>
    s === "pagi" ? t.faShiftPagi : t.faShiftMalam;

  function nowHHMM() {
    const d = new Date();
    const p = (n: number) => `${n < 10 ? "0" : ""}${n}`;
    return `${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  /* Tambah ACTUAL dibatasi HARI INI (satu per shift) */
  function submitAdd() {
    if (rowsAll.some((r) => r.date === TODAY && r.shift === addShift)) {
      pushToast("info", t.faAddExistsT, t.faAddExistsD);
      return;
    }
    setRowsAll((prev) => [
      {
        date: TODAY,
        shift: addShift,
        createdAt: nowHHMM(),
        generatedAt: null,
        total: 0,
        viaPlan: 0,
        viaSpare: 0,
        downtime: 0,
      },
      ...prev,
    ]);
    setAddOpen(false);
    pushToast("success", t.faAddToastT, t.faAddToastD);
  }

  function runGenerate(r: ActualRow) {
    setRowsAll((prev) =>
      prev.map((x) =>
        x.date === r.date && x.shift === r.shift
          ? {
              ...x,
              generatedAt: nowHHMM(),
              total: 9,
              viaPlan: 7,
              viaSpare: 2,
              downtime: 1,
            }
          : x
      )
    );
    pushToast("success", t.faGenToastT, t.faGenToastD);
  }

  return (
    <>
      <Panel>
        <Toolbar>
          <ToolbarTitle>{t.fahTitle}</ToolbarTitle>
          <ToolbarGroup>
            <Select
              wrapperClassName="w-[150px]"
              value={shiftF}
              onChange={(e) => setShiftF(e.target.value)}
              aria-label={t.allShift}
            >
              <option value="">{t.allShift}</option>
              <option value="pagi">{t.faShiftPagi}</option>
              <option value="malam">{t.faShiftMalam}</option>
            </Select>
            <div className="flex items-center gap-2">
              <Input
                type="date"
                className="w-40 font-mono"
                value={d1}
                onChange={(e) => setD1(e.target.value)}
                aria-label={t.lblDate}
              />
              <span className="text-(--text-tertiary)">—</span>
              <Input
                type="date"
                className="w-40 font-mono"
                value={d2}
                onChange={(e) => setD2(e.target.value)}
                aria-label={t.lblDateTo}
              />
            </div>
            {canManage ? (
              <Button
                onClick={() => {
                  setAddShift("pagi");
                  setAddOpen(true);
                }}
              >
                <Zap />
                {t.faAddActual}
              </Button>
            ) : null}
          </ToolbarGroup>
        </Toolbar>

        {rows.length ? (
          <div className="overflow-x-auto">
            <Table className="min-w-[1080px]">
              <TableHeader>
                <tr>
                  <TableHead>{t.lblDate}</TableHead>
                  <TableHead>{t.thShift}</TableHead>
                  <TableHead>{t.fahThMade}</TableHead>
                  <TableHead>{t.fahThGen}</TableHead>
                  <TableHead>{t.fahThAlloc}</TableHead>
                  <TableHead>{t.fahThPlan}</TableHead>
                  <TableHead>{t.faViaSpare}</TableHead>
                  <TableHead>{t.faDowntime}</TableHead>
                  <TableHead />
                </tr>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={`${r.date}-${r.shift}`}>
                    <TableCell className="font-mono whitespace-nowrap">
                      {r.date}
                    </TableCell>
                    <TableCell>{shiftLabel(r.shift)}</TableCell>
                    <TableCell className="font-mono">{r.createdAt}</TableCell>
                    <TableCell className="font-mono">
                      {r.generatedAt ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono">{r.total}</TableCell>
                    <TableCell className="font-mono">{r.viaPlan}</TableCell>
                    <TableCell>
                      {r.viaSpare ? (
                        <Badge variant="warning" dot>
                          {r.viaSpare}
                        </Badge>
                      ) : (
                        <span className="font-mono text-(--text-tertiary)">
                          0
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {!r.generatedAt ? (
                        <span className="font-mono text-(--text-tertiary)">
                          —
                        </span>
                      ) : r.downtime ? (
                        <Badge variant="danger" dot>
                          {r.downtime}
                        </Badge>
                      ) : (
                        <Badge variant="success" dot>
                          0
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <span className="inline-flex gap-2">
                        {/* tergenerate = final (ter-lock) — hanya bisa dilihat */}
                        {!r.generatedAt && canManage ? (
                          <Button
                            className="h-8 text-[13px]"
                            onClick={() => runGenerate(r)}
                          >
                            <Zap />
                            {t.faGenBtn}
                          </Button>
                        ) : null}
                        <Button
                          variant="secondary"
                          className="h-8 text-[13px]"
                          onClick={() =>
                            router.push(
                              `/${role}/fleet-allocation/detail?date=${r.date}&shift=${r.shift}`
                            )
                          }
                        >
                          {t.fahDetail}
                        </Button>
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <StateBox
            icon={<History className="text-(--color-primary-bright)" />}
            title={t.fahEmptyT}
            body={t.fahEmptyB}
          />
        )}

        <PanelFoot>
          <FootSum>
            <b>{rows.length}</b> {t.fahSumB}
          </FootSum>
        </PanelFoot>
      </Panel>

      <DNote title={t.fahNoteT}>{t.fahNoteB}</DNote>

      {/* dialog Tambah ACTUAL — membuat = penanda lock lineup & FTW */}
      <Dialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        className="w-[min(480px,100%)]"
        labelledBy="faadd-t"
      >
        <DialogIcon variant="info">
          <Zap />
        </DialogIcon>
        <DialogTitle id="faadd-t">{t.faAddActual}</DialogTitle>
        <DialogBody>{t.faNoActualB}</DialogBody>
        <div className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-xs font-semibold text-(--text-secondary)">
            {t.lblDate}
            <Input
              type="date"
              className="w-full font-mono"
              value={TODAY}
              disabled
              aria-label={t.lblDate}
            />
            <span className="font-normal text-(--text-tertiary)">
              {t.faAddTodayOnly}
            </span>
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-semibold text-(--text-secondary)">
            {t.thShift}
            <Select
              value={addShift}
              onChange={(e) => setAddShift(e.target.value as FaShift)}
            >
              <option value="pagi">{t.faShiftPagi}</option>
              <option value="malam">{t.faShiftMalam}</option>
            </Select>
          </label>
        </div>
        <DialogActions>
          <Button variant="ghost" onClick={() => setAddOpen(false)}>
            {t.btnCancel}
          </Button>
          <Button onClick={submitAdd}>
            <Zap />
            {t.faAddActual}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
