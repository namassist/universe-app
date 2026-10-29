/**
 * What the PLAN toolbar and the Reset dialog say about the saved default,
 * kept apart from the markup so it can be tested.
 */

import type { PlanDefaultInfo, PlanResetPreview } from "@universe/contracts";

export type DefaultLineText = {
  /** Shown when no default exists yet. */
  none: string;
  /** "Default:" */
  prefix: string;
  /** "pairings" */
  pairs: string;
};

/**
 * "Default: plan.xlsx · 29 Okt 2026 · Budi · 42 pairings", or the nudge to
 * upload one. A default whose author is unknown (a deleted user) simply
 * leaves that part out rather than printing a placeholder.
 */
export function defaultLine(
  info: PlanDefaultInfo | null | undefined,
  text: DefaultLineText,
  dateOf: (iso: string) => string
): string {
  if (!info) return text.none;
  const parts = [
    info.fileName,
    dateOf(info.createdAt),
    ...(info.actorName ? [info.actorName] : []),
    `${info.pairs} ${text.pairs}`,
  ];
  return `${text.prefix} ${parts.join(" · ")}`;
}

export type ResetSummary = {
  release: number;
  assign: number;
  skipped: number;
  /** Nothing the reset could change: the live plan already is the default. */
  empty: boolean;
};

export function resetSummary(preview: PlanResetPreview): ResetSummary {
  const release = preview.release.length;
  const assign = preview.assign.length;
  return {
    release,
    assign,
    skipped: preview.skipped.length,
    empty: release === 0 && assign === 0,
  };
}

/**
 * Whether the dialog's confirm button may be pressed. Needs a freshly loaded
 * diff with something in it, and no reset already on its way. `failed` covers
 * a refresh that errored: the query keeps the old diff, which was never
 * checked against the plan as it is now.
 */
export function canConfirmReset(state: {
  preview: PlanResetPreview | undefined;
  loading: boolean;
  pending: boolean;
  failed: boolean;
}): boolean {
  if (state.loading || state.pending || state.failed || !state.preview)
    return false;
  return !resetSummary(state.preview).empty;
}
