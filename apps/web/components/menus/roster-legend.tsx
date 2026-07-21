"use client";

import { useI18n } from "@/lib/i18n";
import { legendGroupsFor } from "@/lib/roster-data";
import { Panel, Toolbar, ToolbarTitle } from "@/components/ui/panel";

/** Panel legenda kode roster — dipakai halaman upload & detail dokumen. */
export function RosterLegend() {
  const { t, lang } = useI18n();
  const legendGroups = legendGroupsFor(lang);
  return (
    <Panel>
      <Toolbar className="mb-4">
        <ToolbarTitle>{t.legendTitle}</ToolbarTitle>
        <span className="text-xs text-(--text-tertiary)">{t.legendNote}</span>
      </Toolbar>
      {legendGroups.map((g, gi) => (
        <div key={g.label}>
          <div
            className={`mb-2 text-xs font-semibold tracking-[.05em] text-(--text-tertiary) uppercase ${gi === 0 ? "" : "mt-4"}`}
          >
            {g.label}
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-2">
            {g.codes.map((c) => (
              <div
                key={c.k}
                className="flex items-center gap-2 rounded-lg border border-(--divider) bg-(--fill-subtle) px-2 py-1.5 text-xs text-(--text-secondary)"
              >
                <b className="min-w-[38px] flex-none rounded-md border border-[rgba(0,212,255,.3)] bg-[rgba(0,212,255,.12)] px-1 py-[3px] text-center font-mono text-[11px] font-bold text-(--color-primary-bright)">
                  {c.k}
                </b>
                {c.v}
              </div>
            ))}
          </div>
        </div>
      ))}
    </Panel>
  );
}
