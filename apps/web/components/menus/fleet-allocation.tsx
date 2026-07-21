"use client";

import * as React from "react";
import { UserX } from "lucide-react";

import type { AccessMode } from "@/lib/access";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Avatar, initialsOf } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DNote,
  PageTitle,
  Panel,
  Toolbar,
  ToolbarGroup,
  ToolbarTitle,
} from "@/components/ui/panel";
import { Segmented, SegmentedButton } from "@/components/ui/segmented";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";

type Mode = "plan" | "actual";
type Op = { nik: string; name: string };
type PlanUnit = { code: string; isDigger?: boolean; ops: Op[] };
type PlanFleet = { id: string; digger: string; loc: string; units: PlanUnit[] };

/* ---- static sample content ---- */
const PLAN: PlanFleet[] = [
  {
    id: "fl1",
    digger: "EX-22",
    loc: "Pit 3 — Panel Utara",
    units: [
      {
        code: "EX-22",
        isDigger: true,
        ops: [{ nik: "OPS-0388", name: "Andi Wijaya" }],
      },
      {
        code: "DT-101",
        ops: [
          { nik: "OPS-0421", name: "Budi Santoso" },
          { nik: "OPS-0510", name: "Rudi Hartono" },
        ],
      },
      { code: "DT-102", ops: [{ nik: "OPS-0111", name: "Joko Prasetyo" }] },
      { code: "DT-104", ops: [] },
    ],
  },
  {
    id: "fl2",
    digger: "EX-07",
    loc: "Disposal Utara",
    units: [
      {
        code: "EX-07",
        isDigger: true,
        ops: [{ nik: "OPS-0367", name: "Hendra Gunawan" }],
      },
      { code: "DT-201", ops: [{ nik: "OPS-0455", name: "Fitri Handayani" }] },
      { code: "DT-202", ops: [{ nik: "OPS-0290", name: "Dewi Anggraini" }] },
    ],
  },
];

const SPARES: Op[] = [
  { nik: "OPS-0602", name: "Rina Marlina" },
  { nik: "OPS-0129", name: "Agus Salim" },
];

type ActualRow = {
  date: string;
  shift: "pagi" | "malam";
  made: boolean;
  generated: boolean;
  alloc: number;
  plan: number;
  viaSpare: number;
  downtime: number;
};

const ACTUAL: ActualRow[] = [
  {
    date: "2026-07-21",
    shift: "pagi",
    made: true,
    generated: true,
    alloc: 42,
    plan: 44,
    viaSpare: 2,
    downtime: 3,
  },
  {
    date: "2026-07-20",
    shift: "malam",
    made: true,
    generated: true,
    alloc: 40,
    plan: 44,
    viaSpare: 1,
    downtime: 4,
  },
  {
    date: "2026-07-20",
    shift: "pagi",
    made: true,
    generated: true,
    alloc: 43,
    plan: 44,
    viaSpare: 0,
    downtime: 2,
  },
  {
    date: "2026-07-19",
    shift: "malam",
    made: true,
    generated: false,
    alloc: 0,
    plan: 44,
    viaSpare: 0,
    downtime: 0,
  },
];

function OpSlot({ op }: { op: Op | undefined }) {
  const { t } = useI18n();
  if (!op)
    return (
      <div className="flex min-h-[62px] items-center justify-center rounded-icon border border-dashed border-(--divider) bg-(--fill-subtle) p-3 text-[13px] text-(--text-tertiary)">
        <span className="inline-flex items-center gap-2">
          <UserX className="size-4" />
          {t.ftwStatBelum}
        </span>
      </div>
    );
  return (
    <div className="flex items-center gap-3 rounded-icon border border-(--divider) bg-(--fill-subtle) p-3">
      <Avatar>{initialsOf(op.name)}</Avatar>
      <div className="min-w-0">
        <b className="block truncate text-sm">{op.name}</b>
        <span className="font-mono text-xs text-(--text-tertiary) tabular-nums">
          {op.nik}
        </span>
      </div>
    </div>
  );
}

