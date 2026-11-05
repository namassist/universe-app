"use client";

import * as React from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";

import { fmt, useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/button";
import { Checkbox, ToggleRow } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { SearchInput } from "@/components/ui/search-input";

import {
  matchesUnitOption,
  moveItem,
  splitUnitPicks,
  toggleItem,
  type UnitOption,
} from "./display-unit-picks";

/**
 * A unit wall's picks (owner, 2026-11-05): the chosen units in screen order
 * above, every unit Fleet Setting offers below.
 *
 * The order list is always shown, not only on a monitor as the fleet picker
 * does, because on a unit wall the order *is* the layout: card one is top
 * left of the first slide. A pick Fleet Setting no longer offers stays in the
 * list, marked, so the admin sees why the wall lost a card; saving drops it.
 */
function DisplayUnitPicker({
  options,
  isPending,
  selected,
  onChange,
  error,
  knownCodes,
}: {
  options: UnitOption[] | undefined;
  isPending: boolean;
  selected: string[];
  onChange: (next: string[]) => void;
  error: boolean;
  /** Codes the saved wall already named, so a stale pick still has one. */
  knownCodes: ReadonlyMap<string, string>;
}) {
  const { t } = useI18n();
  const [query, setQuery] = React.useState("");
  const byId = new Map((options ?? []).map((o) => [o.id, o]));
  const stale = new Set(splitUnitPicks(selected, options).stale);
  const visible = (options ?? []).filter((o) => matchesUnitOption(o, query));

  const groupOf = (o: UnitOption) =>
    o.groupKind === "support"
      ? t.dspUnitSupport
      : fmt(t.cmFleetCode, { code: String(o.leaderCode) });
  const describe = (o: UnitOption) =>
    [o.modelName, groupOf(o), o.area].filter(Boolean).join(" · ");

  return (
    <Field
      label={
        <span className="flex w-full items-center gap-2">
          <span>{t.dspUnits}</span>
          <Badge variant={selected.length ? "info" : "neutral"}>
            {selected.length} {t.dspPicked}
          </Badge>
          {selected.length ? (
            <button
              type="button"
              onClick={() => onChange([])}
              className="ml-auto cursor-pointer text-xs font-normal text-(--text-tertiary) hover:text-(--text-primary)"
            >
              {t.dspClearSel}
            </button>
          ) : null}
        </span>
      }
      helper={t.dspUnitHelp}
      error={error}
      errorMessage={t.dspErrUnit}
    >
      <div className="flex flex-col gap-2">
        {selected.length ? (
          <ol
            aria-label={t.dspUnitOrder}
            className="flex max-h-52 flex-col gap-1 overflow-y-auto rounded-control border border-(--border-input) bg-(--fill-input) p-2"
          >
            {selected.map((id, pos) => {
              const unit = byId.get(id);
              const gone = stale.has(id);
              const code = unit?.code ?? knownCodes.get(id) ?? "—";
              return (
                <li
                  key={id}
                  className="flex min-w-0 items-center gap-1.5 rounded-md bg-[rgba(0,212,255,.08)] px-1.5 py-1"
                >
                  <span className="w-5 flex-none text-center font-mono text-xs text-(--text-tertiary) tabular-nums">
                    {pos + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    <span className="font-mono">{code}</span>
                    {unit ? (
                      <span className="text-(--text-tertiary)">
                        {` · ${describe(unit)}`}
                      </span>
                    ) : null}
                  </span>
                  {gone ? (
                    <Badge variant="warning">{t.dspUnitStale}</Badge>
                  ) : null}
                  <IconButton
                    type="button"
                    aria-label={fmt(t.dspUnitUp, { code })}
                    disabled={pos === 0}
                    onClick={() => onChange(moveItem(selected, id, -1))}
                  >
                    <ChevronUp />
                  </IconButton>
                  <IconButton
                    type="button"
                    aria-label={fmt(t.dspUnitDown, { code })}
                    disabled={pos === selected.length - 1}
                    onClick={() => onChange(moveItem(selected, id, 1))}
                  >
                    <ChevronDown />
                  </IconButton>
                  <IconButton
                    type="button"
                    danger
                    aria-label={fmt(t.dspUnitRemove, { code })}
                    onClick={() => onChange(toggleItem(selected, id))}
                  >
                    <X />
                  </IconButton>
                </li>
              );
            })}
          </ol>
        ) : null}

        <SearchInput
          className="w-full"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onClear={() => setQuery("")}
          placeholder={t.dspUnitSearch}
          aria-label={t.dspUnitSearch}
        />
        <div className="grid max-h-52 grid-cols-2 gap-1 overflow-y-auto rounded-control border border-(--border-input) bg-(--fill-input) p-2">
          {isPending ? (
            <p className="col-span-full px-1.5 py-2 text-xs text-(--text-tertiary) italic">
              {t.dspUnitLoading}
            </p>
          ) : visible.length === 0 ? (
            <p className="col-span-full px-1.5 py-2 text-xs text-(--text-tertiary) italic">
              {options?.length ? t.dspUnitNoMatch : t.dspUnitNone}
            </p>
          ) : (
            visible.map((o) => {
              const on = selected.includes(o.id);
              return (
                <ToggleRow
                  key={o.id}
                  className={cn(
                    "min-w-0 rounded-md px-1.5 py-1.5",
                    on && "bg-[rgba(0,212,255,.08)]"
                  )}
                >
                  <Checkbox
                    checked={on}
                    onChange={() => onChange(toggleItem(selected, o.id))}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-mono">{o.code}</span>
                    <span className="text-(--text-tertiary)">
                      {` · ${groupOf(o)}`}
                    </span>
                  </span>
                </ToggleRow>
              );
            })
          )}
        </div>
      </div>
    </Field>
  );
}

export { DisplayUnitPicker };
