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
  type IntegrationScope,
} from "@universe/contracts";

import type { AccessMode } from "@/lib/access";
import { api, errorMessage } from "@/lib/api";
import { fmt, menuLabel, useI18n } from "@/lib/i18n";
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
      pushToast("error", t.igCreateFail, errorMessage(error, t.loginErr)),
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
        t.igDatesSaved,
        row.validUntil
          ? fmt(t.igValidRange, {
              name: row.name,
              from: day(row.validFrom),
              until: day(row.validUntil),
            })
          : fmt(t.igValidOpen, { name: row.name, from: day(row.validFrom) })
      );
      setRenew(null);
    },
    onError: (error) =>
      pushToast("error", t.igDatesFail, errorMessage(error, t.loginErr)),
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
      pushToast("error", t.igRotateFail, errorMessage(error, t.loginErr)),
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
      pushToast("success", t.igRevoked, fmt(t.igRevokedB, { name: row.name }));
      setRevokeTarget(null);
    },
    onError: (error) =>
      pushToast("error", t.igRevokeFail, errorMessage(error, t.loginErr)),
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
      pushToast("error", t.igCopyFail, t.igCopyManual);
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
  const addProblemKey = validityProblem(validity, today);
  const addProblem = addProblemKey ? t[addProblemKey] : null;
  const renewProblemKey = renew ? validityProblem(renew.validity, today) : null;
  const renewProblem = renewProblemKey ? t[renewProblemKey] : null;

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
      <PageTitle title={menuLabel(t, "integrations")} sub={t.igSub}>
        {canW ? (
          <Button onClick={openAdd}>
            <Plus />
            {t.igAdd}
          </Button>
        ) : null}
      </PageTitle>

      <Panel>
        <Toolbar>
          <ToolbarTitle>{t.igListT}</ToolbarTitle>
        </Toolbar>

        {rows.length ? (
          <Table>
            <TableHeader>
              <tr>
                <TableHead>{t.thNama}</TableHead>
                <TableHead>{t.cmToken}</TableHead>
                <TableHead>{t.igAccess}</TableHead>
                <TableHead>{t.igIps}</TableHead>
                <TableHead>{t.igCreated}</TableHead>
                <TableHead>{t.igLastUsed}</TableHead>
                <TableHead>{t.igValidity}</TableHead>
                <TableHead>{t.thStatus}</TableHead>
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
                      {r.allowedIps.length
                        ? r.allowedIps.join(", ")
                        : t.igAllIps}
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
                      {r.validUntil ? day(r.validUntil) : t.igNoEnd}
                    </TableCell>
                    <TableCell>
                      {r.revokedAt ? (
                        <Badge
                          variant="neutral"
                          title={fmt(t.igRevokedBy, {
                            name: r.revokedByName ?? "—",
                            at: stamp(r.revokedAt),
                          })}
                        >
                          {t.igStRevoked}
                        </Badge>
                      ) : state.kind === "expired" ? (
                        <Badge variant="danger">{t.igStExpired}</Badge>
                      ) : state.kind === "scheduled" ? (
                        <Badge variant="info">
                          {fmt(t.igStStartsIn, { n: state.startsIn })}
                        </Badge>
                      ) : state.kind === "soon" ? (
                        <Badge variant="warning" dot>
                          {state.daysLeft === 0
                            ? t.igStLastDay
                            : fmt(t.igStEndsIn, { n: state.daysLeft })}
                        </Badge>
                      ) : (
                        <Badge variant="success" dot>
                          {t.igStActive}
                        </Badge>
                      )}
                    </TableCell>
                    {canW ? (
                      <TableCell>
                        {r.revokedAt ? null : (
                          <div className="flex gap-1">
                            <IconButton
                              aria-label={t.igRenewDates}
                              title={t.igRenewDates}
                              onClick={() => openRenew("dates", r)}
                            >
                              <CalendarClock />
                            </IconButton>
                            <IconButton
                              aria-label={t.igRotate}
                              title={t.igRotate}
                              onClick={() => openRenew("rotate", r)}
                            >
                              <RefreshCw />
                            </IconButton>
                            <IconButton
                              danger
                              aria-label={t.igRevoke}
                              title={t.igRevoke}
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
            title={listQ.isError ? t.igLoadFail : t.noResTitle}
            body={
              listQ.isError ? errorMessage(listQ.error, t.loginErr) : t.igEmptyB
            }
          />
        )}

        <PanelFoot>
          <FootSum>
            <b>{live}</b> {t.igSumA} <b>{rows.length}</b> {t.igSumB}
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
          <DialogTitle id="intadd-t">{t.igAdd}</DialogTitle>
          <div className="mt-4 flex flex-col gap-4">
            <Field label={t.igName} htmlFor="intadd-name" required>
              <Input
                id="intadd-name"
                value={name}
                maxLength={100}
                placeholder={t.igNamePh}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label={<span id="intadd-scopes">{t.igAccess}</span>}>
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
              label={t.igIpsField}
              htmlFor="intadd-ips"
              helper={t.igIpsHelp}
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
              {t.igCreate}
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
        <DialogTitle id="inttok-t">
          {fmt(t.igTokenFor, { name: issued?.name ?? "" })}
        </DialogTitle>
        <DialogBody>
          {t.igShownOnceA} <b>{t.igShownOnceB}</b> {t.igShownOnceC}{" "}
          <code className="font-mono">Authorization: Bearer &lt;token&gt;</code>
          .
        </DialogBody>
        <div className="mt-4 flex items-center gap-2">
          <Input
            ref={tokenInput}
            readOnly
            aria-label={t.cmToken}
            value={issued?.token ?? ""}
            className="font-mono text-xs"
            onFocus={(e) => e.target.select()}
          />
          <Button variant="secondary" onClick={copyToken}>
            {copied ? <Check /> : <Copy />}
            {copied ? t.cmCopied : t.cmCopy}
          </Button>
        </div>
        <DialogActions>
          <Button onClick={closeIssued}>{t.igCopiedDone}</Button>
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
            {renew?.action === "rotate" ? t.igRotate : t.igRenewDates}{" "}
            {renew?.row.name}
          </DialogTitle>
          <DialogBody>
            {renew?.action === "rotate" ? (
              <>
                {t.igRotateB1} <b>{t.igRotateB2}</b> {t.igRotateB3}
              </>
            ) : (
              <>{t.igDatesB}</>
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
              {renew?.action === "rotate" ? t.igRotateBtn : t.cmSave}
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
        <DialogTitle id="intrev-t">{t.igRevokeT}</DialogTitle>
        <DialogBody>
          <b>{revokeTarget?.name}</b> {t.igRevokeB}
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
            {t.igRevokeBtn}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
