"use client";

import * as React from "react";
import { Megaphone } from "lucide-react";

import { COLOR_VAL, runTextsForDisplay } from "@/lib/display-data";

/* Running text kiosk (opsi A): SABUK berjalan yang menyambung. Sumbernya
   fleksibel — kalau display punya running text KUSTOM sendiri pakai itu, kalau
   tidak jatuh ke semua Running Text master aktif (via runTextsForDisplay).
   Tiap segmen pakai Warna-nya, dipisah "•". (Timeline kini = jadwal alokasi,
   bukan pengumuman display — jadi tak ada lagi takeover terjadwal di sini.) */

export function RunningTicker({ displayName }: { displayName?: string }) {
  const items = runTextsForDisplay(displayName);
  if (!items.length) return null;

  return (
    <div className="absolute inset-x-0 bottom-0 z-1 flex h-16 items-center gap-5 border-t border-(--glass-1-border) bg-(--glass-1-fill) px-14 backdrop-blur-md">
      <span className="grid size-10 flex-none place-items-center rounded-full border border-(--badge-info-border) bg-(--badge-info-fill)">
        <Megaphone className="size-5 text-primary-bright" />
      </span>
      <div className="relative min-w-0 flex-1 overflow-hidden">
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
      </div>
    </div>
  );
}
