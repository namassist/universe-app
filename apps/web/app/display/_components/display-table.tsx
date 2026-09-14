"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/* Panel tabel kiosk — header pinned, isi auto-scroll (baris diduplikasi untuk
   loop mulus; durasi 4 dtk per baris). Font 28px untuk jarak ±6 m. */

export type DisplayTone = "success" | "warning" | "danger" | "info" | "neutral";

export function DisplayBadge({
  tone,
  size = "md",
  className,
  children,
}: {
  tone: DisplayTone;
  /**
   * `sm` for the card wall, where two badges share a block and the words are
   * savera's own — long ones like "Istirahat Minimal 2 Jam". The table's rows
   * give a badge a column to itself and keep `md`.
   */
  size?: "md" | "sm";
  className?: string;
  children: React.ReactNode;
}) {
  const styles: Record<DisplayTone, string> = {
    success:
      "text-(--badge-success-text) bg-(--badge-success-fill) border-(--badge-success-border)",
    warning:
      "text-(--badge-warning-text) bg-(--badge-warning-fill) border-(--badge-warning-border)",
    danger:
      "text-(--badge-danger-text) bg-(--badge-danger-fill) border-(--badge-danger-border)",
    info: "text-(--color-primary-bright) bg-[rgba(0,212,255,.12)] border-[rgba(0,212,255,.4)]",
    neutral:
      "text-(--badge-neutral-text) bg-(--badge-neutral-fill) border-(--badge-neutral-border)",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border-[1.5px] font-semibold whitespace-nowrap",
        size === "sm"
          ? "gap-2 px-3.5 py-1 text-[17px]"
          : "gap-3 px-5.5 py-2 text-2xl",
        styles[tone],
        className
      )}
    >
      <span
        className={cn(
          "flex-none rounded-full bg-current",
          size === "sm" ? "size-2" : "size-3"
        )}
      />
      {children}
    </span>
  );
}

export type DisplayCol = { label: string; width?: string };

const thClass =
  "bg-[linear-gradient(90deg,rgba(37,99,235,.4),rgba(0,84,199,.3))] px-6 py-3.5 text-left text-[22px] font-semibold tracking-[.05em] whitespace-nowrap uppercase first:rounded-l-[14px] last:rounded-r-[14px]";

/**
 * How urgent a row is, as a wash behind it and a bar down its left edge.
 *
 * The tone is the row's own badge, not a second judgement: a yellow badge over
 * a red row would be the wall disagreeing with itself from six metres away,
 * which is the distance these are read from. `success` is deliberately absent
 * — the rows that need nothing doing should be the quiet ones.
 */
export type RowTone = "danger" | "warning";

const ROW_TONE: Record<RowTone, string> = {
  danger:
    "[&>td]:bg-(--wall-danger-wash) [&>td:first-child]:shadow-[inset_4px_0_0_var(--color-danger)]",
  warning:
    "[&>td]:bg-(--wall-warning-wash) [&>td:first-child]:shadow-[inset_4px_0_0_var(--badge-warning-text)]",
};

export function DisplayTable({
  cols,
  rows,
}: {
  cols: DisplayCol[];
  rows: { key: string; tone?: RowTone; cells: React.ReactNode[] }[];
}) {
  const renderBody = () =>
    rows.map((r, dup) => (
      <tr key={`${r.key}-${dup}`} className={cn(r.tone && ROW_TONE[r.tone])}>
        {r.cells.map((c, i) => (
          <td
            key={i}
            style={{ width: cols[i]?.width }}
            className="border-b border-[rgba(255,255,255,.08)] px-6 py-3.5"
          >
            {c}
          </td>
        ))}
      </tr>
    ));

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-panel px-9 py-8 glass-panel">
      <table className="w-full flex-none border-collapse text-[28px]">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.label} style={{ width: c.width }} className={thClass}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
      </table>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div
          className="display-scroller [animation:kscroll_var(--kscroll-dur,30s)_linear_infinite]"
          style={
            { "--kscroll-dur": `${rows.length * 4}s` } as React.CSSProperties
          }
        >
          <table className="w-full border-collapse text-[28px]">
            {/* isi digandakan agar loop scroll mulus — header tetap pinned */}
            <tbody>{renderBody()}</tbody>
            <tbody>{renderBody()}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
