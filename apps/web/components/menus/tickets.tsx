"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Printer } from "lucide-react";

import { MENU_LABELS, type AccessMode } from "@/lib/access";
import { api, errorMessage } from "@/lib/api";
import {
  ticketsKey,
  ticketsQueryOptions,
  type TicketFilters,
} from "@/lib/queries/tickets";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
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

  const [department, setDepartment] = React.useState("");
  const [role, setRole] = React.useState("");
  const [shift, setShift] = React.useState("");
  const [status, setStatus] = React.useState("");

  /* The search runs server-side, so it is debounced rather than sent per
     keystroke to a list that can hold five hundred rows. */
  const [typed, setTyped] = React.useState("");
  const [q, setQ] = React.useState("");
  React.useEffect(() => {
    const timer = setTimeout(() => setQ(typed.trim()), 300);
    return () => clearTimeout(timer);
  }, [typed]);

  /* An empty select means "all", which is an absent parameter rather than an
     empty one — the API reads a blank string as a value to match. */
  const filters: TicketFilters = React.useMemo(
    () => ({
      ...(q ? { q } : {}),
      ...(department ? { department } : {}),
      ...(role ? { role: role as "standing" | "spare" } : {}),
      ...(shift ? { shift: shift as "day" | "night" } : {}),
      ...(status ? { status: status as "printed" | "failed" | "dry" } : {}),
    }),
    [q, department, role, shift, status]
  );

  const ticketsQ = useQuery(ticketsQueryOptions(date, filters));
  const tickets = ticketsQ.data;

  const reprint = useMutation({
    mutationFn: async (id: string) => {
      const result = await api.v1.tickets({ id }).reprint.post();
      if (result.error) throw result.error;
      return result.data;
    },
    onSuccess: async (r) => {
      await queryClient.invalidateQueries({ queryKey: ["tickets"] });
      pushToast(
        r.status === "printed" ? "success" : "error",
        "Cetak tiket",
        r.status === "printed" ? "Tiket tercetak" : "Printer menolak"
      );
    },
    onError: (error) =>
      pushToast("error", "Cetak tiket", errorMessage(error, "Gagal")),
  });

  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        title={MENU_LABELS.tiket}
        sub="Tiket muster yang terbit hari itu. Saring per departemen, nama, jenis operator atau shift — dan cetak ulang sendiri kalau ada yang tidak sampai ke tangan orangnya."
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
              placeholder="NIK atau nama"
              aria-label="Cari tiket"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onClear={() => setTyped("")}
            />
            {/* Options come from the whole day, so picking one department does
                not empty the list you would use to pick another. */}
            <Select
              wrapperClassName="w-[210px]"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              aria-label="Departemen"
            >
              <option value="">Semua departemen</option>
              {(tickets?.departments ?? []).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
            <Select
              wrapperClassName="w-[170px]"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              aria-label="Jenis operator"
            >
              <option value="">Semua jenis</option>
              <option value="standing">Tetap</option>
              <option value="spare">Spare</option>
            </Select>
            <Select
              wrapperClassName="w-[150px]"
              value={shift}
              onChange={(e) => setShift(e.target.value)}
              aria-label="Shift"
            >
              <option value="">Semua shift</option>
              <option value="day">Siang</option>
              <option value="night">Malam</option>
            </Select>
            <Select
              wrapperClassName="w-[170px]"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              aria-label="Status cetak"
            >
              <option value="">Semua status</option>
              <option value="printed">Tercetak</option>
              <option value="failed">Gagal</option>
              <option value="dry">Cetak kering</option>
            </Select>
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
      department: string | null;
      shift: "day" | "night";
      role: "standing" | "spare" | null;
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
              <TableHead>Departemen</TableHead>
              <TableHead>Jenis</TableHead>
              <TableHead>Shift</TableHead>
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
                    <TableCell className="text-(--text-secondary)">
                      {r.department ?? "—"}
                    </TableCell>
                    <TableCell>
                      {/* The words the slip itself carries. A ticket printed
                          before the line existed shows a dash rather than a
                          guess at what it would have said. */}
                      {r.role ? (
                        <Badge
                          variant={r.role === "spare" ? "warning" : "info"}
                        >
                          {r.role === "spare" ? "SPARE" : "TETAP"}
                        </Badge>
                      ) : (
                        <span className="text-(--text-tertiary)">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-(--text-secondary)">
                      {r.shift === "night" ? "Malam" : "Siang"}
                    </TableCell>
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
                        {/* Every row, not only the failures (owner,
                            2026-09-14). A slip the printer swallowed, one
                            torn on the way out, one an operator lost between
                            the booth and the bus — none of those look like a
                            failure from here, and all of them end with
                            somebody asking for the paper again. */}
                        {canW ? (
                          <Button
                            variant={
                              r.status === "failed" ? "primary" : "ghost"
                            }
                            disabled={busy}
                            onClick={() => onReprint(r.id)}
                          >
                            {r.status === "dry" ? "Cetak" : "Cetak ulang"}
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                  {open === r.id ? (
                    <TableRow>
                      <TableCell colSpan={10}>
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
