"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  CalendarClock,
  Check,
  Copy,
  KeyRound,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";

import {
  INTEGRATION_SCOPE_ENDPOINTS,
  INTEGRATION_SCOPES,
  MENU_LABELS,
  type IntegrationScope,
} from "@universe/contracts";

import type { AccessMode } from "@/lib/access";
import { api, errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
  integrationClientsKey,
  integrationClientsQueryOptions,
  type IntegrationClientRow,
} from "@/lib/queries/integration-clients";
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
import {
  FootSum,
  PageTitle,
  Panel,
  PanelFoot,
  Toolbar,
  ToolbarTitle,
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

import {
  defaultValidity,
  siteToday,
  validityBody,
  validityProblem,
  validityState,
  type ValidityInput,
} from "./integration-validity";
import { ValidityFields } from "./integration-validity-fields";

const stamp = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("id-ID", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

/** "a, b  c" → ["a", "b", "c"]: commas or spaces, whichever was typed. */
const splitIps = (raw: string) =>
  raw
    .split(/[\s,]+/)
    .map((ip) => ip.trim())
    .filter(Boolean);

/**
 * Integrasi API — tokens for other services on the site network.
 *
 * A service is not a person: it holds no role and logs in to nothing, so it
 * is registered here and given a token with the reads it may make. The token
 * is shown once, in the dialog that follows creating it — only its hash is
 * kept — so losing it means revoking and issuing another.
 */
export function IntegrationsMenu({ mode }: { mode: AccessMode }) {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const canW = mode === "manage";

  const listQ = useQuery(integrationClientsQueryOptions());
  const rows = listQ.data ?? [];
  const live = rows.filter((r) => !r.revokedAt).length;

  const [adding, setAdding] = React.useState(false);
  const [name, setName] = React.useState("");
  const [scopes, setScopes] = React.useState<IntegrationScope[]>([
    "employees:read",
  ]);
  const [ips, setIps] = React.useState("");
  const [validity, setValidity] = React.useState<ValidityInput>(() =>
    defaultValidity(siteToday())
  );
  /** Ubah masa berlaku keeps the token; Ganti token issues a new one. */
  const [renew, setRenew] = React.useState<{
    action: "dates" | "rotate";
    row: IntegrationClientRow;
    validity: ValidityInput;
  } | null>(null);
  const [issued, setIssued] = React.useState<{
    name: string;
    token: string;
  } | null>(null);
  const [copied, setCopied] = React.useState(false);
  const tokenInput = React.useRef<HTMLInputElement>(null);
  const copiedTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [revokeTarget, setRevokeTarget] =
    React.useState<IntegrationClientRow | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: integrationClientsKey });

  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.v1["integration-clients"].post({
        name: name.trim(),
        scopes,
        allowedIps: splitIps(ips),
        ...validityBody(validity),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async (row) => {
      await invalidate();
      setAdding(false);
      setIssued({ name: row.name, token: row.token });
    },
    onError: (error) =>
      pushToast(
        "error",
        "Gagal membuat token",
        errorMessage(error, t.loginErr)
      ),
  });

  const redate = useMutation({
    mutationFn: async (input: {
      row: IntegrationClientRow;
      validity: ValidityInput;
    }) => {
      const { data, error } = await api.v1["integration-clients"]({
        id: input.row.id,
      }).validity.post(validityBody(input.validity));
      if (error) throw error;
      return data;
    },
    onSuccess: async (row) => {
      await invalidate();
      pushToast(
        "success",
        "Masa berlaku diperbarui",
        row.validUntil
          ? `${row.name} berlaku ${day(row.validFrom)} – ${day(row.validUntil)}`
          : `${row.name} berlaku mulai ${day(row.validFrom)}, tanpa batas`
      );
      setRenew(null);
    },
    onError: (error) =>
      pushToast(
        "error",
        "Gagal mengubah masa berlaku",
        errorMessage(error, t.loginErr)
      ),
  });

  const rotate = useMutation({
    mutationFn: async (input: {
      row: IntegrationClientRow;
      validity: ValidityInput;
    }) => {
      const { data, error } = await api.v1["integration-clients"]({
        id: input.row.id,
      }).rotate.post(validityBody(input.validity));
      if (error) throw error;
      return data;
    },
    onSuccess: async (row) => {
      await invalidate();
      setRenew(null);
      setIssued({ name: row.name, token: row.token });
    },
    onError: (error) =>
      pushToast(
        "error",
        "Gagal mengganti token",
        errorMessage(error, t.loginErr)
      ),
  });

  const revoke = useMutation({
    mutationFn: async (row: IntegrationClientRow) => {
      const { data, error } = await api.v1["integration-clients"]({
        id: row.id,
      }).revoke.post();
      if (error) throw error;
      return data;
    },
    onSuccess: async (row) => {
      await invalidate();
      pushToast(
        "success",
        "Token dicabut",
        `${row.name} tidak bisa masuk lagi`
      );
      setRevokeTarget(null);
    },
    onError: (error) =>
      pushToast("error", "Gagal mencabut", errorMessage(error, t.loginErr)),
  });

  function openAdd() {
    setName("");
    setScopes(["employees:read"]);
    setIps("");
    setValidity(defaultValidity(siteToday()));
    setAdding(true);
  }

  function toggleScope(scope: IntegrationScope, on: boolean) {
    setScopes((held) =>
      on ? [...held, scope] : held.filter((s) => s !== scope)
    );
  }

  React.useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    []
  );

  /*
   * `navigator.clipboard` exists only on a secure origin, and the site is
   * plain http on the LAN — so the selection fallback is the path that
   * normally runs, and failing both says so rather than doing nothing.
   */
  async function copyToken() {
    if (!issued) return;
    let done = false;
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(issued.token);
        done = true;
      }
    } catch {
      done = false;
    }
    if (!done && tokenInput.current) {
      tokenInput.current.select();
      done = document.execCommand("copy");
    }
    if (!done) {
      pushToast(
        "error",
        "Gagal menyalin",
        "Pilih token di kolom lalu salin manual (Ctrl+C)"
      );
      return;
    }
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 1600);
  }

  /** Drops the token everywhere it is held — the mutation cache included. */
  function closeIssued() {
    setIssued(null);
    setCopied(false);
    create.reset();
    rotate.reset();
  }

  const renewPending = redate.isPending || rotate.isPending;
  const today = siteToday();
  const addProblem = validityProblem(validity, today);
  const renewProblem = renew ? validityProblem(renew.validity, today) : null;

  /** The dialog opens on the client's own dates for a change of dates, and on
   *  today-to-a-year for a new token — a new token is a new start. */
  function openRenew(action: "dates" | "rotate", row: IntegrationClientRow) {
    setRenew({
      action,
      row,
      validity:
        action === "dates"
          ? {
              validFrom: row.validFrom,
              validUntil: row.validUntil ?? "",
              noEnd: row.validUntil === null,
            }
          : defaultValidity(today),
    });
  }

  function submitRenew() {
    if (!renew || renewProblem) return;
    const input = { row: renew.row, validity: renew.validity };
    if (renew.action === "dates") redate.mutate(input);
    else rotate.mutate(input);
  }

  function closeRenew() {
    if (!renewPending) setRenew(null);
  }

  /** Not mid-request: the token would then open a dialog nobody is waiting for. */
  function closeAdd() {
    if (!create.isPending) setAdding(false);
  }

  const canSubmit =
    name.trim().length > 0 && scopes.length > 0 && addProblem === null;

  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        title={MENU_LABELS.integrations}
        sub="Token untuk layanan lain di jaringan site yang membaca data dari Universe"
      >
        {canW ? (
          <Button onClick={openAdd}>
            <Plus />
            Tambah Klien
          </Button>
        ) : null}
      </PageTitle>

      <Panel>
        <Toolbar>
          <ToolbarTitle>Klien Terdaftar</ToolbarTitle>
        </Toolbar>

        {rows.length ? (
          <Table>
            <TableHeader>
              <tr>
                <TableHead>Nama</TableHead>
                <TableHead>Token</TableHead>
                <TableHead>Akses</TableHead>
                <TableHead>IP Diizinkan</TableHead>
                <TableHead>Dibuat</TableHead>
                <TableHead>Terakhir Dipakai</TableHead>
                <TableHead>Masa Berlaku</TableHead>
                <TableHead>Status</TableHead>
                {canW ? (
                  <TableHead style={{ width: 130 }}>{t.thAct}</TableHead>
                ) : null}
              </tr>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const state = validityState(r.validFrom, r.validUntil, today);
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-semibold">{r.name}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.tokenPrefix}…
                    </TableCell>
                    <TableCell className="font-mono text-xs whitespace-nowrap">
                      {r.scopes.flatMap((s) =>
                        (
                          INTEGRATION_SCOPE_ENDPOINTS[
                            s as IntegrationScope
                          ] ?? [s]
                        ).map((endpoint) => (
                          <div key={endpoint}>{endpoint}</div>
                        ))
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.allowedIps.length ? r.allowedIps.join(", ") : "Semua"}
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap">
                      {r.createdByName}
                      <div className="text-(--text-tertiary)">
                        {stamp(r.createdAt)}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap tabular-nums">
                      {stamp(r.lastUsedAt)}
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap tabular-nums">
                      {day(r.validFrom)} –{" "}
                      {r.validUntil ? day(r.validUntil) : "tanpa batas"}
                    </TableCell>
                    <TableCell>
                      {r.revokedAt ? (
                        <Badge
                          variant="neutral"
                          title={`Dicabut oleh ${r.revokedByName ?? "—"}, ${stamp(r.revokedAt)}`}
                        >
                          Dicabut
                        </Badge>
                      ) : state.kind === "expired" ? (
                        <Badge variant="danger">Kedaluwarsa</Badge>
                      ) : state.kind === "scheduled" ? (
                        <Badge variant="info">
                          Mulai {state.startsIn} hari lagi
                        </Badge>
                      ) : state.kind === "soon" ? (
                        <Badge variant="warning" dot>
                          {state.daysLeft === 0
                            ? "Hari terakhir"
                            : `Habis ${state.daysLeft} hari lagi`}
                        </Badge>
                      ) : (
                        <Badge variant="success" dot>
                          Aktif
                        </Badge>
                      )}
                    </TableCell>
                    {canW ? (
                      <TableCell>
                        {r.revokedAt ? null : (
                          <div className="flex gap-1">
                            <IconButton
                              aria-label="Ubah masa berlaku"
                              title="Ubah masa berlaku"
                              onClick={() => openRenew("dates", r)}
                            >
                              <CalendarClock />
                            </IconButton>
                            <IconButton
                              aria-label="Ganti token"
                              title="Ganti token"
                              onClick={() => openRenew("rotate", r)}
                            >
                              <RefreshCw />
                            </IconButton>
                            <IconButton
                              danger
                              aria-label="Cabut token"
                              title="Cabut token"
                              onClick={() => setRevokeTarget(r)}
                            >
                              <Ban />
                            </IconButton>
                          </div>
                        )}
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <StateBox
            icon={<Search className="text-(--color-primary-bright)" />}
            title={listQ.isError ? "Gagal memuat klien" : t.noResTitle}
            body={
              listQ.isError
                ? errorMessage(listQ.error, t.loginErr)
                : "Belum ada layanan yang diberi token."
            }
          />
        )}

        <PanelFoot>
          <FootSum>
            <b>{live}</b> token aktif dari <b>{rows.length}</b> klien
          </FootSum>
        </PanelFoot>
      </Panel>

      {/* tambah klien */}
      <Dialog
        open={adding}
        onClose={closeAdd}
        className="w-[min(520px,100%)]"
        labelledBy="intadd-t"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) create.mutate();
          }}
        >
          <DialogIcon variant="info">
            <KeyRound />
          </DialogIcon>
          <DialogTitle id="intadd-t">Tambah Klien</DialogTitle>
          <div className="mt-4 flex flex-col gap-4">
            <Field label="Nama layanan" htmlFor="intadd-name" required>
              <Input
                id="intadd-name"
                value={name}
                maxLength={100}
                placeholder="mis. HRIS Site"
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label={<span id="intadd-scopes">Akses</span>}>
              <div
                role="group"
                aria-labelledby="intadd-scopes"
                className="flex flex-col gap-2"
              >
                {INTEGRATION_SCOPES.map((scope) => (
                  <ToggleRow key={scope}>
                    <Checkbox
                      checked={scopes.includes(scope)}
                      onChange={(e) => toggleScope(scope, e.target.checked)}
                    />
                    <span className="font-mono text-xs">
                      {INTEGRATION_SCOPE_ENDPOINTS[scope].join(" · ")}
                    </span>
                  </ToggleRow>
                ))}
              </div>
            </Field>
            <Field
              label="IP diizinkan"
              htmlFor="intadd-ips"
              helper="Opsional. Kosongkan untuk mengizinkan alamat mana pun; pisahkan dengan koma."
            >
              <Input
                id="intadd-ips"
                value={ips}
                className="font-mono"
                placeholder="192.168.151.40"
                onChange={(e) => setIps(e.target.value)}
              />
            </Field>
            <ValidityFields
              idPrefix="intadd"
              value={validity}
              problem={addProblem}
              onChange={setValidity}
            />
          </div>
          <DialogActions>
            <Button
              type="button"
              variant="ghost"
              disabled={create.isPending}
              onClick={closeAdd}
            >
              {t.btnCancel}
            </Button>
            <Button type="submit" disabled={!canSubmit || create.isPending}>
              Buat Token
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* token — tampil sekali */}
      <Dialog
        open={issued !== null}
        onClose={closeIssued}
        className="w-[min(600px,100%)]"
        labelledBy="inttok-t"
      >
        <DialogIcon variant="warning">
          <KeyRound />
        </DialogIcon>
        <DialogTitle id="inttok-t">Token untuk {issued?.name}</DialogTitle>
        <DialogBody>
          Salin sekarang dan serahkan ke pengelola layanan. Token ini{" "}
          <b>tidak akan ditampilkan lagi</b> — kalau hilang, pakai Ganti Token
          untuk membuat yang baru. Pakai sebagai header{" "}
          <code className="font-mono">Authorization: Bearer &lt;token&gt;</code>
          .
        </DialogBody>
        <div className="mt-4 flex items-center gap-2">
          <Input
            ref={tokenInput}
            readOnly
            aria-label="Token"
            value={issued?.token ?? ""}
            className="font-mono text-xs"
            onFocus={(e) => e.target.select()}
          />
          <Button variant="secondary" onClick={copyToken}>
            {copied ? <Check /> : <Copy />}
            {copied ? "Tersalin" : "Salin"}
          </Button>
        </div>
        <DialogActions>
          <Button onClick={closeIssued}>Sudah Disalin</Button>
        </DialogActions>
      </Dialog>

      {/* ubah masa berlaku / ganti token */}
      <Dialog
        open={renew !== null}
        onClose={closeRenew}
        className="w-[min(520px,100%)]"
        labelledBy="intren-t"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitRenew();
          }}
        >
          <DialogIcon variant={renew?.action === "rotate" ? "warning" : "info"}>
            {renew?.action === "rotate" ? <RefreshCw /> : <CalendarClock />}
          </DialogIcon>
          <DialogTitle id="intren-t">
            {renew?.action === "rotate" ? "Ganti token" : "Ubah masa berlaku"}{" "}
            {renew?.row.name}
          </DialogTitle>
          <DialogBody>
            {renew?.action === "rotate" ? (
              <>
                Token baru dibuat dan ditampilkan sekali.{" "}
                <b>Token lama langsung tidak berlaku</b> — pastikan pengelola
                layanan siap memasang token baru.
              </>
            ) : (
              <>
                Token tetap sama; hanya rentang tanggal berlakunya yang diubah.
                Token yang sudah kedaluwarsa aktif kembali.
              </>
            )}
          </DialogBody>
          <div className="mt-4">
            {renew ? (
              <ValidityFields
                idPrefix="intren"
                value={renew.validity}
                problem={renewProblem}
                onChange={(next) =>
                  setRenew((current) =>
                    current ? { ...current, validity: next } : current
                  )
                }
              />
            ) : null}
          </div>
          <DialogActions>
            <Button
              type="button"
              variant="ghost"
              disabled={renewPending}
              onClick={closeRenew}
            >
              {t.btnCancel}
            </Button>
            <Button
              type="submit"
              disabled={renewPending || renewProblem !== null}
            >
              {renew?.action === "rotate" ? "Ganti Token" : "Simpan"}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* cabut */}
      <Dialog
        open={!!revokeTarget}
        onClose={() => setRevokeTarget(null)}
        labelledBy="intrev-t"
      >
        <DialogIcon variant="danger">
          <Ban />
        </DialogIcon>
        <DialogTitle id="intrev-t">Cabut token?</DialogTitle>
        <DialogBody>
          <b>{revokeTarget?.name}</b> langsung tidak bisa membaca data lagi
          sejak permintaan berikutnya. Tindakan ini tidak bisa dibatalkan —
          untuk mengaktifkan kembali, buat klien baru.
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
            Cabut Token
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
