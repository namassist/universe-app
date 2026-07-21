"use client";

import * as React from "react";
import { BellOff, CheckCheck } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import {
  notifStore,
  notifToneDot,
  useNotifs,
  type Notif,
} from "@/lib/notifications-data";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Pagination, usePagination } from "@/components/ui/pagination";
import {
  FootSum,
  PageTitle,
  Panel,
  PanelFoot,
  Toolbar,
  ToolbarGroup,
  ToolbarTitle,
} from "@/components/ui/panel";
import { SearchInput } from "@/components/ui/search-input";
import { Segmented, SegmentedButton } from "@/components/ui/segmented";
import { StateBox } from "@/components/ui/state-box";
import { useToast } from "@/components/ui/toast";

type ReadFilter = "" | "unread" | "read";

export function NotificationsPage() {
  const { t, lang } = useI18n();
  const { pushToast } = useToast();
  const notifs = useNotifs();
  const [q, setQ] = React.useState("");
  const [fRead, setFRead] = React.useState<ReadFilter>("");

  const unread = notifs.filter((n) => !n.read).length;
  const filtered = notifs.filter((n) => {
    if (fRead === "unread" && n.read) return false;
    if (fRead === "read" && !n.read) return false;
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return (
      n.textId.toLowerCase().includes(s) || n.textEn.toLowerCase().includes(s)
    );
  });
  const pg = usePagination(filtered, "10");

  function markAll() {
    notifStore.readAll();
    pushToast("success", t.ntfMarkedT);
  }
  function markOne(n: Notif) {
    if (n.read) return;
    notifStore.read(n.id);
  }

  const readFilters: { key: ReadFilter; label: string }[] = [
    { key: "", label: t.ntfFAll },
    { key: "unread", label: t.ntfFUnread },
    { key: "read", label: t.ntfFRead },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={t.notifTitle} sub={t.ntfSub}>
        <Button onClick={markAll} disabled={unread === 0}>
          <CheckCheck />
          {t.markRead}
        </Button>
      </PageTitle>

      <Panel>
        <Toolbar>
          <ToolbarTitle>{t.ntfListT}</ToolbarTitle>
          <ToolbarGroup>
            <SearchInput
              className="w-[240px]"
              placeholder={t.ntfSearchPh}
              aria-label={t.ntfSearchPh}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onClear={() => setQ("")}
            />
            <Segmented role="group" aria-label={t.ntfListT}>
              {readFilters.map((f) => (
                <SegmentedButton
                  key={f.key}
                  active={fRead === f.key}
                  onClick={() => setFRead(f.key)}
                >
                  {f.label}
                </SegmentedButton>
              ))}
            </Segmented>
          </ToolbarGroup>
        </Toolbar>

        {pg.rows.length === 0 ? (
          <StateBox
            icon={<BellOff className="text-(--text-tertiary)" />}
            title={t.ntfEmptyT}
            body={t.ntfEmptyB}
          />
        ) : (
          <div className="flex flex-col divide-y divide-(--divider)">
            {pg.rows.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => markOne(n)}
                className={cn(
                  "flex items-start gap-3 rounded-lg px-3 py-3.5 text-left hover:bg-(--fill-hover)",
                  !n.read && "cursor-pointer bg-(--fill-subtle)"
                )}
              >
                <span
                  className={cn(
                    "mt-1.5 size-2 flex-none rounded-full",
                    n.read ? "bg-(--text-disabled)" : notifToneDot[n.tone]
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block text-sm leading-normal",
                      n.read
                        ? "text-(--text-secondary)"
                        : "font-semibold text-(--text-primary)"
                    )}
                  >
                    {lang === "id" ? n.textId : n.textEn}
                  </span>
                  <span className="mt-0.5 block text-xs text-(--text-tertiary)">
                    {lang === "id" ? n.timeId : n.timeEn}
                  </span>
                </span>
                {!n.read ? (
                  <span className="mt-1 flex-none rounded-chip border border-[rgba(0,212,255,.4)] bg-[rgba(0,212,255,.12)] px-2 py-0.5 text-[11px] font-semibold text-primary-bright">
                    {t.ntfFUnread}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        )}

        <PanelFoot>
          <FootSum>
            {t.attSumA} <b>{pg.range}</b> {t.attSumB} <b>{pg.total}</b>{" "}
            {t.ntfSumN}
          </FootSum>
          <Pagination
            page={pg.page}
            pageCount={pg.pageCount}
            onPage={pg.setPage}
            per={pg.per}
            perOptions={["10", "20", "50"]}
            onPer={pg.setPer}
          />
        </PanelFoot>
      </Panel>
    </div>
  );
}