export function FleetAllocationMenu({ mode: access }: { mode: AccessMode }) {
  const { t, lang } = useI18n();
  const { pushToast } = useToast();
  const canW = access === "manage";
  const [mode, setMode] = React.useState<Mode>("plan");

  const loc = lang === "en" ? "en-GB" : "id-ID";
  const dLabel = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(loc, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={t.navFleetAlloc} sub={t.faSubB}>
        <Segmented role="group" aria-label="Mode">
          <SegmentedButton
            active={mode === "plan"}
            onClick={() => setMode("plan")}
          >
            {t.faModePlan}
          </SegmentedButton>
          <SegmentedButton
            active={mode === "actual"}
            onClick={() => setMode("actual")}
          >
            {t.faModeActual}
          </SegmentedButton>
        </Segmented>
      </PageTitle>

      {mode === "plan" ? (
        <>
          {/* papan PLAN — kartu per fleet, maks. 2 operator per unit */}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
            {PLAN.map((f) => (
              <Panel key={f.id} className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <b className="block text-base">Fleet {f.digger}</b>
                    <span className="text-xs text-(--text-tertiary)">
                      {f.loc}
                    </span>
                  </div>
                  <Badge variant="info">{f.units.length} unit</Badge>
                </div>
                <div className="flex flex-col gap-2">
                  {f.units.map((u) => (
                    <div key={u.code} className="flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <span
                          className={cn(
                            "font-mono text-sm font-bold tabular-nums",
                            u.isDigger && "text-(--color-primary-bright)"
                          )}
                        >
                          {u.code}
                        </span>
                        {u.isDigger ? (
                          <Badge variant="info">Digger</Badge>
                        ) : null}
                      </div>
                      <div
                        className={cn(
                          "grid gap-2",
                          u.isDigger ? "grid-cols-1" : "grid-cols-2"
                        )}
                      >
                        <OpSlot op={u.ops[0]} />
                        {u.isDigger ? null : <OpSlot op={u.ops[1]} />}
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>
            ))}
          </div>

          {/* pool spare */}
          <Panel>
            <Toolbar className="mb-2">
              <ToolbarTitle>Spare</ToolbarTitle>
              <ToolbarGroup>
                <Badge variant={SPARES.length ? "info" : "neutral"}>
                  {SPARES.length}
                </Badge>
              </ToolbarGroup>
            </Toolbar>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
              {SPARES.map((s) => (
                <div
                  key={s.nik}
                  className="flex items-center gap-3 rounded-icon border border-(--divider) bg-(--fill-subtle) p-3"
                >
                  <Avatar>{initialsOf(s.name)}</Avatar>
                  <div className="min-w-0">
                    <b className="block truncate text-sm">{s.name}</b>
                    <span className="font-mono text-xs text-(--text-tertiary) tabular-nums">
                      {s.nik}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <DNote title={t.faNoteT}>{t.faNoteB}</DNote>
        </>
      ) : (
        <Panel>
          <Toolbar>
            <ToolbarTitle>{t.faModeActual}</ToolbarTitle>
            {canW ? (
              <ToolbarGroup>
                <Button
                  onClick={() =>
                    pushToast("success", t.faModeActual, dLabel("2026-07-21"))
                  }
                >
                  {t.mdAdd}
                </Button>
              </ToolbarGroup>
            ) : null}
          </Toolbar>
          <Table>
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
              {ACTUAL.map((r) => (
                <TableRow key={`${r.date}-${r.shift}`}>
                  <TableCell className="font-mono whitespace-nowrap">
                    {dLabel(r.date)}
                  </TableCell>
                  <TableCell>
                    {r.shift === "pagi" ? t.faShiftPagi : t.faShiftMalam}
                  </TableCell>
                  <TableCell>
                    {r.made ? (
                      <Badge variant="success" dot>
                        {t.stAktif}
                      </Badge>
                    ) : (
                      <Badge variant="warning" dot>
                        {t.ftwStatBelum}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {r.generated ? (
                      <Badge variant="success" dot>
                        {t.dGenerated}
                      </Badge>
                    ) : (
                      <Badge variant="danger" dot>
                        {t.ftwStatBelum}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="font-mono">{r.alloc}</TableCell>
                  <TableCell className="font-mono">{r.plan}</TableCell>
                  <TableCell className="font-mono">{r.viaSpare}</TableCell>
                  <TableCell className="font-mono">{r.downtime}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      {canW && !r.generated ? (
                        <Button
                          size="sm"
                          onClick={() =>
                            pushToast("success", t.fahThGen, dLabel(r.date))
                          }
                        >
                          Generate
                        </Button>
                      ) : null}
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() =>
                          pushToast("success", t.rvDetail, dLabel(r.date))
                        }
                      >
                        {t.rvDetail}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      )}
    </div>
  );
}
