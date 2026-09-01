"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

/**
 * A filter over a set of values, as a popover of checkboxes.
 *
 * Not a `<select multiple>`: the native control needs ctrl-click to add a
 * second value — which nobody discovers — and cannot say how many are ticked
 * while it is closed, which is the one thing a filter has to say from across
 * the toolbar.
 *
 * Empty means no restriction, never "match nothing". A filter that hid
 * everything the moment it was opened and nothing ticked would read as a bug.
 */
export function CheckFilter({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  /** Only what the data actually holds — offering more would be lying. */
  options: { value: string; label: string }[];
  value: string[];
  onChange: (next: string[]) => void;
  /** Sizing from the toolbar that owns the row. */
  className?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = React.useState(false);

  if (!options.length) return null;

  const toggle = (v: string) =>
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);

  return (
    <div className={cn("relative", className)}>
      <Button
        type="button"
        variant="secondary"
        className="h-10 w-full justify-between"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        {value.length ? <Badge variant="info">{value.length}</Badge> : null}
        <ChevronDown className="size-4" />
      </Button>
      {open ? (
        <>
          {/* Click-away, so it closes the way every other popover here does. */}
          <button
            type="button"
            aria-label={t.btnClose}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 z-20 mt-1 max-h-72 w-56 overflow-y-auto rounded-control border border-(--divider) bg-(--fill-raised) p-1.5 shadow-lg">
            {value.length ? (
              <button
                type="button"
                onClick={() => onChange([])}
                className="mb-1 w-full cursor-pointer rounded-lg px-2 py-1 text-left text-xs text-(--text-tertiary) hover:text-(--text-primary)"
              >
                {t.faSkillClear}
              </button>
            ) : null}
            {options.map((option) => (
              <label
                key={option.value}
                className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-(--fill-hover)"
              >
                <Checkbox
                  checked={value.includes(option.value)}
                  onChange={() => toggle(option.value)}
                />
                <span className="min-w-0 flex-1 truncate text-sm">
                  {option.label}
                </span>
              </label>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
