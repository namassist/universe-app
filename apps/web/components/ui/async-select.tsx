"use client";

import * as React from "react";
import { ChevronDown, Search } from "lucide-react";

import { cn } from "@/lib/utils";

import { Spinner } from "./button";
import { ctrlClass } from "./input";

export type AsyncOption<T = unknown> = {
  value: string;
  label: string;
  sub?: string;
  row?: T;
};

/* Combobox ber-search server (ADR 0051 fase B) — opsi diambil dari endpoint
   list saat dropdown dibuka/diketik, bukan dari store global. Nilai tersimpan
   yang tak lagi ada di sumber tetap tampil sebagai teks kontrol. */
function AsyncSelect<T = unknown>({
  id,
  value,
  valueLabel,
  onChange,
  load,
  placeholder = "—",
  searchPlaceholder,
  emptyText,
  clearLabel,
  disabled,
  ariaLabel,
  wrapperClassName,
  className,
}: {
  id?: string;
  value: string;
  /** label kontrol untuk nilai terpilih; default = value itu sendiri */
  valueLabel?: string;
  onChange: (opt: AsyncOption<T> | null) => void;
  /** pengambil opsi dari server; identitas boleh berubah tiap render */
  load: (search: string) => Promise<AsyncOption<T>[]>;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /** bila diisi, baris teratas mengosongkan pilihan (onChange(null)) */
  clearLabel?: string;
  disabled?: boolean;
  ariaLabel?: string;
  wrapperClassName?: string;
  className?: string;
}) {
  const listId = React.useId();
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [opts, setOpts] = React.useState<AsyncOption<T>[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [hi, setHi] = React.useState(0);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const seqRef = React.useRef(0);
  /* identitas load boleh berubah tiap render — simpan yang terbaru di ref
     agar effect fetch cukup bergantung pada (open, q) */
  const loadRef = React.useRef(load);
  React.useEffect(() => {
    loadRef.current = load;
  }, [load]);

  /* klik di luar menutup (Escape ditangani di input) */
  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [open]);

  /* fetch server: langsung saat dibuka, di-debounce saat mengetik; seq
     menjaga balasan lambat tidak menimpa hasil ketikan terbaru;
     setLoading di dalam timeout (pola halaman list ADR 0036) */
  React.useEffect(() => {
    if (!open) return;
    const seq = ++seqRef.current;
    const timer = setTimeout(
      () => {
        setLoading(true);
        loadRef
          .current(q.trim())
          .then((r) => {
            if (seqRef.current !== seq) return;
            setOpts(r);
            setHi(0);
            setLoading(false);
          })
          .catch(() => {
            if (seqRef.current !== seq) return;
            setOpts([]);
            setLoading(false);
          });
      },
      q ? 250 : 0
    );
    return () => clearTimeout(timer);
  }, [open, q]);

  React.useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function openUp() {
    setQ("");
    setOpts([]);
    setOpen(true);
  }
  function pick(opt: AsyncOption<T> | null) {
    onChange(opt);
    setOpen(false);
  }
  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") setOpen(false);
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi((i) => Math.min(i + 1, opts.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (opts[hi]) pick(opts[hi]);
    }
  }

  return (
    <div ref={wrapRef} className={cn("relative w-full", wrapperClassName)}>
      {/* data-slot="select" agar styling error Field ikut berlaku */}
      <button
        type="button"
        id={id}
        data-slot="select"
        disabled={disabled}
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        onClick={() => (open ? setOpen(false) : openUp())}
        className={cn(
          ctrlClass,
          "flex cursor-pointer items-center justify-between gap-2 text-left",
          className
        )}
      >
        <span className={cn("truncate", !value && "text-(--text-tertiary)")}>
          {value ? (valueLabel ?? value) : placeholder}
        </span>
        <ChevronDown className="size-[15px] flex-none text-(--text-secondary)" />
      </button>
      {open ? (
        <div className="absolute top-[calc(100%+6px)] left-0 z-80 w-full min-w-55 rounded-icon border border-(--glass-2-border) bg-(--overlay-fill) p-2 shadow-(--shadow-modal)">
          <div className="flex h-9 items-center gap-2 rounded-control border border-(--border-input) bg-(--fill-input) px-2.5">
            <Search className="size-[14px] flex-none text-(--text-tertiary)" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onKey}
              placeholder={searchPlaceholder ?? "Cari…"}
              aria-autocomplete="list"
              className="min-w-0 flex-1 border-none bg-transparent text-sm tracking-(--tracking-brand) text-(--text-primary) outline-none placeholder:text-(--text-tertiary)"
            />
            {loading ? <Spinner /> : null}
          </div>
          <ul
            id={listId}
            role="listbox"
            className="mt-1.5 flex max-h-56 list-none flex-col overflow-y-auto p-0"
          >
            {clearLabel ? (
              <li>
                <button
                  type="button"
                  role="option"
                  aria-selected={!value}
                  onClick={() => pick(null)}
                  className="flex h-9 w-full cursor-pointer items-center rounded-lg px-3 text-left text-[13px] font-medium tracking-(--tracking-brand) text-(--text-tertiary) hover:bg-(--fill-hover) hover:text-(--text-primary)"
                >
                  {clearLabel}
                </button>
              </li>
            ) : null}
            {opts.map((o, i) => (
              <li key={o.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  onMouseEnter={() => setHi(i)}
                  onClick={() => pick(o)}
                  className={cn(
                    "flex h-9 w-full cursor-pointer items-center gap-2 rounded-lg px-3 text-left text-[13px] font-medium tracking-(--tracking-brand)",
                    i === hi
                      ? "bg-(--fill-hover) text-(--text-primary)"
                      : "text-(--text-secondary)",
                    o.value === value && "text-(--color-primary-bright)"
                  )}
                >
                  <span className="truncate">{o.label}</span>
                  {o.sub ? (
                    <span className="ml-auto flex-none font-mono text-xs text-(--text-tertiary)">
                      {o.sub}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
            {!loading && !opts.length ? (
              <li className="px-3 py-2 text-[13px] text-(--text-tertiary)">
                {emptyText ?? "Tidak ada hasil"}
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export { AsyncSelect };
