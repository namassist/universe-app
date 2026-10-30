"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";

import { api, errorMessage } from "@/lib/api";
import { fmt, useI18n } from "@/lib/i18n";
import {
  planBoardKey,
  planGeneratePreviewQueryOptions,
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

import { canConfirmGenerate, generateSummary } from "./plan-generate";
import { PlanStat } from "./plan-stat";

/**
 * The confirmation Generate always goes through (owner, 2026-10-30), shaped
 * like Reset's: it fetches the preview on open — the shift the clock gives,
 * each empty unit's spare, the holder a full unit gives up, the units left
 * empty — and writes only on a second, explicit click. The commit sends the
 * previewed shift and the preview's token back, so a dialog left open across
 * noon, or over a PLAN somebody else changed, is refused rather than writing
 * what nobody saw.
 *
 * Mounted only while open (the toolbar renders it conditionally), so the
 * preview query unmounts with it and a reopened dialog never shows the
 * previous answer.
 */
export function GenerateDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();

  const previewQ = useQuery(planGeneratePreviewQueryOptions());
  const preview = previewQ.data;
  const summary = preview ? generateSummary(preview) : null;

  const generateM = useMutation({
    mutationFn: async (previewed: {
      shift: "day" | "night";
      token: string;
    }) => {
      const result =
        await api.v1["fleet-allocation"].plan.generate.post(previewed);
      if (result.error) throw result.error;
      return result.data;
    },
    onSuccess: async (data) => {
      // The board key prefixes the previews, candidates and histories too.
      await queryClient.invalidateQueries({ queryKey: planBoardKey });
      pushToast(
        "success",
        t.faPlanGenDoneT,
        data
          ? fmt(t.faPlanGenDoneD, {
              assigned: data.assigned,
              released: data.released,
              unfilled: data.unfilled,
            })
          : ""
      );
      onClose();
    },
    onError: (error) =>
      pushToast("error", t.faPlanGenBtn, errorMessage(error, t.loginErr)),
  });

  const close = () => {
    if (!generateM.isPending) onClose();
  };

  const canConfirm = canConfirmGenerate({
    preview,
    loading: previewQ.isFetching,
    pending: generateM.isPending,
    failed: previewQ.isError,
  });

  return (
    <Dialog
      open
      onClose={close}
      labelledBy="fa-gen-t"
      className="w-[min(600px,100%)]"
    >
      <DialogIcon variant="info">
        <Sparkles />
      </DialogIcon>
      <DialogTitle id="fa-gen-t">{t.faPlanGenT}</DialogTitle>
      {preview ? (
        <DialogBody>
          {fmt(t.faPlanGenB, {
            shift: preview.shift === "day" ? t.shiftDay : t.shiftNight,
            date: preview.date,
          })}
        </DialogBody>
      ) : null}

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
            {t.faPlanGenLoading}
          </p>
        ) : (
          <>
            <div className="flex gap-2">
              <PlanStat n={summary.assign} label={t.faResetAssign} />
              <PlanStat n={summary.release} label={t.faResetRelease} />
              <PlanStat n={summary.unfilled} label={t.faPlanGenUnfilled} />
            </div>
            {summary.empty ? (
              <p className="text-sm text-(--text-secondary)">
                {t.faPlanGenEmpty}
              </p>
            ) : null}
            {preview.assign.length ? (
              <div>
                <p
                  id="fa-gen-list"
                  className="mb-1 text-xs font-semibold text-(--text-secondary)"
                >
                  {t.faPlanGenListT}
                </p>
                {/* Focusable so a keyboard can scroll a long list. */}
                <ul
                  role="region"
                  tabIndex={0}
                  aria-labelledby="fa-gen-list"
                  className="max-h-[28vh] overflow-y-auto rounded-control border border-(--glass-2-border) p-2 text-xs"
                >
                  {preview.assign.map((a) => (
                    <li key={a.unit} className="py-1">
                      <span className="font-mono font-semibold">{a.unit}</span>{" "}
                      <span className="text-(--text-tertiary)">
                        {a.simperCode ?? "—"}
                      </span>{" "}
                      <span aria-hidden="true">←</span> {a.name}{" "}
                      <span className="font-mono">{a.nik}</span>
                      {a.released ? (
                        <span className="block text-(--text-tertiary)">
                          {t.faPlanGenReplaces} {a.released.name}{" "}
                          <span className="font-mono">
                            {a.released.nik}
                            {a.released.rosterCode
                              ? ` · ${a.released.rosterCode}`
                              : ""}
                          </span>
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {preview.unfilled.length ? (
              <div>
                <p
                  id="fa-gen-unfilled"
                  className="mb-1 text-xs font-semibold text-(--text-secondary)"
                >
                  {t.faPlanGenUnfilledT}
                </p>
                <ul
                  role="region"
                  tabIndex={0}
                  aria-labelledby="fa-gen-unfilled"
                  className="max-h-[18vh] overflow-y-auto rounded-control border border-(--glass-2-border) p-2 text-xs"
                >
                  {preview.unfilled.map((u) => (
                    <li key={u.unit} className="py-1">
                      <span className="font-mono font-semibold">{u.unit}</span>{" "}
                      <span className="text-(--text-tertiary)">
                        {u.simperCode ?? "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {summary.sparesLeft ? (
              <p className="text-xs text-(--text-tertiary)">
                {fmt(t.faPlanGenSparesLeft, { n: summary.sparesLeft })}
              </p>
            ) : null}
            <p
              role="note"
              className="rounded-control border border-(--badge-warning-border) bg-(--badge-warning-fill) px-3 py-2.5 text-xs text-(--badge-warning-text)"
            >
              {t.faPlanGenWarn}
            </p>
          </>
        )}
      </div>

      <DialogActions>
        <Button variant="ghost" onClick={close} disabled={generateM.isPending}>
          {t.btnCancel}
        </Button>
        <Button
          variant="primary"
          disabled={!canConfirm}
          onClick={() =>
            preview &&
            generateM.mutate({ shift: preview.shift, token: preview.token })
          }
        >
          {generateM.isPending ? <Spinner /> : null}
          {t.faPlanGenConfirm}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
