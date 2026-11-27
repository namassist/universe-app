"use client";

import * as React from "react";
import { ChevronDown, Search } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { Badge } from "./badge";
import { Spinner } from "./button";
import { ctrlClass } from "./input";

export type AsyncOption<T = unknown> = {
  value: string;
  label: string;
  sub?: string;
  /** baris kedua di bawah label — hanya AsyncSuggest yang menampilkannya */
  detail?: string;
  /** penanda kecil di kanan (badge warning) — hanya AsyncSuggest */
  tag?: string;
  row?: T;
};

/* Panel dropdown yang dipakai bersama AsyncSelect dan AsyncSuggest. */
const popClass =
  "absolute top-[calc(100%+6px)] left-0 z-80 w-full min-w-55 rounded-icon border border-(--glass-2-border) bg-(--overlay-fill) p-2 shadow-(--shadow-modal)";

/* Combobox ber-search server (ADR 0051 fase B) — opsi diambil dari endpoint
   list saat dropdown dibuka/diketik, bukan dari store global. Nilai tersimpan
   yang tak lagi ada di sumber tetap tampil sebagai teks kontrol.
   Dengan `options` alih-alih `load`, daftarnya sudah ada di halaman: disaring
   di tempat (substring label/sub), tanpa debounce dan tanpa request. */
function AsyncSelect<T = unknown>({
  id,
  value,
  valueLabel,
  onChange,
  load,
  options,
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
  load?: (search: string) => Promise<AsyncOption<T>[]>;
  /** opsi lokal — dipakai bila `load` tidak diisi */
  options?: AsyncOption<T>[];
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
  const { t } = useI18n();
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
    if (!open || !loadRef.current) return;
    const seq = ++seqRef.current;
    const timer = setTimeout(
      () => {
        setLoading(true);
        loadRef.current!(q.trim())
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

  /* lokal: disaring saat render, bukan disalin ke state lewat effect */
  const local = !load && options !== undefined;
  const needle = q.trim().toLowerCase();
  const shown: AsyncOption<T>[] = local
    ? needle
      ? options.filter(
          (o) =>
            o.label.toLowerCase().includes(needle) ||
            Boolean(o.sub?.toLowerCase().includes(needle))
        )
      : options
    : opts;
  const label =
    valueLabel ??
    (local ? options.find((o) => o.value === value)?.label : undefined);

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
      setHi((i) => Math.min(i + 1, shown.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (shown[hi]) pick(shown[hi]);
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
          {value ? (label ?? value) : placeholder}
        </span>
        <ChevronDown className="size-[15px] flex-none text-(--text-secondary)" />
      </button>
      {open ? (
        <div className={popClass}>
          <div className="flex h-9 items-center gap-2 rounded-control border border-(--border-input) bg-(--fill-input) px-2.5">
            <Search className="size-[14px] flex-none text-(--text-tertiary)" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                if (local) setHi(0);
              }}
              onKeyDown={onKey}
              placeholder={searchPlaceholder ?? t.uiSearch}
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
            {shown.map((o, i) => (
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
            {!loading && !shown.length ? (
              <li className="px-3 py-2 text-[13px] text-(--text-tertiary)">
                {emptyText ?? t.uiNoResults}
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/* Input teks bebas yang menawarkan saran dari server saat diketik (ketik
   minimal `minChars` karakter). ↑ ↓ menyorot, Enter atau klik mengambil, Esc
   menutup tanpa menutup dialog di belakangnya. Nilainya tetap bebas: saran
   hanya jalan pintas, mengetik sampai habis tetap sah. Daftar kosong tidak
   ditampilkan sama sekali — tidak ada "tidak ditemukan" yang mengganggu
   orang yang memang sedang mengetik nilai baru. */
function AsyncSuggest<T = unknown>({
  id,
  value,
  onChange,
  load,
  onPick,
  minChars = 2,
  type = "text",
  placeholder,
  ariaLabel,
  wrapperClassName,
  className,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  /** pengambil saran dari server; identitas boleh berubah tiap render */
  load: (search: string) => Promise<AsyncOption<T>[]>;
  onPick: (opt: AsyncOption<T>) => void;
  minChars?: number;
  type?: "text" | "email";
  placeholder?: string;
  ariaLabel?: string;
  wrapperClassName?: string;
  className?: string;
}) {
  const listId = React.useId();
  const [open, setOpen] = React.useState(false);
  const [opts, setOpts] = React.useState<AsyncOption<T>[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [hi, setHi] = React.useState(-1);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const seqRef = React.useRef(0);
  const loadRef = React.useRef(load);
  React.useEffect(() => {
    loadRef.current = load;
  }, [load]);

  const q = value.trim();
  const active = open && q.length >= minChars;

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [open]);

  /* di-debounce; seq menjaga balasan lambat tidak menimpa ketikan terbaru */
  React.useEffect(() => {
    if (!active) return;
    const seq = ++seqRef.current;
    const timer = setTimeout(() => {
      setLoading(true);
      loadRef
        .current(q)
        .then((r) => {
          if (seqRef.current !== seq) return;
          setOpts(r);
          setHi(-1);
          setLoading(false);
        })
        .catch(() => {
          if (seqRef.current !== seq) return;
          setOpts([]);
          setLoading(false);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [active, q]);

  const shown = active ? opts : [];
  const expanded = shown.length > 0;

  function pick(opt: AsyncOption<T>) {
    onPick(opt);
    setOpen(false);
  }
  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Tab") return setOpen(false);
    if (!expanded) return;
    if (e.key === "Escape") {
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi((i) => Math.min(i + 1, shown.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && shown[hi]) {
      // hanya saat ada yang disorot — Enter biasa tetap mengirim form
      e.preventDefault();
      pick(shown[hi]);
    }
  }

  return (
    <div ref={wrapRef} className={cn("relative w-full", wrapperClassName)}>
      <input
        id={id}
        data-slot="input"
        type={type}
        role="combobox"
        autoComplete="off"
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={
          expanded && hi >= 0 ? `${listId}-${hi}` : undefined
        }
        placeholder={placeholder}
        value={value}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onKeyDown={onKey}
        className={cn(ctrlClass, loading && "pr-10", className)}
      />
      {loading && active ? (
        <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2">
          <Spinner />
        </span>
      ) : null}
      <ul
        id={listId}
        role="listbox"
        className={cn(
          popClass,
          "flex max-h-64 list-none flex-col overflow-y-auto",
          !expanded && "hidden"
        )}
      >
        {shown.map((o, i) => (
          <li
            key={o.value}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === hi}
            onMouseEnter={() => setHi(i)}
            // mousedown, bukan click: fokus tetap di input sampai terpilih
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(o)}
            className={cn(
              "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left tracking-(--tracking-brand)",
              i === hi
                ? "bg-(--fill-hover) text-(--text-primary)"
                : "text-(--text-secondary)"
            )}
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[13px] font-medium">
                {o.label}
              </span>
              {o.detail ? (
                <span className="truncate text-xs text-(--text-tertiary)">
                  {o.detail}
                </span>
              ) : null}
            </span>
            {o.tag ? <Badge variant="warning">{o.tag}</Badge> : null}
            {o.sub ? (
              <span className="flex-none font-mono text-xs text-(--text-tertiary)">
                {o.sub}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export { AsyncSelect, AsyncSuggest };
