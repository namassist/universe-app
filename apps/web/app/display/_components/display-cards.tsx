"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A scrolling list of cards, where a table would squeeze.
 *
 * The fit-to-work wall outgrew `DisplayTable`: seven columns on one line meant
 * "Yohanes Novensius Wangge" wrapping to three rows while "Istirahat Minimal 2
 * Jam" was cut off at the edge, and at six metres a reader lost which line
 * belonged to whom. A card gives each person a block of their own and lets the
 * long values run — the name across the top, the verdict in the middle, the
 * upload clock pinned right.
 *
 * The scroll machinery is the table's: the list is rendered twice and the
 * whole stack translated by half its height, so the loop has no seam. Four
 * seconds a card, which is the reading speed the tables were tuned to — and
 * the shorter the card, the more of them stand on the glass at once.
 */

export type CardTone = "danger" | "warning";

const EDGE: Record<CardTone, string> = {
  danger:
    "border-(--badge-danger-border) bg-[linear-gradient(90deg,var(--wall-danger-wash),transparent_70%)] before:bg-(--color-danger)",
  warning:
    "border-(--badge-warning-border) bg-[linear-gradient(90deg,var(--wall-warning-wash),transparent_70%)] before:bg-(--badge-warning-text)",
};

/** The small round mark at the head of a card — urgency before any reading. */
const MARK: Record<CardTone, string> = {
  danger:
    "border-(--badge-danger-border) bg-(--badge-danger-fill) text-(--badge-danger-text)",
  warning:
    "border-(--badge-warning-border) bg-(--badge-warning-fill) text-(--badge-warning-text)",
};

export type DisplayCardItem = {
  key: string;
  tone: CardTone;
  /** One character inside the round mark: "!" for urgent, "~" for a wait. */
  mark: string;
  cells: React.ReactNode[];
};

/**
 * A labelled block inside a card.
 *
 * The eyebrow is what makes a card readable without a header row: the table
 * carried its column names once at the top and every row below depended on
 * them, which is exactly what broke when the rows scrolled past it.
 */
export function CardField({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="text-[12px] font-semibold tracking-[.12em] text-(--text-tertiary) uppercase">
        {label}
      </span>
      {children}
    </div>
  );
}

export function DisplayCards({ items }: { items: DisplayCardItem[] }) {
  const renderList = () =>
    items.map((item, dup) => (
      <article
        key={`${item.key}-${dup}`}
        className={cn(
          /* The bar is a pseudo-element rather than a border so the card keeps
             one radius: a coloured left border would square that corner off. */
          "relative flex items-center gap-5 overflow-hidden rounded-card border px-6 py-4",
          "before:absolute before:inset-y-0 before:left-0 before:w-1.5 before:content-['']",
          EDGE[item.tone]
        )}
      >
        <span
          className={cn(
            "flex size-10 flex-none items-center justify-center rounded-full border-2 text-2xl font-bold",
            MARK[item.tone]
          )}
          aria-hidden
        >
          {item.mark}
        </span>
        {item.cells}
      </article>
    ));

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-panel px-7 py-6 glass-panel">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div
          className="display-scroller [animation:kscroll_var(--kscroll-dur,30s)_linear_infinite]"
          style={
            { "--kscroll-dur": `${items.length * 4}s` } as React.CSSProperties
          }
        >
          {/* Duplicated for the seamless loop, exactly as the table does it. */}
          <div className="flex flex-col gap-3">{renderList()}</div>
          <div className="mt-3 flex flex-col gap-3">{renderList()}</div>
        </div>
      </div>
    </div>
  );
}
