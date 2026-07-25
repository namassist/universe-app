"use client";

import * as React from "react";
import { Megaphone } from "lucide-react";

import {
  COLOR_VAL,
  RUNNING_TEXTS,
  runTextsForDisplay,
  soundFileByName,
  soundSrc,
  timelineAt,
} from "@/lib/display-data";

/* Running text kiosk (opsi A): SABUK berjalan yang menyambung. Sumbernya
   fleksibel — kalau display punya running text KUSTOM sendiri pakai itu, kalau
   tidak jatuh ke semua Running Text master aktif (via runTextsForDisplay).
   Tiap segmen pakai Warna-nya, dipisah "•". Saat jam Timeline kena, sabuk
   DIAMBIL ALIH sementara oleh teks event itu (bunyi Sound menyusul — file audio
   masih dummy). Sumber data: lib/display-data. */

function two(n: number) {
  return (n < 10 ? "0" : "") + n;
}
function hhmm(d: Date) {
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
}

const OVERRIDE_MS = 15000;

export function RunningTicker({ displayName }: { displayName?: string }) {
  const [override, setOverride] = React.useState<{
    text: string;
    color: string;
  } | null>(null);

  /* cek tiap detik: begitu menit cocok dgn event timeline, ambil alih sabuk */
  React.useEffect(() => {
    let firedKey = "";
    let revert: ReturnType<typeof setTimeout> | undefined;
    const iv = setInterval(() => {
      const key = hhmm(new Date());
      const ev = timelineAt(key);
      if (ev && firedKey !== key) {
        firedKey = key;
        const rt = RUNNING_TEXTS.find((r) => r.text === ev.runningText);
        setOverride({ text: ev.runningText, color: rt?.color ?? "Cyan" });
        /* bunyikan sound event (autoplay bisa ditolak tanpa gestur — diabaikan) */
        const file = soundFileByName(ev.sound);
        if (file) void new Audio(soundSrc(file)).play().catch(() => {});
        revert = setTimeout(() => setOverride(null), OVERRIDE_MS);
      }
    }, 1000);
    return () => {
      clearInterval(iv);
      if (revert) clearTimeout(revert);
    };
  }, []);

  const items = runTextsForDisplay(displayName);
  if (!override && !items.length) return null;

  return (
    <div className="absolute inset-x-0 bottom-0 z-1 flex h-16 items-center gap-5 border-t border-(--glass-1-border) bg-(--glass-1-fill) px-14 backdrop-blur-md">
      <span className="grid size-10 flex-none place-items-center rounded-full border border-(--badge-info-border) bg-(--badge-info-fill)">
        <Megaphone className="size-5 text-primary-bright" />
      </span>
      <div className="relative min-w-0 flex-1 overflow-hidden">
        {override ? (
          <div
            className="text-2xl font-semibold whitespace-nowrap"
            style={{ color: COLOR_VAL[override.color] ?? undefined }}
          >
            {override.text}
          </div>
        ) : (
          <div className="display-marquee w-max animate-[kmarquee_28s_linear_infinite] text-2xl whitespace-nowrap">
            {items.map((r, i) => (
              <React.Fragment key={`${r.text}-${i}`}>
                {i > 0 ? (
                  <span className="mx-6 text-(--text-tertiary)">•</span>
                ) : null}
                <span style={{ color: COLOR_VAL[r.color] ?? undefined }}>
                  {r.text}
                </span>
              </React.Fragment>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
