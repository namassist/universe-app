/* Latar berkedalaman 3D untuk halaman auth.
   Murni CSS: lantai grid perspektif + partikel ber-translateZ nyata +
   garis horizon. Tidak ada warna baru — semua dari token yang ada, dan
   intensitas diatur lewat `opacity`. Aman untuk SSR (posisi partikel
   statis, tanpa Math.random) dan patuh prefers-reduced-motion. */

/* Posisi partikel sengaja di-hardcode: nilai acak saat render akan
   berbeda antara server dan klien dan memicu hydration mismatch.
   z negatif = lebih jauh (otomatis mengecil & bergerak pelan karena
   perspektif pada .auth-scene). */
const MOTES = [
  { l: "8%", t: "72%", z: -260, s: 3, o: 0.5, d: 21, delay: -3 },
  { l: "16%", t: "38%", z: -120, s: 2, o: 0.4, d: 26, delay: -11 },
  { l: "23%", t: "86%", z: -40, s: 4, o: 0.55, d: 18, delay: -7 },
  { l: "31%", t: "24%", z: -320, s: 2, o: 0.3, d: 30, delay: -15 },
  { l: "39%", t: "63%", z: -180, s: 3, o: 0.45, d: 23, delay: -1 },
  { l: "47%", t: "91%", z: -60, s: 3, o: 0.5, d: 19, delay: -9 },
  { l: "54%", t: "31%", z: -240, s: 2, o: 0.35, d: 28, delay: -19 },
  { l: "62%", t: "78%", z: -100, s: 4, o: 0.5, d: 20, delay: -5 },
  { l: "69%", t: "46%", z: -300, s: 2, o: 0.3, d: 32, delay: -13 },
  { l: "76%", t: "84%", z: -140, s: 3, o: 0.45, d: 24, delay: -17 },
  { l: "83%", t: "29%", z: -220, s: 2, o: 0.35, d: 27, delay: -2 },
  { l: "89%", t: "68%", z: -80, s: 3, o: 0.5, d: 22, delay: -12 },
  { l: "94%", t: "52%", z: -280, s: 2, o: 0.3, d: 29, delay: -6 },
  { l: "12%", t: "56%", z: -200, s: 2, o: 0.4, d: 25, delay: -22 },
];

/* Bintang jatuh — posisi awal, arah (dx,dy), rotasi (searah geraknya), dan
   jeda dibuat statis agar SSR & klien identik. Durasi panjang + delay negatif
   yang tersebar => hanya sesekali satu melintas, tidak ramai. */
const STARS = [
  { l: "12%", t: "10%", dx: 520, dy: 250, rot: 26, o: 0.9, d: 9, delay: -1 },
  { l: "68%", t: "6%", dx: -460, dy: 300, rot: 147, o: 0.75, d: 11, delay: -6 },
  { l: "40%", t: "16%", dx: 560, dy: 210, rot: 21, o: 0.85, d: 13, delay: -10 },
  {
    l: "84%",
    t: "22%",
    dx: -520,
    dy: 240,
    rot: 155,
    o: 0.7,
    d: 12,
    delay: -15,
  },
];

function DepthScene() {
  return (
    <div className="auth-scene" aria-hidden>
      {/* pita aurora — dua lapis, cyan lalu biru */}
      <div className="auth-aurora animate-aurora" />
      <div className="auth-aurora-alt animate-aurora-alt" />

      {/* lantai grid yang menjauh ke horizon */}
      <div className="auth-grid">
        <div className="auth-grid-plane animate-grid-flow" />
      </div>

      {/* bloom + pita cahaya di garis horizon */}
      <div className="auth-bloom animate-bloom-pulse" />
      <div className="auth-horizon animate-horizon-pulse" />

      {/* bintang jatuh sesekali melintas paruh atas */}
      {STARS.map((s, i) => (
        <span
          key={`star-${i}`}
          className="auth-star animate-star-shoot"
          style={
            {
              left: s.l,
              top: s.t,
              animationDuration: `${s.d}s`,
              animationDelay: `${s.delay}s`,
              "--star-dx": `${s.dx}px`,
              "--star-dy": `${s.dy}px`,
              "--star-rot": `${s.rot}deg`,
              "--star-o": s.o,
            } as React.CSSProperties
          }
        />
      ))}

      {/* partikel melayang pada beberapa kedalaman */}
      {MOTES.map((m, i) => (
        <span
          key={i}
          className="auth-mote animate-mote-drift"
          style={
            {
              left: m.l,
              top: m.t,
              width: m.s,
              height: m.s,
              animationDuration: `${m.d}s`,
              animationDelay: `${m.delay}s`,
              "--mote-z": `${m.z}px`,
              "--mote-dx": `${(i % 2 === 0 ? 1 : -1) * (8 + (i % 4) * 6)}px`,
              "--mote-o": m.o,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

export { DepthScene };
