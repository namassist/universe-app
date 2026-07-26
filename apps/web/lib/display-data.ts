/**
 * Sumber tunggal data master terkait display & alokasi: Running Text, Sound,
 * dan Timeline (= jadwal alokasi awal shift). Dipakai bersama oleh master menu
 * (`components/menus/master.tsx`) dan layar kiosk (`app/display/*`).
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

/* Timeline = JADWAL ALOKASI (bukan pengumuman display): tahapan proses
   pengisian unit di awal shift, editable & bisa ditambah. */
export type TimelineAction =
  | "ftw-deadline"
  | "finger-in"
  | "finger-ingest"
  | "spare-validate"
  | "bus-depart"
  | "other";

export const TIMELINE_ACTIONS: { value: TimelineAction; label: string }[] = [
  { value: "ftw-deadline", label: "Batas upload FTW" },
  { value: "finger-in", label: "Batas finger in" },
  { value: "finger-ingest", label: "Ambil data finger" },
  { value: "spare-validate", label: "Validasi spare ke unit" },
  { value: "bus-depart", label: "Bus berangkat" },
  { value: "other", label: "Lainnya" },
];

export const TIMELINE_ACTION_LABELS = TIMELINE_ACTIONS.map((a) => a.label);

export const timelineActionLabel = (v: TimelineAction): string =>
  TIMELINE_ACTIONS.find((a) => a.value === v)?.label ?? v;

export type TimelineStage = {
  id: string;
  /** nama tahap */
  name: string;
  /** "HH:MM" 24 jam */
  time: string;
  action: TimelineAction;
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

export const TIMELINE: TimelineStage[] = [
  {
    id: "tl1",
    name: "Batas Upload FTW",
    time: "04:45",
    action: "ftw-deadline",
    active: true,
  },
  {
    id: "tl2",
    name: "Batas Finger In",
    time: "05:20",
    action: "finger-in",
    active: true,
  },
  {
    id: "tl3",
    name: "Ambil Data Finger",
    time: "05:21",
    action: "finger-ingest",
    active: true,
  },
  {
    id: "tl4",
    name: "Validasi Spare",
    time: "05:25",
    action: "spare-validate",
    active: true,
  },
  {
    id: "tl5",
    name: "Bus Berangkat",
    time: "05:30",
    action: "bus-depart",
    active: true,
  },
];

/** Running text aktif — bahan sabuk ticker di kiosk. */
export const activeRunningTexts = (): RunningText[] =>
  RUNNING_TEXTS.filter((r) => r.active);

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
