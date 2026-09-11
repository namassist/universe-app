"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Fingerprint } from "lucide-react";

import { MENU_LABELS } from "@/lib/access";
import { fetchBlob } from "@/lib/api";
import { tapMonitorQueryOptions } from "@/lib/queries/monitoring-tap";
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
export function MonitoringTapMenu() {
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
            <Input
              type="date"
              value={date}
              max={today()}
              onChange={(e) => setDate(e.target.value || today())}
              className="w-[170px]"
            />
            <SearchInput
              className="w-[240px]"
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
              disabled={exporting || rows.length === 0}
            >
              <Download />
              Export Excel
            </Button>
          </ToolbarGroup>
        </Toolbar>

        {rows.length === 0 ? (
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
            {data
              ? `${data.taps} tap · ${data.people} orang · ${data.machines} mesin`
              : ""}
          </FootSum>
        </PanelFoot>
      </Panel>
    </div>
  );
}
