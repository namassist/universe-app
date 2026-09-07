"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { UniverseLogo } from "@/components/ui/logo";

/* Lencana logo holografis — versi 3D dari <LogoBadge> khusus halaman auth.
   Sengaja komponen terpisah: <LogoBadge> tetap dipakai apa adanya oleh
   /register dan display-shell, jadi tampilannya di sana tidak berubah.

   Susunan lapisan (penting):
   .logo3d-stage  -> pemberi `perspective`
     .logo3d-tilt -> `preserve-3d`, dimiringkan mengikuti kursor
       .logo3d-tilt (float) -> `preserve-3d`, ayunan halus saat diam
         pelat cahaya / cincin orbit / kaca lencana / kilau / logo

   Kaca lencana memakai backdrop-filter, dan backdrop-filter MEMAKSA
   transform-style turunannya menjadi `flat`. Karena itu logo diletakkan
   sebagai SAUDARA dari kaca, bukan anaknya — kalau di dalam, translateZ
   logo akan diam-diam rata dan efek 3D hilang. */

const MAX_TILT = 12; // derajat

function LogoBadge3D({
  className,
  logoClassName,
}: {
  className?: string;
  logoClassName?: string;
}) {
  const stageRef = React.useRef<HTMLDivElement>(null);
  const frame = React.useRef(0);
  const [tilt, setTilt] = React.useState({ x: 0, y: 0 });
  const [interactive, setInteractive] = React.useState(false);

  // Hanya aktif untuk penunjuk presisi & saat pengguna tidak meminta
  // pengurangan gerak. Dicek di efek agar render server/klien sama.
  React.useEffect(() => {
    const fine = window.matchMedia("(pointer: fine)");
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setInteractive(fine.matches && !calm.matches);
    sync();
    fine.addEventListener("change", sync);
    calm.addEventListener("change", sync);
    return () => {
      fine.removeEventListener("change", sync);
      calm.removeEventListener("change", sync);
    };
  }, []);

  React.useEffect(() => () => cancelAnimationFrame(frame.current), []);

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!interactive) return;
    const el = stageRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // -1..1 relatif terhadap pusat lencana
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    // di-throttle ke satu update per frame agar tidak membanjiri render
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() =>
      setTilt({ x: -py * 2 * MAX_TILT, y: px * 2 * MAX_TILT })
    );
  }

  function onPointerLeave() {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => setTilt({ x: 0, y: 0 }));
  }

  return (
    <div
      ref={stageRef}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      className={cn("flex-none logo3d-stage", className)}
    >
      <div
        className="logo3d-tilt size-full transition-transform duration-200 ease-out"
        style={{ transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)` }}
      >
        <div className="logo3d-tilt size-full animate-logo-float">
          {/* halo di belakang — memberi kesan lencana mengambang */}
          <div
            className="logo3d-plate"
            style={{ transform: "translateZ(-34px)" }}
            aria-hidden
          />

          {/* dua cincin orbit dengan sumbu berbeda — `inset` mengatur ukuran,
              `transform` sepenuhnya milik keyframes, jadi keduanya tidak bentrok */}
          <div
            className="logo3d-ring inset-[-17%] animate-logo-orbit"
            aria-hidden
          />
          <div
            className="logo3d-ring inset-[-5%] animate-logo-orbit-rev"
            aria-hidden
          />

          {/* kaca lencana — kelas & warna identik dengan <LogoBadge> */}
          <div
            className="absolute inset-0 rounded-full border border-(--glass-2-border) bg-(--glass-2-fill) shadow-[0_0_0_3px_var(--ring-avatar),0_0_28px_rgba(0,212,255,.4)] backdrop-blur-md"
            aria-hidden
          />

          {/* kilau spekular tepat di atas permukaan kaca */}
          <div
            className="logo3d-sheen"
            style={{ transform: "translateZ(2px)" }}
            aria-hidden
          />

          {/* logo mengambang di atas kaca — sumber efek paralaks saat miring */}
          <span
            className="relative grid place-items-center"
            style={{ transform: "translateZ(26px)" }}
          >
            <UniverseLogo priority className={logoClassName} />
          </span>
        </div>
      </div>
    </div>
  );
}

export { LogoBadge3D };
