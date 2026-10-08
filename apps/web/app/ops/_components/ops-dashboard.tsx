"use client";

import * as React from "react";
import {
  Activity,
  AlertTriangle,
  Clock3,
  Cpu,
  Database,
  HardDrive,
  LogOut,
  Radar,
  RefreshCw,
  Server,
  Timer,
} from "lucide-react";

import { api } from "@/lib/api";
import {
  apiTotals,
  clockAt,
  freshness,
  sinceLabel,
  type Freshness,
} from "@/lib/ops";
import type { OpsOverview } from "@/lib/queries/ops";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Fresh, PageTitle, Panel, SectionTitle } from "@/components/ui/panel";
import { StatCard } from "@/components/ui/stat-card";

import { DurationChart, RequestChart } from "./ops-charts";
import {
  AlertsPanel,
  DevicesPanel,
  MusterPanel,
  RoutesPanel,
  StageLogPanel,
  UsersPanel,
} from "./ops-panels";
import { useNow } from "./use-now";

/* The dashboard's own icon wells, from the badge tokens. */
const GOOD = {
  background: "var(--badge-success-fill)",
  borderColor: "var(--badge-success-border)",
  color: "var(--badge-success-text)",
};
const WARN = {
  background: "var(--badge-warning-fill)",
  borderColor: "var(--badge-warning-border)",
  color: "var(--badge-warning-text)",
};
const BAD = {
  background: "var(--badge-danger-fill)",
  borderColor: "var(--badge-danger-border)",
  color: "var(--color-danger-text)",
};
const INFO = {
  background: "rgba(0,212,255,.14)",
  borderColor: "rgba(0,212,255,.4)",
  color: "var(--color-primary-bright)",
};

const styleOf = (ok: boolean) => (ok ? GOOD : BAD);
const heartbeatStyle = (state: Freshness) =>
  state === "fresh" ? GOOD : state === "stale" ? WARN : BAD;

/** The scheduler ticks every minute; three without one means it has stopped. */
const SCHEDULER_STALE_SECONDS = 3 * 60;
/** The prober cycles every 30 s; two minutes without a probe is an outage. */
const PROBER_STALE_SECONDS = 2 * 60;
/** Ages read in minutes; a stale page re-reads them this often. */
const STALE_TICK_MS = 10_000;

