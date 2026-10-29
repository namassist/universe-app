"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";

import { api, errorMessage } from "@/lib/api";
import { fmt, useI18n } from "@/lib/i18n";
import {
  planBoardKey,
  planDefaultQueryOptions,
  planResetPreviewQueryOptions,
} from "@/lib/queries/fleet-allocation";
import { Button, Spinner } from "@/components/ui/button";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogIcon,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";

import { canConfirmReset, defaultLine, resetSummary } from "./plan-default";

/** "29 Okt 2026" — the day matters, a default can be weeks old. */
function dateOf(iso: string, lang: string) {
  return new Date(iso).toLocaleDateString(lang === "en" ? "en-GB" : "id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * The saved default's one-line description and, for whoever may manage the
 * plan, the Reset button. Reset never acts by itself: it opens
 * `ResetDialog`, which shows the diff and waits for a second, explicit click.
 */
export function PlanDefaultBar({ canManage }: { canManage: boolean }) {
  const { t, lang } = useI18n();
  const [open, setOpen] = React.useState(false);
  const defaultQ = useQuery(planDefaultQueryOptions());
  const info = defaultQ.data ?? null;
  // A failed read is not "no default": saying so would send someone to
  // upload a file the server already holds.
  const line = defaultQ.isPending
    ? "…"
    : defaultQ.isError
      ? t.faDefErr
      : defaultLine(
          info,
          { none: t.faDefNone, prefix: t.faDefPrefix, pairs: t.faImpRows },
          (iso) => dateOf(iso, lang)
        );

  return (
    <>
      <span
        className="max-w-[420px] min-w-0 truncate text-xs text-(--text-tertiary)"
        title={line}
      >
        {line}
      </span>
      {canManage ? (
        <Button
          variant="secondary"
          className="h-10"
          disabled={!info}
          onClick={() => setOpen(true)}
        >
          <RotateCcw />
          {t.faResetBtn}
        </Button>
      ) : null}
      {canManage ? (
        <ResetDialog open={open} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="flex-1 rounded-card border border-(--glass-2-border) px-3 py-2 text-center">
      <div className="text-lg font-bold tabular-nums">{n}</div>
      <div className="text-xs text-(--text-secondary)">{label}</div>
    </div>
  );
}

/**
 * The confirmation Reset always goes through (owner, 2026-10-29): it fetches
 * the diff on open, names what would be released, assigned and skipped, and
 * warns that the engine, the provisional fleet wall and the slips read the
 * PLAN. Confirm stays disabled until a non-empty diff has loaded.
 */
function ResetDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();

  const previewQ = useQuery({
    ...planResetPreviewQueryOptions(),
    enabled: open,
  });
  const preview = previewQ.data;
  const summary = preview ? resetSummary(preview) : null;

  const resetM = useMutation({
    mutationFn: async () => {
      const result = await api.v1["fleet-allocation"].plan.reset.post();
      if (result.error) throw result.error;
      return result.data;
    },
    onSuccess: async (data) => {
      // The board key is the prefix of the default, the reset preview, the
      // candidates and every unit's history, so this one reaches them all.
      await queryClient.invalidateQueries({ queryKey: planBoardKey });
      pushToast(
        "success",
        t.faResetDoneT,
        data
          ? fmt(t.faResetDoneD, {
              released: data.released,
              assigned: data.assigned,
              skipped: data.skipped.length,
            })
          : ""
      );
      onClose();
    },
    onError: (error) =>
      pushToast("error", t.faResetBtn, errorMessage(error, t.loginErr)),
  });

  // A reset on its way cannot be walked away from by Escape or the scrim.
  const close = () => {
    if (!resetM.isPending) onClose();
  };

  const canConfirm = canConfirmReset({
    preview,
    loading: previewQ.isFetching,
    pending: resetM.isPending,
    failed: previewQ.isError,
  });

  return (
    <Dialog
      open={open}
      onClose={close}
      labelledBy="fa-reset-t"
      className="w-[min(560px,100%)]"
    >
      <DialogIcon variant="danger">
        <RotateCcw />
      </DialogIcon>
      <DialogTitle id="fa-reset-t">{t.faResetT}</DialogTitle>
      <DialogBody>{t.faResetB}</DialogBody>

      <div className="mt-4 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {previewQ.isError ? (
          <p
            role="alert"
            className="rounded-control border border-(--badge-danger-border) bg-(--badge-danger-fill) px-3 py-2.5 text-xs text-(--color-danger-text)"
          >
            {errorMessage(previewQ.error, t.loginErr)}
          </p>
        ) : !preview || !summary ? (
          <p
            role="status"
            className="flex items-center gap-2 text-sm text-(--text-secondary)"
          >
            <Spinner />
            {t.faResetLoading}
          </p>
        ) : (
          <>
            <div className="flex gap-2">
              <Stat n={summary.release} label={t.faResetRelease} />
              <Stat n={summary.assign} label={t.faResetAssign} />
              <Stat n={summary.skipped} label={t.faResetSkipped} />
            </div>
            {summary.empty ? (
              <p className="text-sm text-(--text-secondary)">
                {t.faResetEmpty}
              </p>
            ) : null}
            {preview.skipped.length ? (
              <div>
                <p className="mb-1 text-xs font-semibold text-(--text-secondary)">
                  {t.faResetSkippedT}
                </p>
                <p className="mb-1 text-xs text-(--text-tertiary)">
                  {t.faResetSkippedNote}
                </p>
                <ul className="max-h-[24vh] overflow-y-auto rounded-control border border-(--glass-2-border) p-2 text-xs">
                  {preview.skipped.map((s) => (
                    <li key={`${s.unit}-${s.nik}`} className="py-1">
                      <span className="font-mono font-semibold">{s.unit}</span>{" "}
                      <span className="font-mono">{s.nik}</span> {s.name}
                      <span className="block text-(--text-tertiary)">
                        {s.reason}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p
              role="note"
              className="rounded-control border border-(--badge-warning-border) bg-(--badge-warning-fill) px-3 py-2.5 text-xs text-(--badge-warning-text)"
            >
              {t.faResetWarn}
            </p>
          </>
        )}
      </div>

      <DialogActions>
        <Button variant="ghost" onClick={close} disabled={resetM.isPending}>
          {t.btnCancel}
        </Button>
        <Button
          variant="destructive"
          disabled={!canConfirm}
          onClick={() => resetM.mutate()}
        >
          {resetM.isPending ? <Spinner /> : null}
          {t.faResetConfirm}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
