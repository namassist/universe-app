"use client";

import { useQuery } from "@tanstack/react-query";

import { useI18n, type Dict } from "@/lib/i18n";
import {
  planHistoryQueryOptions,
  type PlanHistoryRow,
} from "@/lib/queries/fleet-allocation";
import { siteClock } from "@/lib/site-clock";
import { Avatar, initialsOf } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Drawer,
  DrawerClose,
  Timeline,
  TimelineItem,
} from "@/components/ui/drawer";

import { RosterBadge } from "./crew-table";
import { stBadge, type BoardUnit } from "./data";

const actionDot: Record<PlanHistoryRow["action"], string> = {
  assigned: "var(--color-success)",
  released: "var(--color-danger)",
};

/** "22 Sep 14:05" — the date matters here; a pairing can be months old. */
function whenOf(iso: string) {
  const date = new Date(iso).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${date} ${siteClock(iso)}`;
}

function howOf(t: Dict, row: PlanHistoryRow) {
  const source =
    row.source === "board"
      ? t.faHistSrcBoard
      : row.source === "import"
        ? t.faHistSrcImport
        : t.faHistSrcMigration;
  return row.actorName ? `${source} · ${t.faHistBy} ${row.actorName}` : source;
}

/**
 * A unit's standing-operator history, beside the card it belongs to.
 *
 * Built like the Unit Status drawer on purpose: the same slide-over and the
 * same timeline, so a second history reads the way the first one already does.
 * The current pairing heads it — the question is usually "who was here before
 * these two", and the answer only means something next to who is here now.
 */
export function PlanHistoryDrawer({
  unit,
  onClose,
}: {
  unit: BoardUnit | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const historyQ = useQuery({
    ...planHistoryQueryOptions(unit?.code ?? ""),
    enabled: !!unit,
  });
  const history = historyQ.data ?? [];

  return (
    <Drawer open={!!unit} onClose={onClose} labelledBy="fa-hist-t">
      {unit ? (
        <>
          <div className="mb-5 flex items-start justify-between gap-3">
            <div>
              <h3 id="fa-hist-t" className="text-xl font-semibold">
                {unit.code}
              </h3>
              <span className="font-mono text-xs text-(--text-tertiary)">
                {unit.brand}
              </span>
            </div>
            <DrawerClose onClick={onClose} aria-label={t.btnClose} />
          </div>
          <div className="mb-5">
            <Badge variant={stBadge[unit.status].variant} dot>
              {stBadge[unit.status].label}
            </Badge>
          </div>

          <h4 className="mb-3 text-xs font-semibold tracking-[.05em] text-(--text-tertiary) uppercase">
            {t.faHistCurrent}
          </h4>
          <div className="mb-6 flex flex-col gap-2">
            {unit.slots.length ? (
              unit.slots.map((s) => (
                <div
                  key={s.nik}
                  className="flex items-center gap-3 rounded-icon border border-(--divider) bg-(--fill-subtle) p-3"
                >
                  <Avatar className="text-xs">{initialsOf(s.name)}</Avatar>
                  <div className="min-w-0 flex-1">
                    <b className="block truncate text-[13px] font-semibold">
                      {s.name}
                    </b>
                    <span className="font-mono text-xs text-(--text-tertiary)">
                      {s.nik}
                    </span>
                  </div>
                  <RosterBadge t={t} code={s.rosterCode} />
                </div>
              ))
            ) : (
              <p className="text-sm text-(--text-tertiary)">{t.faNoOp}</p>
            )}
          </div>

          <h4 className="mb-4 text-xs font-semibold tracking-[.05em] text-(--text-tertiary) uppercase">
            {t.faHistTitle}
          </h4>
          {historyQ.isError ? (
            <p className="text-sm text-(--color-danger-text)">{t.faHistErr}</p>
          ) : history.length ? (
            <Timeline>
              {history.map((h) => (
                <TimelineItem
                  key={h.id}
                  dotColor={actionDot[h.action]}
                  when={whenOf(h.createdAt)}
                  what={
                    <>
                      {h.action === "assigned"
                        ? t.faHistAssigned
                        : t.faHistReleased}
                      {" — "}
                      {h.name}{" "}
                      <span className="font-mono text-xs font-normal text-(--text-tertiary)">
                        {h.nik}
                      </span>
                    </>
                  }
                  why={howOf(t, h)}
                />
              ))}
            </Timeline>
          ) : historyQ.isPending ? null : (
            <p className="text-sm text-(--text-tertiary)">{t.faHistEmpty}</p>
          )}
        </>
      ) : null}
    </Drawer>
  );
}
