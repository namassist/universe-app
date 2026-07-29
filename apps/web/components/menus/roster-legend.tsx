"use client";

import { ROSTER_LEGEND_GROUPS } from "@universe/contracts";

import { useI18n } from "@/lib/i18n";
import { legendGroupLabel, rosterCodeLabel } from "@/lib/roster-data";
import { Panel, Toolbar, ToolbarTitle } from "@/components/ui/panel";

/**
 * The roster legend — used by the upload and detail screens.
 *
 * The grouping and its order come from `@universe/contracts`, which is also
 * what the database enum and the API schema are generated from, so a code
 * cannot appear in one and be missing from the other. Only the words are local:
 * they are translated, and translation is this app's job.
 */
export function RosterLegend() {
  const { t } = useI18n();
  return (
    <Panel>
      <Toolbar className="mb-4">
        <ToolbarTitle>{t.legendTitle}</ToolbarTitle>
        <span className="text-xs text-(--text-tertiary)">{t.legendNote}</span>
      </Toolbar>
      {ROSTER_LEGEND_GROUPS.map((g, gi) => (
        <div key={g.id}>
          <div
            className={`mb-2 text-xs font-semibold tracking-[.05em] text-(--text-tertiary) uppercase ${gi === 0 ? "" : "mt-4"}`}
          >
            {legendGroupLabel(t, g.id)}
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-2">
            {g.codes.map((code) => (
              <div
                key={code}
                className="flex items-center gap-2 rounded-lg border border-(--divider) bg-(--fill-subtle) px-2 py-1.5 text-xs text-(--text-secondary)"
              >
                <b className="min-w-[38px] flex-none rounded-md border border-[rgba(0,212,255,.3)] bg-[rgba(0,212,255,.12)] px-1 py-[3px] text-center font-mono text-[11px] font-bold text-(--color-primary-bright)">
                  {code}
                </b>
                {rosterCodeLabel(t, code)}
              </div>
            ))}
          </div>
        </div>
      ))}
    </Panel>
  );
}
