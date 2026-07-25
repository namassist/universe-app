/**
 * Sumber tunggal untuk konten kiosk/display: Running Text, Sound, dan Timeline.
 * Dipakai bersama oleh master menu (`components/menus/master.tsx`) dan layar
 * kiosk (`app/display/*`). Ubah di sini → master & display ikut berubah.
 * (App statis tanpa persistence — ini data contoh.)
 */

export type RunningText = {
  id: string;
  text: string;
  /** kunci warna → COLOR_VAL */
  color: string;
  active: boolean;
};

export type SoundClip = {
  id: string;
  name: string;
  file: string;
  active: boolean;
};

export type TimelineEvent = {
  id: string;
  name: string;
  /** "HH:MM" 24 jam */
  time: string;
  /** cocok dengan RunningText.text */
  runningText: string;
  /** cocok dengan SoundClip.name */
  sound: string;
  active: boolean;
};

export const RUNTEXT_COLORS = ["Cyan", "Oranye", "Putih", "Merah"];

export const COLOR_VAL: Record<string, string> = {
  Cyan: "#00D4FF",
  Oranye: "#E99B2A",
  Putih: "#FFFFFF",
  Merah: "#FC3C3B",
};

export const RUNNING_TEXTS: RunningText[] = [
  { id: "t1", text: "Selamat datang di UNIVERSE", color: "Cyan", active: true },
  {
    id: "t2",
    text: "Utamakan keselamatan kerja",
    color: "Oranye",
    active: true,
  },
];

export const SOUNDS: SoundClip[] = [
  { id: "sd1", name: "Bel Masuk", file: "bel-masuk.wav", active: true },
  { id: "sd2", name: "Bel Pulang", file: "bel-pulang.wav", active: true },
  { id: "sd3", name: "Sirene", file: "sirene.wav", active: true },
  { id: "sd4", name: "Pengumuman", file: "pengumuman.wav", active: true },
];

/** Path publik file audio sebuah sound (untuk <audio>/new Audio). */
export const soundSrc = (file: string): string => `/sounds/${file}`;

/** Cari file audio milik sound bernama X (yang aktif), bila ada. */
export const soundFileByName = (name: string): string | undefined =>
  SOUNDS.find((s) => s.active && s.name === name)?.file;

export const TIMELINE: TimelineEvent[] = [
  {
    id: "tl1",
    name: "Masuk Kerja",
    time: "07:00",
    runningText: "Selamat datang di UNIVERSE",
    sound: "Bel Masuk",
    active: true,
  },
  {
    id: "tl2",
    name: "Istirahat",
    time: "12:00",
    runningText: "Utamakan keselamatan kerja",
    sound: "Sirene",
    active: true,
  },
  {
    id: "tl3",
    name: "Pulang Kerja",
    time: "17:00",
    runningText: "Selamat datang di UNIVERSE",
    sound: "Bel Pulang",
    active: true,
  },
];

/** Running text aktif — bahan sabuk ticker di kiosk. */
export const activeRunningTexts = (): RunningText[] =>
  RUNNING_TEXTS.filter((r) => r.active);

/** Event timeline aktif yang jatuh tepat pada jam "HH:MM", bila ada. */
export const timelineAt = (hhmm: string): TimelineEvent | undefined =>
  TIMELINE.find((e) => e.active && e.time === hhmm);

/* ------------------------------------------------------------------ *
 * Daftar display (dikelola di menu Display admin, ditonton di kiosk).
 * Tiap display bisa punya running text KUSTOM sendiri (bisa banyak).
 * `runtexts` kosong = ikut master (semua RUNNING_TEXTS aktif).
 * ------------------------------------------------------------------ */

export type CustomRunText = { text: string; color: string };

export type FleetPick = { id: string; digger: string; unitCount: number };

export type Display = {
  id: string;
  name: string;
  kind: "att" | "fleet";
  fleets?: FleetPick[];
  online: boolean;
  hb: string;
  /** kosong = ikut master */
  runtexts: CustomRunText[];
  active: boolean;
  rotateSec?: number;
};

export const FLEETS: FleetPick[] = [
  { id: "fl1", digger: "EX-22", unitCount: 6 },
  { id: "fl2", digger: "EX-07", unitCount: 5 },
  { id: "fl3", digger: "PC-11", unitCount: 4 },
  { id: "fl4", digger: "WA-03", unitCount: 3 },
];

export const DISPLAYS: Record<"att" | "fleet", Display[]> = {
  att: [
    {
      id: "DSP-A01",
      name: "TV Gate Utara",
      kind: "att",
      online: true,
      hb: "baru saja",
      runtexts: [],
      active: true,
    },
    {
      id: "DSP-A02",
      name: "TV Mess A",
      kind: "att",
      online: true,
      hb: "1m lalu",
      runtexts: [{ text: "Utamakan keselamatan", color: "Oranye" }],
      active: true,
    },
    {
      id: "DSP-A03",
      name: "TV Gate Barat",
      kind: "att",
      online: false,
      hb: "6m lalu",
      runtexts: [],
      active: false,
    },
  ],
  fleet: [
    {
      id: "DSP-F01",
      name: "Fleet EX-22",
      kind: "fleet",
      fleets: [FLEETS[0]!],
      online: true,
      hb: "baru saja",
      runtexts: [],
      active: true,
      rotateSec: 12,
    },
    {
      id: "DSP-F02",
      name: "Fleet EX-07 +1",
      kind: "fleet",
      fleets: [FLEETS[1]!, FLEETS[2]!],
      online: true,
      hb: "2m lalu",
      runtexts: [],
      active: true,
      rotateSec: 15,
    },
  ],
};

/**
 * Running text yang harus ditampilkan sebuah kiosk (dicari via nama display):
 * pakai daftar KUSTOM display bila ada, kalau tidak jatuh ke master aktif.
 */
export const runTextsForDisplay = (name?: string | null): CustomRunText[] => {
  const all = [...DISPLAYS.att, ...DISPLAYS.fleet];
  const d = name ? all.find((x) => x.name === name) : undefined;
  if (d && d.runtexts.length) return d.runtexts;
  return activeRunningTexts().map((r) => ({ text: r.text, color: r.color }));
};