export function OpsDashboard({
  data,
  refreshing,
  stale,
  updatedAt,
  onRefresh,
  onSignedOut,
}: {
  data: OpsOverview;
  refreshing: boolean;
  /** The last poll failed; what is shown is the previous answer. */
  stale: boolean;
  updatedAt: number;
  onRefresh: () => void;
  /** The ops session was closed on purpose — drop what is cached. */
  onSignedOut: () => void;
}) {
  /* Fresh data is read against the server's moment; stale data keeps ageing
     on the browser's clock, so a dead feed cannot go on saying "baru saja". */
  const tick = useNow(stale, STALE_TICK_MS);
  const now = clockAt(data.generatedAt, updatedAt, tick);
  const totals = apiTotals(data.api.perMinute);
  const scheduler = freshness(
    data.checks.schedulerLastTick,
    now,
    SCHEDULER_STALE_SECONDS
  );
  const prober = freshness(
    data.checks.proberLastCheck,
    now,
    PROBER_STALE_SECONDS
  );
  const storageOk =
    data.checks.soundStorage &&
    data.checks.photoStorage &&
    data.checks.importStorage;
  const [leaving, setLeaving] = React.useState(false);

  async function logout() {
    setLeaving(true);
    try {
      await api.v1.ops.session.delete();
    } finally {
      setLeaving(false);
      onSignedOut();
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-400 flex-col gap-6 px-4 py-6 sm:px-6">
      <PageTitle
        title="Operations Center"
        sub="Infrastruktur · API · muster · perangkat · user — hanya baca"
      >
        <div className="flex flex-wrap items-center gap-3">
          {stale ? (
            <Badge variant="warning" dot role="status" aria-live="polite">
              Gagal memuat ulang — menampilkan data terakhir
            </Badge>
          ) : null}
          <Fresh tone={stale ? "stale" : "live"}>
            Diperbarui{" "}
            {new Date(updatedAt).toLocaleTimeString("id-ID", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}{" "}
            · otomatis tiap 15 detik
          </Fresh>
          <Button
            variant="secondary"
            size="sm"
            onClick={onRefresh}
            disabled={refreshing}
          >
            <RefreshCw className={refreshing ? "animate-spin" : undefined} />
            Muat ulang
          </Button>
          <Button variant="ghost" size="sm" onClick={logout} disabled={leaving}>
            <LogOut />
            Keluar
          </Button>
        </div>
      </PageTitle>

      <section>
        <SectionTitle>
          <Server />
          Infrastruktur
        </SectionTitle>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
          <StatCard
            icon={<Database />}
            iconStyle={styleOf(data.checks.database)}
            value={data.checks.database ? "Aktif" : "Mati"}
            label="PostgreSQL"
          />
          <StatCard
            icon={<Cpu />}
            iconStyle={styleOf(data.checks.cache)}
            value={data.checks.cache ? "Aktif" : "Mati"}
            label="Redis"
            detail="Session, metrik, klaim scheduler"
          />
          <StatCard
            icon={<HardDrive />}
            iconStyle={styleOf(storageOk)}
            value={storageOk ? "Siap" : "Bermasalah"}
            label="Storage"
            detail={`Suara ${data.checks.soundStorage ? "✓" : "✕"} · Foto ${data.checks.photoStorage ? "✓" : "✕"} · Import ${data.checks.importStorage ? "✓" : "✕"}`}
          />
          <StatCard
            icon={<Clock3 />}
            iconStyle={heartbeatStyle(scheduler)}
            value={
              scheduler === "fresh"
                ? "Jalan"
                : scheduler === "stale"
                  ? "Tertahan"
                  : "Mati"
            }
            label="Scheduler"
            detail={`Tick ${sinceLabel(data.checks.schedulerLastTick, now)}`}
          />
          <StatCard
            icon={<Radar />}
            iconStyle={heartbeatStyle(prober)}
            value={
              prober === "fresh"
                ? "Jalan"
                : prober === "stale"
                  ? "Tertahan"
                  : "Mati"
            }
            label="Prober mesin"
            detail={`Probe ${sinceLabel(data.checks.proberLastCheck, now)}`}
          />
          <StatCard
            icon={<Activity />}
            iconStyle={INFO}
            value={data.devices.listening.length}
            label="Booth listening"
            detail="Sesi live di proses API ini"
          />
        </div>
      </section>

      <section>
        <SectionTitle>
          <Activity />
          API · 60 menit terakhir
        </SectionTitle>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard
            icon={<Activity />}
            iconStyle={INFO}
            value={totals.requests.toLocaleString("id-ID")}
            label="Request"
          />
          <StatCard
            icon={<AlertTriangle />}
            iconStyle={
              totals.serverErrors ? BAD : totals.clientErrors ? WARN : GOOD
            }
            value={`${totals.errorRate}%`}
            label="Error rate"
            detail={`${totals.clientErrors} 4xx · ${totals.serverErrors} 5xx`}
          />
          <StatCard
            icon={<Timer />}
            iconStyle={totals.avgMs > 1000 ? WARN : GOOD}
            value={`${totals.avgMs} ms`}
            label="Rata-rata durasi"
            detail={`Terlama ${totals.maxMs} ms`}
          />
          <StatCard
            icon={<Timer />}
            iconStyle={data.api.slow.length ? WARN : GOOD}
            value={data.api.slow.length}
            label="Request lambat tersimpan"
            detail="≥ 1 detik, 50 terakhir"
          />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel className="min-w-0">
          <SectionTitle>
            <Activity />
            Request per menit
          </SectionTitle>
          <RequestChart minutes={data.api.perMinute} />
        </Panel>
        <Panel className="min-w-0">
          <SectionTitle>
            <Timer />
            Durasi request
          </SectionTitle>
          <DurationChart minutes={data.api.perMinute} />
        </Panel>
      </div>

      <MusterPanel data={data} now={now} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <DevicesPanel data={data} now={now} />
        <AlertsPanel data={data} />
      </div>

      <UsersPanel data={data} now={now} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <RoutesPanel data={data} />
        <StageLogPanel data={data} />
      </div>

      <p className="pb-4 text-center text-xs text-(--text-tertiary)">
        Hanya baca — halaman ini tidak mengubah data apa pun. Data request
        disimpan 24 jam di Redis.
      </p>
    </main>
  );
}
