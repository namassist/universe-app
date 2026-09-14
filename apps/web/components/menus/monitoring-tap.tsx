"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Fingerprint, Play, Square } from "lucide-react";

import { MENU_LABELS, type AccessMode } from "@/lib/access";
import { api, errorMessage, fetchBlob } from "@/lib/api";
import {
  deviceStatusQueryOptions,
  liveLogKey,
  liveLogQueryOptions,
  tapMonitorQueryOptions,
} from "@/lib/queries/monitoring-tap";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  FootSum,
  PageTitle,
  Panel,
  PanelFoot,
  Toolbar,
  ToolbarGroup,
} from "@/components/ui/panel";
import { SearchInput } from "@/components/ui/search-input";
import { Segmented, SegmentedButton } from "@/components/ui/segmented";
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

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Every tap, as the machines recorded it.
 *
 * The Attendance screen answers "when did he arrive" with one row a person.
 * This shows the working behind it — the same person tapping twice, or at two
 * machines, or a minute after the deadline — which is the question a
 * supervisor used to have to take to another team.
 *
 * Read-only by construction: taps are what the machines said, and the reading
 * derived from them is rebuilt rather than edited. Three days, which is what
 * we keep; the machines hold months and remain the archive.
 */
export function MonitoringTapMenu({ mode }: { mode: AccessMode }) {
  const { pushToast } = useToast();
  const [date, setDate] = React.useState(today());
  const [q, setQ] = React.useState("");
  /* The search runs server-side, so it is debounced rather than sent per
     keystroke to a table that can hold five hundred rows. */
  const [typed, setTyped] = React.useState("");
  React.useEffect(() => {
    const timer = setTimeout(() => setQ(typed), 300);
    return () => clearTimeout(timer);
  }, [typed]);

  const listQ = useQuery(tapMonitorQueryOptions(date, q));
  const data = listQ.data;
  const rows = data?.rows ?? [];

  const [view, setView] = React.useState<"taps" | "devices" | "live">("taps");
  const canW = mode === "manage";
  const queryClient = useQueryClient();
  /* Polled whenever this tab is open, and only then: it is the one view whose
     value is entirely in being current. */
  const devicesQ = useQuery({
    ...deviceStatusQueryOptions(date),
    enabled: view === "devices",
  });
  const devices = devicesQ.data;

  /* Only while the tab is open: a held socket is not something to keep warm
     in the background. */
  const liveQ = useQuery({
    ...liveLogQueryOptions(),
    enabled: view === "live",
  });
  const live = liveQ.data;
  const refreshLive = () =>
    queryClient.invalidateQueries({ queryKey: liveLogKey });

  const startListen = useMutation({
    mutationFn: async (machineId: string) => {
      const result = await api.v1["monitoring-tap"].live.start.post({
        machineId,
      });
      if (result.error) throw result.error;
      return result.data;
    },
    onSuccess: async (session) => {
      await refreshLive();
      pushToast("success", "Mendengarkan", session.name);
    },
    onError: (error) =>
      pushToast("error", "Gagal mendengarkan", errorMessage(error, "Gagal")),
  });

  const stopListen = useMutation({
    mutationFn: async (ip: string) => {
      const result = await api.v1["monitoring-tap"].live.stop.post({ ip });
      if (result.error) throw result.error;
    },
    onSuccess: async () => {
      await refreshLive();
      pushToast("success", "Berhenti", "Sesi ditutup");
    },
    onError: (error) =>
      pushToast("error", "Gagal berhenti", errorMessage(error, "Gagal")),
  });

  const [exporting, setExporting] = React.useState(false);

  async function exportExcel() {
    setExporting(true);
    try {
      const params = new URLSearchParams({ date });
      if (q) params.set("q", q);
      /* fetchBlob, not Eden — Treaty decodes an unrecognised body as text and
         mangles the workbook past recovery (lib/api.ts). */
      const blob = await fetchBlob(`/v1/monitoring-tap/export?${params}`);
      const url = URL.createObjectURL(blob);
      const name = `tap-${date}.xlsx`;
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      pushToast("success", "Export", `${name} · ${rows.length} baris`);
    } catch (error) {
      pushToast(
        "error",
        "Export",
        error instanceof Error ? error.message : "Gagal mengunduh"
      );
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        title={MENU_LABELS["monitoring-tap"]}
        sub="Tap mentah dari mesin fingerprint — termasuk tap ganda dan tap di mesin berbeda. Disimpan 3 hari."
      />

      <Panel>
        <Toolbar>
          <ToolbarGroup>
            <Segmented role="group" aria-label="Tampilan">
              <SegmentedButton
                active={view === "taps"}
                onClick={() => setView("taps")}
              >
                Tap mentah
              </SegmentedButton>
              {/* Not a report but an instrument: it answers "is anything down
                  right now", which is only worth asking while a muster runs. */}
              <SegmentedButton
                active={view === "devices"}
                onClick={() => setView("devices")}
              >
                Perangkat
              </SegmentedButton>
              {/* A testing instrument: it holds a socket open, so it lives
                  behind its own tab rather than on by default. */}
              <SegmentedButton
                active={view === "live"}
                onClick={() => setView("live")}
              >
                Live
              </SegmentedButton>
            </Segmented>
            <Input
              type="date"
              value={date}
              max={today()}
              onChange={(e) => setDate(e.target.value || today())}
              className="w-[170px]"
            />
            <SearchInput
              className={cn("w-[240px]", view !== "taps" && "hidden")}
              placeholder="NIK, nama, atau mesin"
              aria-label="Cari tap"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onClear={() => setTyped("")}
            />
          </ToolbarGroup>
          <ToolbarGroup>
            <Button
              variant="ghost"
              onClick={exportExcel}
              disabled={exporting || rows.length === 0 || view !== "taps"}
            >
              <Download />
              Export Excel
            </Button>
          </ToolbarGroup>
        </Toolbar>

        {view === "live" ? (
          <LiveView
            data={live}
            loading={liveQ.isLoading}
            canW={canW}
            onStart={(id) => startListen.mutate(id)}
            onStop={(ip) => stopListen.mutate(ip)}
            busy={startListen.isPending || stopListen.isPending}
          />
        ) : view === "devices" ? (
          <DevicesView data={devices} loading={devicesQ.isLoading} />
        ) : rows.length === 0 ? (
          <StateBox
            icon={<Fingerprint className="text-(--text-tertiary)" />}
            title="Belum ada tap"
            body={
              listQ.isLoading
                ? "Memuat…"
                : "Tidak ada tap yang tercatat pada tanggal ini. Pengumpulan hanya berjalan di jendela muster."
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Waktu</TableHead>
                <TableHead>NIK</TableHead>
                <TableHead>Nama</TableHead>
                <TableHead>Departemen</TableHead>
                <TableHead>Arah</TableHead>
                <TableHead>Mesin</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={`${r.ip}-${r.nik}-${r.at}`}>
                  {/* The clock, not the date: every row on this screen is the
                      same day, and repeating it costs the column that matters. */}
                  <TableCell className="font-mono tabular-nums">
                    {r.at.slice(11, 19)}
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {r.nik}
                  </TableCell>
                  <TableCell>{r.name ?? "—"}</TableCell>
                  <TableCell className="text-(--text-secondary)">
                    {r.department ?? "—"}
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "rounded-chip px-2 py-0.5 text-[11px] font-semibold",
                        r.direction === "in"
                          ? "bg-[rgba(32,200,120,.12)] text-(--badge-success-text)"
                          : "bg-[rgba(240,160,32,.12)] text-(--badge-warning-text)"
                      )}
                    >
                      {r.direction === "in" ? "Masuk" : "Pulang"}
                    </span>
                  </TableCell>
                  <TableCell className="text-(--text-secondary)">
                    {r.machine}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <PanelFoot>
          {/* Counted over the whole day rather than the page, so searching does
              not appear to change how busy the morning was. */}
          <FootSum>
            {view === "live"
              ? live
                ? `${live.sessions.length} sesi aktif · ${live.rows.length} tap terbaru`
                : ""
              : view === "devices"
                ? devices
                  ? `${devices.answering} mesin menjawab · ${devices.silent} diam` +
                    (devices.lastContact
                      ? ` · kontak terakhir ${devices.lastContact}`
                      : " · belum ada kontak hari ini")
                  : ""
                : data
                  ? `${data.taps} tap · ${data.people} orang · ${data.machines} mesin`
                  : ""}
          </FootSum>
        </PanelFoot>
      </Panel>
    </div>
  );
}

/**
 * Every machine and how the collector last found it.
 *
 * Until this existed the answer lived in `device_requests`, a table written on
 * every call and read by nobody without a psql prompt. That is the wrong shape
 * for the question: when a machine goes quiet during a muster the person who
 * needs to know is standing in the yard.
 *
 * Ordered booths first, and within them the ones in trouble first, because a
 * screen read under time pressure should not need sorting.
 */
function DevicesView({
  data,
  loading,
}: {
  data?: {
    rows: Array<{
      ip: string;
      name: string;
      operatorBooth: boolean;
      active: boolean;
      records: number | null;
      lastSeen: string | null;
      lastError: string | null;
      ok: number;
      failed: number;
      taps: number;
    }>;
  };
  loading: boolean;
}) {
  const rows = data?.rows ?? [];
  if (rows.length === 0)
    return (
      <StateBox
        icon={<Fingerprint className="text-(--text-tertiary)" />}
        title="Belum ada mesin"
        body={loading ? "Memuat…" : "Belum ada mesin fingerprint terdaftar."}
      />
    );

  /* A booth that never answered outranks one that answered and then failed:
     the first means nobody's taps are being read at all. */
  const rank = (r: (typeof rows)[number]) =>
    !r.active || !r.operatorBooth
      ? 3
      : r.lastSeen === null
        ? 0
        : r.lastError
          ? 1
          : 2;
  const sorted = [...rows].sort((a, b) => rank(a) - rank(b));

  const chip = (r: (typeof rows)[number]) => {
    if (!r.active)
      return {
        label: "Nonaktif",
        tone: "bg-(--fill-subtle) text-(--text-secondary)",
      };
    if (!r.operatorBooth)
      return {
        label: "Dipantau",
        tone: "bg-(--fill-subtle) text-(--text-secondary)",
      };
    if (r.lastSeen === null)
      return {
        label: "Diam",
        tone: "bg-[rgba(252,60,59,.12)] text-(--color-danger)",
      };
    if (r.lastError)
      return {
        label: "Sempat gagal",
        tone: "bg-[rgba(240,160,32,.12)] text-(--badge-warning-text)",
      };
    return {
      label: "Menjawab",
      tone: "bg-[rgba(32,200,120,.12)] text-(--badge-success-text)",
    };
  };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Mesin</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Isi memori</TableHead>
          <TableHead>Kontak terakhir</TableHead>
          <TableHead>Tap hari ini</TableHead>
          <TableHead>Permintaan</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((r) => {
          const c = chip(r);
          return (
            <TableRow key={r.ip}>
              <TableCell>
                <div>{r.name}</div>
                <div className="font-mono text-[11px] text-(--text-tertiary)">
                  {r.ip}
                </div>
              </TableCell>
              <TableCell>
                <span
                  className={cn(
                    "rounded-chip px-2 py-0.5 text-[11px] font-semibold",
                    c.tone
                  )}
                >
                  {c.label}
                </span>
                {/* The reason verbatim from the log — EHOSTUNREACH reads very
                    differently from "the machine is off". */}
                {r.lastError ? (
                  <div className="mt-1 font-mono text-[11px] text-(--text-tertiary)">
                    {r.lastError}
                  </div>
                ) : null}
              </TableCell>
              <TableCell className="font-mono tabular-nums">
                {r.records === null ? "—" : r.records.toLocaleString("id-ID")}
              </TableCell>
              <TableCell className="font-mono tabular-nums">
                {r.lastSeen ?? "—"}
              </TableCell>
              <TableCell className="font-mono tabular-nums">{r.taps}</TableCell>
              <TableCell className="font-mono text-(--text-secondary) tabular-nums">
                {r.ok} ok
                {r.failed > 0 ? ` · ${r.failed} gagal` : ""}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/**
 * Taps as they arrive, and who is holding a socket open.
 *
 * A testing instrument, not a report: it exists to answer "does the machine
 * push, and how fast" with something a person can watch, rather than with a
 * terminal only one of us can read.
 *
 * Only machines flagged "Universe only" are offered. The server refuses the
 * rest outright — listening enables the device, and the production machines
 * are ShiftCorner's.
 */
function LiveView({
  data,
  loading,
  canW,
  onStart,
  onStop,
  busy,
}: {
  data?: {
    sessions: Array<{
      machineId: string;
      ip: string;
      name: string;
      source: "manual" | "schedule";
      startedBy: string | null;
      startedAt: string;
      taps: number;
    }>;
    machines: Array<{
      id: string;
      name: string;
      ip: string;
      listening: boolean;
    }>;
    rows: Array<{
      nik: string;
      name: string | null;
      at: string;
      receivedAt: string;
      machine: string;
    }>;
  };
  loading: boolean;
  canW: boolean;
  onStart: (machineId: string) => void;
  onStop: (ip: string) => void;
  busy: boolean;
}) {
  const [picked, setPicked] = React.useState("");
  const free = (data?.machines ?? []).filter((m) => !m.listening);

  /*
   * The moment we received it, in the reader's own clock.
   *
   * The API sends an instant (ISO, therefore UTC), and slicing the string
   * showed 13:53 beside a machine clock reading 21:53 — eight hours apart on a
   * screen whose whole job is comparing those two numbers. The arithmetic was
   * right all along; only this was wrong.
   */
  const clockOf = (iso: string) => {
    const at = new Date(iso);
    const two = (n: number) => String(n).padStart(2, "0");
    return `${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())}`;
  };

  /* The gap between the machine's own clock and our receipt — the number this
     whole milestone exists to produce. Both are read as local time: `at` is
     the machine's wall clock, and it keeps the same zone we run in. */
  const lag = (at: string, receivedAt: string) => {
    const tapped = new Date(at.replace(" ", "T")).getTime();
    const got = new Date(receivedAt).getTime();
    if (Number.isNaN(tapped) || Number.isNaN(got)) return null;
    return Math.round((got - tapped) / 1000);
  };

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      {canW ? (
        <div className="flex flex-wrap items-end gap-3">
          <Select
            wrapperClassName="w-[280px]"
            aria-label="Mesin"
            value={picked}
            onChange={(e) => setPicked(e.target.value)}
          >
            <option value="">Pilih mesin khusus Universe…</option>
            {free.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} — {m.ip}
              </option>
            ))}
          </Select>
          <Button disabled={!picked || busy} onClick={() => onStart(picked)}>
            <Play />
            Mulai dengar
          </Button>
        </div>
      ) : null}

      {data?.sessions.length ? (
        <div className="flex flex-col gap-2">
          {data.sessions.map((s) => (
            <div
              key={s.ip}
              className="flex flex-wrap items-center justify-between gap-3 rounded-chip border border-(--rule) px-3 py-2"
            >
              <div>
                <div className="font-semibold">{s.name}</div>
                {/* Who and since when, so a forgotten session has a name
                    against it — it runs until somebody stops it. */}
                <div className="font-mono text-[11px] text-(--text-tertiary)">
                  {s.ip} · {s.source === "manual" ? "manual" : "terjadwal"}
                  {s.startedBy ? ` · ${s.startedBy}` : ""} · sejak{" "}
                  {clockOf(s.startedAt)} · {s.taps} tap
                </div>
              </div>
              {canW ? (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => onStop(s.ip)}
                >
                  <Square />
                  Berhenti
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <StateBox
          icon={<Fingerprint className="text-(--text-tertiary)" />}
          title="Tidak ada sesi berjalan"
          body={
            loading
              ? "Memuat…"
              : "Pilih mesin khusus Universe lalu mulai mendengarkan. Mesin produksi tidak ditawarkan."
          }
        />
      )}

      {data?.rows.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Jam mesin</TableHead>
              <TableHead>Diterima</TableHead>
              <TableHead>Selisih</TableHead>
              <TableHead>NIK</TableHead>
              <TableHead>Nama</TableHead>
              <TableHead>Mesin</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((r) => {
              const seconds = lag(r.at, r.receivedAt);
              return (
                <TableRow key={`${r.nik}-${r.at}-${r.machine}`}>
                  <TableCell className="font-mono tabular-nums">
                    {r.at.slice(11, 19)}
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {clockOf(r.receivedAt)}
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {seconds === null ? "—" : `${seconds} dtk`}
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {r.nik}
                  </TableCell>
                  <TableCell>{r.name ?? "—"}</TableCell>
                  <TableCell className="text-(--text-secondary)">
                    {r.machine}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : null}
    </div>
  );
}
