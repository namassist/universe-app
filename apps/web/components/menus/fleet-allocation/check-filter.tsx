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
/**
 * How many options it takes before the popover offers a search box.
 *
 * Above this a list scrolls and scanning it is the cost being removed; at or
 * below it every option is on screen already.
 */
const SEARCH_FROM = 8;

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
  const [q, setQ] = React.useState("");

  if (!options.length) return null;

  const toggle = (v: string) =>
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);

  /*
   * Searchable only once the list is longer than the eye can take in.
   *
   * A SIMPER filter carries dozens of codes and scrolling for one is the whole
   * complaint; a verdict filter carries three, and a search box above three
   * checkboxes is furniture that makes the short list look like the long one.
   */
  const searchable = options.length > SEARCH_FROM;
  const needle = q.trim().toLowerCase();
  const shown =
    searchable && needle
      ? options.filter(
          (option) =>
            option.label.toLowerCase().includes(needle) ||
            option.value.toLowerCase().includes(needle)
        )
      : options;

  /* Closing forgets the search but keeps the ticks: the query was how somebody
     found an option, not part of what they chose, and leaving it set would
     reopen the menu already hiding most of it. */
  const close = () => {
    setOpen(false);
    setQ("");
  };

  return (
    <div className={cn("relative", className)}>
      <Button
        type="button"
        variant="secondary"
        className="h-10 w-full justify-between"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
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
            className="fixed inset-0 z-70 cursor-default"
            onClick={close}
          />
          {/* The same surface every other floating panel here uses — see
              `DropMenu`. It was `bg-(--fill-raised)`, a token this design
              system does not define, so the panel painted no background at
              all and the table read straight through it. An undefined custom
              property fails silently in CSS: nothing warns, the rule is just
              dropped. `--overlay-fill` is the one that exists, and it is
              near-opaque in both themes. */}
          {/* A column, not one scrolling block: the search and the clear are
              the two controls somebody reaches for *while* scrolling, and
              inside the scroller they leave the screen exactly when they are
              wanted. Only the options move. */}
          <div className="absolute right-0 z-80 mt-1 flex max-h-72 w-56 flex-col rounded-icon border border-(--glass-2-border) bg-(--overlay-fill) p-1.5 shadow-(--shadow-modal)">
            {searchable ? (
              <input
                type="text"
                /* Focused on open, because opening this menu at all is the
                   start of looking for something. */
                autoFocus
                placeholder={t.faSkillSearch}
                aria-label={t.faSkillSearch}
                value={q}
                onChange={(event) => setQ(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") close();
                }}
                className="mb-1 w-full rounded-lg border border-(--border-input) bg-(--fill-input) px-2 py-1.5 text-sm placeholder:text-(--text-tertiary) focus:border-(--color-primary-bright) focus:outline-none"
              />
            ) : null}
            {value.length ? (
              <button
                type="button"
                onClick={() => onChange([])}
                className="mb-1 w-full cursor-pointer rounded-lg px-2 py-1 text-left text-xs text-(--text-tertiary) hover:text-(--text-primary)"
              >
                {t.faSkillClear}
              </button>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {shown.map((option) => (
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
              {/* Said rather than left blank: an empty panel under a search box
                  reads as a broken filter, and the ticks that are still in
                  force are not visible to contradict it. */}
              {!shown.length ? (
                <p className="px-2 py-3 text-center text-xs text-(--text-tertiary)">
                  {t.faSkillNoMatch}
                </p>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
