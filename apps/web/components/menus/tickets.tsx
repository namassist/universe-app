"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Printer } from "lucide-react";

import { MENU_LABELS, type AccessMode } from "@/lib/access";
import { api, errorMessage } from "@/lib/api";
import { ticketsKey, ticketsQueryOptions } from "@/lib/queries/tickets";
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
 * The slips, and the ones still owed.
 *
 * Its own menu rather than a tab on the tap monitor: that screen is read while
 * asking about a tap, this one while asking about a slip. The two questions
 * arrive from different people — a supervisor checking whether somebody tapped,
 * and an operator standing at the booth with an empty hand.
 */
export function TicketsMenu({ mode }: { mode: AccessMode }) {
  const { pushToast } = useToast();
  const [date, setDate] = React.useState(today());
  const canW = mode === "manage";
  const queryClient = useQueryClient();

  const ticketsQ = useQuery(ticketsQueryOptions(date));
  const tickets = ticketsQ.data;

  const reprint = useMutation({
    mutationFn: async (id: string) => {
      const result = await api.v1.tickets({ id }).reprint.post();
      if (result.error) throw result.error;
      return result.data;
    },
    onSuccess: async (r) => {
      await queryClient.invalidateQueries({ queryKey: ticketsKey(date) });
      pushToast(
        r.status === "printed" ? "success" : "error",
        "Cetak ulang",
        r.status === "printed" ? "Tiket tercetak" : "Printer masih menolak"
      );
    },
    onError: (error) =>
      pushToast("error", "Cetak ulang", errorMessage(error, "Gagal")),
  });

  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        title={MENU_LABELS.tiket}
        sub="Tiket muster yang terbit hari itu — termasuk yang gagal tercetak dan masih menunggu cetak ulang."
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
          </ToolbarGroup>
        </Toolbar>

        <TicketsView
          data={tickets}
          loading={ticketsQ.isLoading}
          canW={canW}
          onReprint={(id) => reprint.mutate(id)}
          busy={reprint.isPending}
        />

        <PanelFoot>
          <FootSum>
            {tickets
              ? `${tickets.printed} tercetak · ${tickets.failed} gagal · ${tickets.dry} kering`
              : ""}
          </FootSum>
        </PanelFoot>
      </Panel>
    </div>
  );
}

/**
 * Tickets issued on one date, and the ones still owed.
 *
 * A ticket that failed to print is the only kind nobody can see: the tap was
 * recorded, the person walked away, and without this screen the failure lives
 * in a log. So failures sort first and carry the printer's own reason, and the
 * whole slip can be read here without a printer.
 */
function TicketsView({
  data,
  loading,
  canW,
  onReprint,
  busy,
}: {
  data?: {
    printing: boolean;
    rows: Array<{
      id: string;
      nik: string;
      name: string | null;
      status: "printed" | "failed" | "dry";
      at: string;
      unit: string | null;
      machine: string;
      printer: string | null;
      attempts: number;
      lastError: string | null;
      preview: string;
    }>;
  };
  loading: boolean;
  canW: boolean;
  onReprint: (id: string) => void;
  busy: boolean;
}) {
  const [open, setOpen] = React.useState<string | null>(null);
  const rows = data?.rows ?? [];

  if (rows.length === 0)
    return (
      <StateBox
        icon={<Printer className="text-(--text-tertiary)" />}
        title="Belum ada tiket"
        body={
          loading
            ? "Memuat…"
            : "Tiket terbit saat seseorang menempel jari di bilik yang sedang didengarkan."
        }
      />
    );

  /* A failure is the only row that needs somebody to do something. */
  const rank = (s: string) => (s === "failed" ? 0 : s === "dry" ? 1 : 2);
  const sorted = [...rows].sort((a, b) => rank(a.status) - rank(b.status));

  const chip = (status: string) =>
    status === "printed"
      ? {
          label: "Tercetak",
          tone: "bg-[rgba(32,200,120,.12)] text-(--badge-success-text)",
        }
      : status === "failed"
        ? {
            label: "Gagal",
            tone: "bg-[rgba(252,60,59,.12)] text-(--color-danger)",
          }
        : {
            label: "Cetak kering",
            tone: "bg-(--fill-subtle) text-(--text-secondary)",
          };

  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      {data && !data.printing ? (
        <p className="text-sm text-(--text-secondary)">
          Pencetakan sedang dimatikan, jadi tiket hanya disusun dan disimpan.
          Nyalakan lewat <code>TICKET_PRINTING</code> kalau printernya sudah
          siap.
        </p>
      ) : null}

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Jam absen</TableHead>
              <TableHead>NIK</TableHead>
              <TableHead>Nama</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Printer</TableHead>
              <TableHead style={{ width: 160 }}>Tindakan</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((r) => {
              const c = chip(r.status);
              return (
                <React.Fragment key={r.id}>
                  <TableRow>
                    <TableCell className="font-mono tabular-nums">
                      {r.at.slice(11, 19)}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {r.nik}
                    </TableCell>
                    <TableCell>{r.name ?? "—"}</TableCell>
                    <TableCell className="font-mono">
                      {/* Most spares hold none, most mornings. */}
                      {r.unit ?? (
                        <span className="text-(--text-tertiary)">—</span>
                      )}
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
                      {r.lastError ? (
                        <div className="mt-1 font-mono text-[11px] text-(--text-tertiary)">
                          {r.lastError} · {r.attempts}×
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-(--text-secondary)">
                      {r.printer ?? "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          onClick={() => setOpen(open === r.id ? null : r.id)}
                        >
                          {open === r.id ? "Tutup" : "Lihat"}
                        </Button>
                        {canW && r.status === "failed" ? (
                          <Button
                            disabled={busy}
                            onClick={() => onReprint(r.id)}
                          >
                            Cetak ulang
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                  {open === r.id ? (
                    <TableRow>
                      <TableCell colSpan={7}>
                        {/* The slip itself — readable without a printer, which
                            is the only way to review one until there is one. */}
                        <pre className="overflow-x-auto rounded-chip bg-(--fill-subtle) p-3 font-mono text-[12px] leading-relaxed">
                          {r.preview}
                        </pre>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </React.Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
