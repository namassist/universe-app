"use client";

import * as React from "react";
import { Megaphone, Monitor, WifiOff } from "lucide-react";

import { cn } from "@/lib/utils";
import { LogoBadge } from "@/components/ui/logo";

/* Shell layar kiosk TV (dilihat ±6 m) — kanvas lebar tetap 1920, TINGGI
   mengikuti rasio layar (tanpa letterbox) via transform:scale(); jam
   real-time; pixel-shift anti burn-in; banner koneksi + demo switch
   Online/Terputus. Kiosk dark-only. Port statis dari referensi (tanpa feed). */

function two(n: number) {
  return (n < 10 ? "0" : "") + n;
}
function fmt(d: Date) {
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

export type DisplayStat = {
  icon: React.ReactNode;
  iconClass: string;
  value: string;
  label: string;
};

export function DisplayShell({
  title,
  meta,
  deviceName,
  stats,
  runtext,
  topBar,
  children,
}: {
  title: string;
  meta?: React.ReactNode;
  deviceName?: string;
  stats: DisplayStat[];
  runtext?: string;
  topBar?: React.ReactNode;
  children: React.ReactNode;
}) {
  const canvasRef = React.useRef<HTMLDivElement>(null);
  const [clock, setClock] = React.useState("--:--:--");
  const [stale, setStale] = React.useState("—");
  const [dateLine, setDateLine] = React.useState("");
  const [online, setOnline] = React.useState(true);

  /* fullscreen tanpa letterbox: lebar kanvas tetap 1920, tinggi mengikuti
     rasio layar — konten kolom flex meregang, tanpa bar hitam */
  React.useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    function rescale() {
      const s = innerWidth / 1920;
      cv!.style.height = `${Math.round(innerHeight / s)}px`;
      cv!.style.transform = `scale(${s})`;
    }
    rescale();
    window.addEventListener("resize", rescale);
    return () => window.removeEventListener("resize", rescale);
  }, []);

  /* selalu fullscreen: coba saat dibuka; bila browser menolak (butuh
     gestur), interaksi pertama memicunya */
  React.useEffect(() => {
    const goFullscreen = () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    };
    goFullscreen();
    const onFirstInput = () => {
      goFullscreen();
      if (document.fullscreenElement) {
        document.removeEventListener("pointerdown", onFirstInput);
        document.removeEventListener("keydown", onFirstInput);
      }
    };
    document.addEventListener("pointerdown", onFirstInput);
    document.addEventListener("keydown", onFirstInput);
    return () => {
      document.removeEventListener("pointerdown", onFirstInput);
      document.removeEventListener("keydown", onFirstInput);
    };
  }, []);

  /* jam nyata + baris tanggal */
  React.useEffect(() => {
    const now = new Date();
    const t0 = setTimeout(() => {
      setClock(fmt(now));
      setDateLine(
        now.toLocaleDateString("id-ID", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      );
    }, 0);
    const tick = setInterval(() => setClock(fmt(new Date())), 1000);
    return () => {
      clearTimeout(t0);
      clearInterval(tick);
    };
  }, []);

  function setConn(on: boolean) {
    setOnline(on);
    if (!on) setStale(`${fmt(new Date())} WITA`);
  }

  return (
    <div
      data-theme="dark"
      className="fixed inset-0 overflow-hidden bg-black font-sans tracking-(--tracking-brand) text-(--text-primary)"
    >
      <div
        ref={canvasRef}
        className="absolute top-0 left-0 h-[1080px] w-[1920px] origin-top-left overflow-hidden bg-(image:--gradient-kiosk)"
      >
        <div className="pointer-events-none absolute -top-50 -right-35 z-0 size-160 rounded-full bg-(--blob-cyan) blur-[140px]" />
        <div className="pointer-events-none absolute -bottom-55 -left-30 z-0 size-140 rounded-full bg-(--blob-blue) blur-[140px]" />

        {topBar ? (
          <div className="absolute inset-x-0 top-0 z-2">{topBar}</div>
        ) : null}

        <div className="display-stage relative z-1 flex h-full animate-[pxshift_480s_steps(1)_infinite] flex-col gap-7 px-14 pt-10 pb-22">
          {/* header */}
          <header className="flex flex-none items-center gap-7">
            <LogoBadge className="size-16" logoClassName="size-8" />
            <div className="min-w-0">
              <h1 className="truncate text-[40px] leading-tight font-bold">
                {title}
              </h1>
              {meta ? (
                <div className="mt-1.5 flex min-w-0 items-center gap-3 text-2xl text-(--text-secondary)">
                  {meta}
                </div>
              ) : null}
            </div>
            {deviceName ? (
              <div className="flex flex-none items-center gap-3 rounded-full px-6 py-3 glass-card">
                <Monitor className="size-6 text-primary-bright" />
                <span className="text-[22px] font-semibold">{deviceName}</span>
              </div>
            ) : null}
            <div className="ml-auto flex flex-none items-center gap-6">
              <div className="text-right leading-snug">
                <div className="text-[22px] font-semibold">{dateLine}</div>
                <div className="text-lg text-(--text-secondary)">
                  Site Indexim
                </div>
              </div>
              <div className="flex flex-col items-center gap-0.5 rounded-full px-8.5 py-3.5 glass-card">
                <span className="font-mono text-[44px] leading-none font-bold tabular-nums">
                  {clock}
                </span>
                <span className="text-lg text-(--text-secondary)">WITA</span>
              </div>
            </div>
          </header>

          {/* banner koneksi terputus */}
          {!online ? (
            <div
              role="alert"
              className="flex flex-none items-center gap-4 rounded-card border border-(--badge-danger-border) bg-(--badge-danger-fill) px-7 py-4.5"
            >
              <WifiOff
                className="size-8 flex-none text-danger-text"
                strokeWidth={2}
              />
              <div>
                <b className="text-[26px] font-bold text-danger-text">
                  Koneksi terputus — data tidak diperbarui
                </b>
                <br />
                <span className="text-xl text-danger-text opacity-85">
                  Menampilkan data terakhir {stale}. Menghubungkan ulang…
                </span>
              </div>
            </div>
          ) : null}

          {/* stat kiosk */}
          <div className="grid flex-none grid-cols-4 gap-5">
            {stats.map((s) => (
              <div
                key={s.label}
                className="flex items-center gap-5 rounded-card px-6 py-4 glass-card"
              >
                <div
                  className={cn(
                    "grid size-13 flex-none place-items-center rounded-icon border [&_svg]:size-6.5",
                    s.iconClass
                  )}
                >
                  {s.icon}
                </div>
                <div>
                  <div className="text-[52px] leading-none font-bold tabular-nums">
                    {s.value}
                  </div>
                  <div className="mt-1 text-lg font-semibold text-(--text-secondary)">
                    {s.label}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {children}
        </div>

        {/* running text — nempel dasar layar */}
        {runtext ? (
          <div className="absolute inset-x-0 bottom-0 z-1 flex h-16 items-center gap-5 border-t border-(--glass-1-border) bg-(--glass-1-fill) px-14 backdrop-blur-md">
            <span className="grid size-10 flex-none place-items-center rounded-full border border-(--badge-info-border) bg-(--badge-info-fill)">
              <Megaphone className="size-5 text-primary-bright" />
            </span>
            <div className="relative min-w-0 flex-1 overflow-hidden">
              <div className="display-marquee w-max animate-[kmarquee_28s_linear_infinite] text-2xl whitespace-nowrap text-(--text-secondary)">
                {runtext}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* demo switch (bukan bagian desain kiosk) */}
      <div
        role="group"
        aria-label="Demo koneksi"
        className="fixed right-4 bottom-4 z-90 flex gap-1.5 rounded-xl border border-(--glass-2-border) bg-(--overlay-fill) p-1.5 shadow-(--shadow-modal)"
      >
        <span className="self-center px-1.5 pl-2 text-[11px] text-(--text-tertiary)">
          Demo:
        </span>
        {(
          [
            [true, "Online"],
            [false, "Terputus"],
          ] as [boolean, string][]
        ).map(([on, label]) => (
          <button
            key={label}
            onClick={() => setConn(on)}
            className={cn(
              "cursor-pointer rounded-lg border border-transparent px-2.5 py-1.5 text-xs font-semibold",
              online === on
                ? "border-[rgba(0,212,255,.4)] bg-[rgba(0,212,255,.12)] text-primary-bright"
                : "text-(--text-secondary) hover:bg-[rgba(255,255,255,.08)] hover:text-(--text-primary)"
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
