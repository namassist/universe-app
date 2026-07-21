"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/* Panel tabel kiosk — header pinned, isi auto-scroll (baris diduplikasi untuk
   loop mulus; durasi 4 dtk per baris). Font 28px untuk jarak ±6 m. */

export type DisplayTone = "success" | "warning" | "danger" | "info" | "neutral";

export function DisplayBadge({
  tone,
  className,
  children,
}: {
  tone: DisplayTone;
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
        "inline-flex items-center gap-3 rounded-full border-[1.5px] px-5.5 py-2 text-2xl font-semibold whitespace-nowrap",
        styles[tone],
        className
      )}
    >
      <span className="size-3 flex-none rounded-full bg-current" />
      {children}
    </span>
  );
}

export type DisplayCol = { label: string; width?: string };

const thClass =
  "bg-[linear-gradient(90deg,rgba(37,99,235,.4),rgba(0,84,199,.3))] px-6 py-3.5 text-left text-[22px] font-semibold tracking-[.05em] whitespace-nowrap uppercase first:rounded-l-[14px] last:rounded-r-[14px]";

export function DisplayTable({
  cols,
  rows,
}: {
  cols: DisplayCol[];
  rows: { key: string; danger?: boolean; cells: React.ReactNode[] }[];
}) {
  const renderBody = () =>
    rows.map((r, dup) => (
      <tr
        key={`${r.key}-${dup}`}
        className={cn(
          r.danger &&
            "[&>td]:bg-[rgba(252,60,59,.1)] [&>td:first-child]:shadow-[inset_4px_0_0_var(--color-danger)]"
        )}
      >
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
