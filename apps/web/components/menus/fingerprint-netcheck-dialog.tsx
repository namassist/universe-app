"use client";

import * as React from "react";
import { Activity, RotateCw } from "lucide-react";

import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, ToggleRow } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogIcon,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  rowHasProblem,
  runPooled,
  sortForDisplay,
  summarise,
  type CheckStatus,
  type NetcheckResult,
  type NetcheckRow,
} from "./fingerprint-netcheck";

/** Checks in flight at once; each one is five probes of up to three seconds. */
const CONCURRENCY = 6;

const pendingRows = (machines: readonly { id: string; name: string }[]) =>
  machines.map((m): NetcheckRow => ({
    id: m.id,
    name: m.name,
    state: "pending",
  }));

/**
 * "Which booth is the problem?" — the site's `netcheck.sh`, in a dialog.
 *
 * Mounted only while open, and the machines it checks are fixed at mount: a
 * list refetch underneath must not restart a check half way. One request per
 * machine, so rows fill in as they answer and problems rise to the top.
 */
export function NetcheckDialog({
  machines,
  scopeLabel,
  onClose,
}: {
  machines: readonly { id: string; name: string }[];
  scopeLabel: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [targets] = React.useState(machines);
  const [rows, setRows] = React.useState(() => pendingRows(targets));
  const [round, setRound] = React.useState(0);
  const [onlyProblems, setOnlyProblems] = React.useState(false);

  React.useEffect(() => {
    /* Aborted on close, on re-run and on StrictMode's dev remount: a dropped
       answer is not enough, because the request still makes the server probe
       a booth, and bursts are what push slow machines past their timeout. */
    const abort = new AbortController();
    const { signal } = abort;
    const settle = (id: string, patch: Partial<NetcheckRow>) => {
      if (signal.aborted) return;
      setRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, ...patch } : r))
      );
    };
    void runPooled(
      targets,
      CONCURRENCY,
      async (m) => {
        try {
          const { data, error } = await api.v1["fingerprint-machines"]({
            id: m.id,
          }).netcheck.post(undefined, { fetch: { signal } });
          if (error) throw error;
          settle(m.id, { state: "done", result: data as NetcheckResult });
        } catch {
          settle(m.id, { state: "error" });
        }
      },
      () => signal.aborted
    );
    return () => abort.abort();
  }, [targets, round]);

  function rerun() {
    setRows(pendingRows(targets));
    setRound((n) => n + 1);
  }

  const sum = summarise(rows);
  const running = sum.finished < sum.total;
  const shown = sortForDisplay(rows).filter(
    (r) => !onlyProblems || rowHasProblem(r)
  );
  const anyUnavailable = rows.some(
    (r) =>
      r.result?.finger.ping === "unavailable" ||
      r.result?.printer?.ping === "unavailable"
  );

  return (
    <Dialog
      open
      onClose={onClose}
      labelledBy="mfn-t"
      className="w-[min(1080px,100%)]"
    >
      <DialogIcon variant="info">
        <Activity />
      </DialogIcon>
      <DialogTitle id="mfn-t">{t.mfPingT}</DialogTitle>
      <DialogBody>{t.mfPingB}</DialogBody>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span className="text-(--text-tertiary)">
          {scopeLabel}: <b className="text-(--text-primary)">{sum.total}</b>
        </span>
        <span aria-hidden>
          {t.mfPingProblems}:{" "}
          <b
            className={
              sum.problems
                ? "text-(--badge-danger-text)"
                : "text-(--text-primary)"
            }
          >
            {sum.problems}
          </b>{" "}
          {t.mfPingOf} {sum.total}
        </span>
        {/* Always mounted: a live region inserted together with its text is
            often not announced, and this one must also say when it is done.
            Visible only while checking — once done, the count beside it
            already says the same thing, and showing both printed it twice. */}
        <span
          className={running ? "text-(--text-tertiary)" : "sr-only"}
          role="status"
        >
          {running
            ? `${t.mfPingChecking} ${sum.finished}/${sum.total}`
            : sum.total
              ? `${t.mfPingProblems}: ${sum.problems} ${t.mfPingOf} ${sum.total}`
              : ""}
        </span>
        <ToggleRow className="ml-auto" htmlFor="mfn-only">
          <Checkbox
            id="mfn-only"
            checked={onlyProblems}
            onChange={(e) => setOnlyProblems(e.target.checked)}
          />
          {t.mfPingOnlyProblems}
        </ToggleRow>
      </div>

      <div className="mt-3 min-h-0 flex-1 overflow-auto">
        {!sum.total ? (
          <p className="py-6 text-center text-sm text-(--text-tertiary)">
            {t.mfPingNone}
          </p>
        ) : !shown.length ? (
          <p className="py-6 text-center text-sm text-(--text-tertiary)">
            {running ? t.mfPingChecking : t.mfPingAllOk}
          </p>
        ) : (
          <Table className="min-w-[860px]">
            <TableHeader>
              <tr>
                <TableHead>{t.mfName}</TableHead>
                <TableHead>{t.mfIp}</TableHead>
                <TableHead aria-label={`${t.mfIp} — ping`}>Ping</TableHead>
                <TableHead>Web</TableHead>
                <TableHead>:4370</TableHead>
                <TableHead>{t.mfPrinterIp}</TableHead>
                <TableHead aria-label={`${t.mfPrinterIp} — ping`}>
                  Ping
                </TableHead>
                <TableHead>:9100</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {shown.map((r) => (
                <NetcheckTableRow key={r.id} row={r} />
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {anyUnavailable ? (
        <p className="mt-2 text-xs text-(--text-tertiary)">{t.mfPingNaNote}</p>
      ) : null}

      <DialogActions>
        <Button variant="ghost" onClick={onClose}>
          {t.btnClose}
        </Button>
        <Button
          variant="secondary"
          disabled={running || !sum.total}
          onClick={rerun}
        >
          <RotateCw />
          {t.mfPingRetry}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function NetcheckTableRow({ row }: { row: NetcheckRow }) {
  const { t } = useI18n();
  const finger = row.result?.finger;
  const printer = row.result?.printer;
  const pending = row.state === "pending";

  return (
    <TableRow>
      <TableCell>
        <span className="font-semibold">{row.name}</span>
        {row.state === "error" ? (
          <Badge className="ml-2" variant="danger">
            {t.mfPingErr}
          </Badge>
        ) : null}
      </TableCell>
      <TableCell className="font-mono tabular-nums">
        {finger?.ip ?? "—"}
      </TableCell>
      <StatusCell pending={pending} status={finger?.ping} />
      <StatusCell
        pending={pending}
        status={finger?.web}
        port={finger && finger.port !== 80 ? finger.port : undefined}
      />
      <StatusCell pending={pending} status={finger?.zk} />
      <TableCell className="font-mono tabular-nums">
        {printer?.ip ?? <span className="text-(--text-tertiary)">—</span>}
      </TableCell>
      <StatusCell pending={pending} status={printer?.ping} />
      <StatusCell
        pending={pending}
        status={printer?.raw}
        port={printer && printer.port !== 9100 ? printer.port : undefined}
      />
    </TableRow>
  );
}

/** One check: ok / GAGAL / n/a, an ellipsis while it runs, a dash if none. */
function StatusCell({
  pending,
  status,
  port,
}: {
  pending: boolean;
  status: CheckStatus | undefined;
  /** Shown only when it differs from the column's usual port. */
  port?: number;
}) {
  const { t } = useI18n();
  let content: React.ReactNode;
  if (pending) content = <span className="text-(--text-tertiary)">…</span>;
  else if (!status) content = <span className="text-(--text-tertiary)">—</span>;
  else if (status === "ok") content = <Badge variant="success">ok</Badge>;
  else if (status === "fail")
    content = <Badge variant="danger">{t.mfPingFail}</Badge>;
  else content = <Badge variant="neutral">n/a</Badge>;

  return (
    <TableCell>
      {content}
      {port !== undefined ? (
        <span className="ml-1 font-mono text-xs text-(--text-tertiary)">
          :{port}
        </span>
      ) : null}
    </TableCell>
  );
}
