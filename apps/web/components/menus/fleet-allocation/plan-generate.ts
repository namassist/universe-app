/**
 * What the Generate dialog says about its preview, kept apart from the markup
 * so it can be tested — the same split as `plan-default.ts` for Reset.
 */

import type { PlanGeneratePreview } from "@universe/contracts";

export type GenerateSummary = {
  assign: number;
  /** Holders a full unit gives up to make room for the spare. */
  release: number;
  unfilled: number;
  sparesLeft: number;
  /** No spare goes anywhere: nothing to confirm. */
  empty: boolean;
};

export function generateSummary(preview: PlanGeneratePreview): GenerateSummary {
  const assign = preview.assign.length;
  return {
    assign,
    release: preview.assign.filter((a) => a.released).length,
    unfilled: preview.unfilled.length,
    sparesLeft: preview.sparesLeft,
    empty: assign === 0,
  };
}

/**
 * Whether the dialog's confirm button may be pressed: a freshly loaded
 * preview with something in it, and no Generate already on its way.
 */
export function canConfirmGenerate(state: {
  preview: PlanGeneratePreview | undefined;
  loading: boolean;
  pending: boolean;
  failed: boolean;
}): boolean {
  if (state.loading || state.pending || state.failed || !state.preview)
    return false;
  return !generateSummary(state.preview).empty;
}
