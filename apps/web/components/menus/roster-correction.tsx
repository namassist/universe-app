"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Undo2 } from "lucide-react";

import { MENU_LABELS } from "@universe/contracts";

import type { AccessMode } from "@/lib/access";
import { api, errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
  rosterCorrectionsQueryOptions,
  rosterCorrectionsRoot,
  type RosterCorrectionRow,
} from "@/lib/queries/roster-corrections";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogIcon,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Pagination, usePagination } from "@/components/ui/pagination";
import {
  FootSum,
  PageTitle,
  Panel,
  PanelFoot,
  Toolbar,
  ToolbarGroup,
  ToolbarTitle,
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

/** The site's calendar day, `YYYY-MM-DD` — the browser is on site time. */
const localDay = (offsetDays = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString("sv-SE");
};

const stamp = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * Koreksi Roster — a day set by hand above unggul_att.
 *
 * For the call-in that unggul_att learns of only after the shift has started:
 * rostered N, working the morning. The correction takes effect at once and
 * outlives every later pull; withdrawing it hands the day back to the source.
 * Corrections are added on their own page, several people for one date at a
 * time (`roster-correction-new.tsx`); this screen lists and withdraws them.
 * A board already generated is not rebuilt — a correction after the muster is
 * followed by a manual placement on Unit No-Operator.
 */
export function RosterCorrectionMenu({ mode }: { mode: AccessMode }) {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const canW = mode === "manage";
  const router = useRouter();

  const [q, setQ] = React.useState("");
  const needle = React.useDeferredValue(q.trim());
  const [from, setFrom] = React.useState(() => localDay(-7));
  const [to, setTo] = React.useState("");
  const listQ = useQuery(
    rosterCorrectionsQueryOptions({ q: needle, from, to })
  );
  const rows = React.useMemo(() => listQ.data ?? [], [listQ.data]);
  const pg = usePagination(rows, "25");

  const [revokeTarget, setRevokeTarget] =
    React.useState<RosterCorrectionRow | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: rosterCorrectionsRoot });

  const revoke = useMutation({
    mutationFn: async (row: RosterCorrectionRow) => {
      const { data, error } = await api.v1["roster-corrections"]({
        id: row.id,
      }).revoke.post();
      if (error) throw error;
      return data;
    },
    onSuccess: async (row) => {
      await invalidate();
      pushToast(
        "success",
        "Koreksi dibatalkan",
        `${row.name} — ${row.date} kembali ${row.fromCode ?? "kosong"}`
      );
      setRevokeTarget(null);
    },
    onError: (error) =>
      pushToast("error", "Gagal membatalkan", errorMessage(error, t.loginErr)),
  });

  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        title={MENU_LABELS["roster-correction"]}
        sub="Ubah roster satu orang untuk satu hari, di atas data unggul_att — berlaku langsung dan tidak tertimpa tarikan berikutnya"
      >
        {canW ? (
          <Button onClick={() => router.push("/roster-correction/new")}>
            <Plus />
            Tambah Koreksi
          </Button>
        ) : null}
      </PageTitle>

      <Panel>
        <Toolbar>
          <ToolbarTitle>Daftar Koreksi</ToolbarTitle>
          <ToolbarGroup>
            <SearchInput
              className="w-[240px]"
              placeholder="Cari NIK atau nama"
              aria-label="Cari NIK atau nama"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <Input
              type="date"
              className="w-[160px]"
              aria-label="Dari tanggal"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <Input
              type="date"
              className="w-[160px]"
              aria-label="Sampai tanggal"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </ToolbarGroup>
        </Toolbar>

        {rows.length ? (
          <Table>
            <TableHeader>
              <tr>
                <TableHead>Tanggal</TableHead>
                <TableHead>NIK</TableHead>
                <TableHead>Nama</TableHead>
                <TableHead>Departemen</TableHead>
                <TableHead>Roster</TableHead>
                <TableHead>Alasan</TableHead>
                <TableHead>Dibuat</TableHead>
                <TableHead>Status</TableHead>
                {canW ? (
                  <TableHead style={{ width: 70 }}>{t.thAct}</TableHead>
                ) : null}
              </tr>
            </TableHeader>
            <TableBody>
              {pg.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono whitespace-nowrap tabular-nums">
                    {r.date}
                  </TableCell>
                  <TableCell className="font-mono">{r.nik}</TableCell>
                  <TableCell className="font-semibold">{r.name}</TableCell>
                  <TableCell>{r.departmentName}</TableCell>
                  <TableCell className="font-mono whitespace-nowrap">
                    {r.fromCode ?? "—"} → <b>{r.toCode}</b>
                  </TableCell>
                  <TableCell className="max-w-[260px]">{r.reason}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {r.createdByName}
                    <div className="text-(--text-tertiary)">
                      {stamp(r.createdAt)}
                    </div>
                  </TableCell>
                  <TableCell>
                    {r.revokedAt ? (
                      <Badge
                        variant="neutral"
                        title={`Dibatalkan oleh ${r.revokedByName ?? "—"}, ${stamp(r.revokedAt)}`}
                      >
                        Dibatalkan
                      </Badge>
                    ) : (
                      <Badge variant="success" dot>
                        Berlaku
                      </Badge>
                    )}
                  </TableCell>
                  {canW ? (
                    <TableCell>
                      {r.revokedAt ? null : (
                        <IconButton
                          danger
                          aria-label="Batalkan koreksi"
                          onClick={() => setRevokeTarget(r)}
                        >
                          <Undo2 />
                        </IconButton>
                      )}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <StateBox
            icon={<Search className="text-(--color-primary-bright)" />}
            title={listQ.isError ? "Gagal memuat koreksi" : t.noResTitle}
            body={
              listQ.isError
                ? errorMessage(listQ.error, t.loginErr)
                : "Belum ada koreksi roster di rentang tanggal ini."
            }
          />
        )}

        <PanelFoot>
          <FootSum>
            Menampilkan <b>{pg.range}</b> dari <b>{pg.total}</b> koreksi
          </FootSum>
          <Pagination
            page={pg.page}
            pageCount={pg.pageCount}
            onPage={pg.setPage}
            per={pg.per}
            perOptions={["10", "25", "50"]}
            onPer={pg.setPer}
          />
        </PanelFoot>
      </Panel>

      <Dialog
        open={!!revokeTarget}
        onClose={() => setRevokeTarget(null)}
        labelledBy="rcr-t"
      >
        <DialogIcon variant="danger">
          <Undo2 />
        </DialogIcon>
        <DialogTitle id="rcr-t">Batalkan koreksi?</DialogTitle>
        <DialogBody>
          Roster {revokeTarget?.name} tanggal {revokeTarget?.date} kembali ke{" "}
          <b>{revokeTarget?.fromCode ?? "kosong"}</b>, lalu mengikuti unggul_att
          pada tarikan berikutnya. Board yang sudah terbentuk tidak berubah.
        </DialogBody>
        <DialogActions>
          <Button variant="ghost" onClick={() => setRevokeTarget(null)}>
            {t.btnCancel}
          </Button>
          <Button
            variant="destructive"
            disabled={revoke.isPending}
            onClick={() => revokeTarget && revoke.mutate(revokeTarget)}
          >
            Batalkan Koreksi
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
