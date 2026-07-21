"use client";

import * as React from "react";

import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { Select } from "./select";

/* Tombol halaman (pg) */
function PageButton({
  className,
  active,
  ...props
}: React.ComponentProps<"button"> & { active?: boolean }) {
  return (
    <button
      data-slot="page-button"
      className={cn(
        "grid h-9 min-w-9 cursor-pointer place-items-center rounded-control border px-1.5 text-[13px] tracking-(--tracking-brand) transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:bg-[rgba(255,255,255,.02)] disabled:text-(--text-disabled)",
        active
          ? "border-transparent bg-(image:--gradient-cta) font-bold text-on-cta shadow-[0_4px_14px_rgba(0,212,255,.3)]"
          : "border-(--glass-1-border) bg-(--fill-subtle) text-(--text-secondary) hover:enabled:bg-(--fill-hover-strong) hover:enabled:text-(--text-primary)",
        className
      )}
      {...props}
    />
  );
}

/* State pagination standar untuk tabel daftar — slice + rentang + reset saat
   ganti baris-per-halaman; halaman otomatis ter-clamp bila daftar menyusut */
function usePagination<T>(items: T[], defaultPer = "10") {
  const [page, setPage] = React.useState(1);
  const [per, setPerState] = React.useState(defaultPer);
  const perN = Math.max(1, Number(per));
  const pageCount = Math.max(1, Math.ceil(items.length / perN));
  const p = Math.min(page, pageCount);
  const rows = items.slice((p - 1) * perN, p * perN);
  const range = items.length
    ? `${(p - 1) * perN + 1}–${Math.min(items.length, p * perN)}`
    : "0";
  const setPer = (v: string) => {
    setPerState(v);
    setPage(1);
  };
  return {
    page: p,
    setPage,
    per,
    setPer,
    pageCount,
    rows,
    range,
    total: items.length,
  };
}

/* Kontrol lengkap footer tabel: baris-per-halaman + navigasi halaman */
function Pagination({
  page,
  pageCount,
  onPage,
  per,
  perOptions,
  onPer,
  className,
}: {
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
  per: string;
  perOptions: string[];
  onPer: (per: string) => void;
  className?: string;
}) {
  const { t } = useI18n();
  /* jendela nomor halaman: 1 … (p-1) p (p+1) … N — daftar panjang tidak
     merender ratusan tombol */
  const count = Math.max(1, pageCount);
  let pages: (number | "…")[];
  if (count <= 7) {
    pages = Array.from({ length: count }, (_, i) => i + 1);
  } else {
    const anchors = Array.from(
      new Set(
        [1, 2, page - 1, page, page + 1, count - 1, count].filter(
          (n) => n >= 1 && n <= count
        )
      )
    ).sort((a, b) => a - b);
    pages = [];
    let prev = 0;
    for (const n of anchors) {
      if (n - prev > 1) pages.push("…");
      pages.push(n);
      prev = n;
    }
  }
  return (
    <div className={cn("flex items-center gap-5", className)}>
      <div className="flex items-center gap-2 text-xs text-(--text-tertiary)">
        {t.rppLabel}
        <Select
          value={per}
          onChange={(e) => onPer(e.target.value)}
          aria-label={t.rppLabel}
          wrapperClassName="w-auto"
          className="h-8 w-auto rounded-lg px-2 pr-8"
        >
          {perOptions.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex items-center gap-2">
        <PageButton
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          aria-label={t.pgPrev}
        >
          ‹
        </PageButton>
        {pages.map((n, i) =>
          n === "…" ? (
            <span
              key={`gap-${i}`}
              className="grid h-9 min-w-9 place-items-center text-[13px] text-(--text-tertiary)"
              aria-hidden
            >
              …
            </span>
          ) : (
            <PageButton key={n} active={n === page} onClick={() => onPage(n)}>
              {n}
            </PageButton>
          )
        )}
        <PageButton
          onClick={() => onPage(page + 1)}
          disabled={page >= pageCount}
          aria-label={t.pgNext}
        >
          ›
        </PageButton>
      </div>
    </div>
  );
}

export { Pagination, PageButton, usePagination };
