"use client";

import {
  CalendarClock,
  CircleAlert,
  Gauge,
  MonitorSmartphone,
  ScrollText,
  Users,
} from "lucide-react";

import {
  alertFeed,
  boardState,
  browserOf,
  sinceLabel,
  stageStatus,
} from "@/lib/ops";
import type { OpsOverview } from "@/lib/queries/ops";
import { cn } from "@/lib/utils";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Panel, SectionTitle } from "@/components/ui/panel";
import { StateBox } from "@/components/ui/state-box";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const clock = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleTimeString("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "—";

const SHIFT_LABEL = { day: "Siang", night: "Malam" } as const;
const KIND_LABEL = {
  att: "Absensi",
  fleet: "Fleet",
  fitwork: "Fit to Work",
  fingerprint: "Fingerprint",
} as const;

function statusVariant(status: number) {
  if (status >= 500) return "danger" as const;
  if (status >= 400) return "warning" as const;
  return "success" as const;
}

/** A table that scrolls sideways inside its panel instead of the page. */
function Scroll({ children }: { children: React.ReactNode }) {
  return <div className="-mx-2 overflow-x-auto px-2">{children}</div>;
}

function Empty({ text }: { text: string }) {
  return (
    <p className="py-6 text-center text-sm text-(--text-tertiary)">{text}</p>
  );
}

/* ------------------------------------------------------------- muster */

export function MusterPanel({ data, now }: { data: OpsOverview; now: Date }) {
  const { muster } = data;
  // The stage that builds the running shift's board.
  const builder =
    muster.stages.find(
      (stage) =>
        stage.action === "spare-validate" &&
        stage.shift === data.runningShift?.shift
    ) ?? null;
  const board = boardState({ stage: builder, boards: muster.boards });
  return (
    <Panel className="min-w-0">
      <SectionTitle className="flex-wrap">
        <CalendarClock />
        Muster
        {data.runningShift ? (
          <Badge variant="info" className="ml-auto">
            Shift {SHIFT_LABEL[data.runningShift.shift]} berjalan
          </Badge>
        ) : null}
      </SectionTitle>

      <div className="mb-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Fact label="Board dibuat" value={board.label} tone={board.tone} />
        <Fact label="FTW terbaca" value={String(muster.readings.ftw)} />
        <Fact
          label="Finger terbaca"
          value={`${muster.readings.finger} · tap ${sinceLabel(muster.readings.lastTapAt, now)}`}
        />
        <Fact
          label="Slip"
          value={`${muster.tickets.printed} cetak · ${muster.tickets.failed} gagal · ${muster.tickets.dry} dry`}
          tone={muster.tickets.failed ? "danger" : undefined}
        />
      </div>

      <Scroll>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Shift</TableHead>
              <TableHead>Jam</TableHead>
              <TableHead>Tahap</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Catatan terakhir</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {muster.stages.map((stage) => {
              const status = stageStatus(stage);
              return (
                <TableRow key={stage.id}>
                  <TableCell className="whitespace-nowrap text-(--text-secondary)">
                    <div>{stage.shift ? SHIFT_LABEL[stage.shift] : "—"}</div>
                    <div className="font-mono text-xs text-(--text-tertiary)">
                      {stage.date}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono">{stage.at}</TableCell>
                  <TableCell>
                    <div className="font-medium">{stage.name}</div>
                    <div className="font-mono text-xs text-(--text-tertiary)">
                      {stage.action}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={status.tone} dot>
                      {status.label}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-90 text-xs break-words text-(--text-secondary)">
                    {stage.lastRun
                      ? `${clock(stage.lastRun.at).slice(0, 5)} — ${stage.lastRun.note}`
                      : "—"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Scroll>
    </Panel>
  );
}

function Fact({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: BadgeVariant | null;
}) {
  return (
    <div className="rounded-card border border-(--divider) bg-(--fill-subtle) px-3 py-2.5">
      <div className="text-xs text-(--text-tertiary)">{label}</div>
      <div
        className={cn(
          "mt-0.5 font-semibold break-words tabular-nums",
          tone === "danger" && "text-(--color-danger-text)",
          tone === "warning" && "text-(--badge-warning-text)",
          tone === "success" && "text-(--badge-success-text)"
        )}
      >
        {value}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ devices */

export function DevicesPanel({ data, now }: { data: OpsOverview; now: Date }) {
  const { devices } = data;
  return (
    <Panel className="min-w-0">
      <SectionTitle className="flex-wrap">
        <MonitorSmartphone />
        Perangkat
      </SectionTitle>

      <div className="mb-5 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
        <Fact
          label="Mesin fingerprint online"
          value={`${devices.machines.online} / ${devices.machines.total}`}
          tone={devices.machines.offline.length ? "danger" : undefined}
        />
        <Fact
          label="Printer aktif"
          value={`${devices.printers.active} / ${devices.printers.total}`}
        />
        <Fact
          label="Booth listening (proses ini)"
          value={String(devices.listening.length)}
        />
      </div>

      {devices.machines.offline.length ? (
        <div className="mb-5">
          <div className="mb-2 text-xs font-semibold tracking-wider text-(--text-tertiary) uppercase">
            Mesin offline
          </div>
          <div className="flex flex-wrap gap-2">
            {devices.machines.offline.map((machine) => (
              <Badge
                key={machine.ip}
                variant="danger"
                className="max-w-full whitespace-normal"
              >
                {machine.name} · {machine.ip} · {sinceLabel(machine.since, now)}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}

      <Scroll>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Layar TV</TableHead>
              <TableHead>Jenis</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Terakhir terlihat</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {devices.screens.map((screen) => (
              <TableRow key={screen.id}>
                <TableCell className="font-medium">{screen.name}</TableCell>
                <TableCell className="text-(--text-secondary)">
                  {KIND_LABEL[screen.kind]}
                </TableCell>
                <TableCell>
                  {!screen.active ? (
                    <Badge variant="neutral">Nonaktif</Badge>
                  ) : screen.online ? (
                    <Badge variant="success" dot>
                      Online
                    </Badge>
                  ) : (
                    <Badge variant="danger" dot>
                      Offline
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-(--text-secondary)">
                  {sinceLabel(screen.lastSeenAt, now)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Scroll>
      {devices.screens.length ? null : (
        <Empty text="Belum ada layar terdaftar." />
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------- users */

export function UsersPanel({ data, now }: { data: OpsOverview; now: Date }) {
  return (
    <Panel className="min-w-0">
      <SectionTitle className="flex-wrap">
        <Users />
        Aktivitas user · 24 jam terakhir
        <span className="ml-auto text-xs font-normal text-(--text-tertiary)">
          {data.users.length} user
        </span>
      </SectionTitle>
      {data.users.length ? (
        <Scroll>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Perangkat</TableHead>
                <TableHead>Request terakhir</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Terakhir aktif</TableHead>
                <TableHead className="text-right">Req</TableHead>
                <TableHead className="text-right">Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.users.map((user) => (
                <TableRow key={user.userId}>
                  <TableCell className="font-medium">{user.name}</TableCell>
                  <TableCell className="text-(--text-secondary)">
                    {user.roleName}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-(--text-secondary)">
                    {browserOf(user.userAgent)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {user.lastRoute}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(user.lastStatus)}>
                      {user.lastStatus}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-(--text-secondary)">
                    {sinceLabel(user.lastSeenAt, now)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {user.requests}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums",
                      user.errors && "text-(--color-danger-text)"
                    )}
                  >
                    {user.errors}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Scroll>
      ) : (
        <Empty text="Belum ada user yang memakai aplikasi dalam 24 jam terakhir." />
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------- alerts */

export function AlertsPanel({ data }: { data: OpsOverview }) {
  const feed = alertFeed(data).slice(0, 30);
  return (
    <Panel className="min-w-0">
      <SectionTitle className="flex-wrap">
        <CircleAlert />
        Error & peringatan terbaru
      </SectionTitle>
      {feed.length ? (
        <ul className="flex flex-col divide-y divide-(--divider)">
          {feed.map((item, i) => (
            <li
              key={`${item.at}-${i}`}
              className="flex items-start gap-3 py-2.5 text-sm"
            >
              <Badge variant={item.tone} className="shrink-0">
                {item.source}
              </Badge>
              <span className="min-w-0 flex-1 break-words">{item.text}</span>
              <span className="shrink-0 font-mono text-xs text-(--text-tertiary)">
                {clock(item.at)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <StateBox
          className="py-6"
          icon={<CircleAlert className="text-(--text-tertiary)" />}
          title="Tidak ada peringatan"
          body="Tidak ada error server, tahap gagal, atau notifikasi merah/kuning."
        />
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------- routes */

export function RoutesPanel({ data }: { data: OpsOverview }) {
  const { routes, slow } = data.api;
  return (
    <Panel className="min-w-0">
      <SectionTitle className="flex-wrap">
        <Gauge />
        Route API · 60 menit terakhir
      </SectionTitle>
      {routes.length ? (
        <Scroll>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Route</TableHead>
                <TableHead className="text-right">Req</TableHead>
                <TableHead className="text-right">4xx</TableHead>
                <TableHead className="text-right">5xx</TableHead>
                <TableHead className="text-right">Rata-rata</TableHead>
                <TableHead className="text-right">Terlama</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {routes.map((route) => (
                <TableRow key={route.route}>
                  <TableCell className="font-mono text-xs">
                    {route.route}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {route.requests}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {route.clientErrors}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums",
                      route.serverErrors && "text-(--color-danger-text)"
                    )}
                  >
                    {route.serverErrors}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {route.avgMs} ms
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {route.maxMs} ms
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Scroll>
      ) : (
        <Empty text="Belum ada request dalam 60 menit terakhir." />
      )}

      {slow.length ? (
        <>
          <div className="mt-6 mb-2 text-xs font-semibold tracking-wider text-(--text-tertiary) uppercase">
            Request lambat (≥ 1 detik)
          </div>
          <ul className="flex flex-col divide-y divide-(--divider) text-sm">
            {slow.slice(0, 10).map((item, i) => (
              <li
                key={`${item.at}-${i}`}
                className="flex items-center gap-3 py-2"
              >
                <Badge variant={statusVariant(item.status)}>
                  {item.status}
                </Badge>
                <span className="min-w-0 flex-1 truncate font-mono text-xs">
                  {item.route}
                </span>
                <b className="tabular-nums">{item.ms} ms</b>
                <span className="font-mono text-xs text-(--text-tertiary)">
                  {clock(item.at)}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Panel>
  );
}

/* ---------------------------------------------------------- stage log */

export function StageLogPanel({ data }: { data: OpsOverview }) {
  return (
    <Panel className="min-w-0">
      <SectionTitle className="flex-wrap">
        <ScrollText />
        Log timeline · kemarin & hari ini
      </SectionTitle>
      {data.stageLog.length ? (
        <ul className="flex flex-col divide-y divide-(--divider) text-sm">
          {data.stageLog.slice(0, 40).map((run, i) => (
            <li key={`${run.at}-${i}`} className="flex items-start gap-3 py-2">
              <span className="w-18 shrink-0 font-mono text-xs text-(--text-tertiary)">
                {clock(run.at)}
              </span>
              <Badge
                variant={run.ok ? "success" : "warning"}
                className="shrink-0"
              >
                {run.ok ? "OK" : "Gagal"}
              </Badge>
              <span className="min-w-0 flex-1">
                <b className="font-medium">{run.name}</b>
                <span className="text-(--text-secondary)"> — {run.note}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty text="Belum ada tahap yang berjalan sejak kemarin." />
      )}
    </Panel>
  );
}
