import type { BadgeVariant } from "@/components/ui/badge";

/**
 * Static data model for the Fleet Allocation board — mirrors the reference
 * server-composed board document (units + resolved slots + fleet embed),
 * scaled down to sample size. No state here; the board keeps local state.
 */

export type FaShift = "pagi" | "malam";
export type UnitStatus = "ready" | "breakdown" | "standby";

export type Slot = {
  nik: string;
  name: string;
  simperJenis?: string;
  /** ACTUAL only */
  ftw?: "fit" | "kurang" | "belum";
  via?: "plan" | "spare" | "manual";
  gugur?: "cuti" | "absen" | "ftw" | null;
  replacedName?: string;
  at?: string; // HH:mm
};

export type BoardUnit = {
  code: string;
  model: string;
  brand: string;
  loc: string;
  status: UnitStatus;
  fleet: { id: string; digger: string; area: string } | null;
  downtime?: boolean;
  slots: Slot[];
};

export const FLEET_OPTIONS = [
  { id: "fl1", digger: "EX-22" },
  { id: "fl2", digger: "EX-07" },
];

const op = (nik: string, name: string, simperJenis = "BII"): Slot => ({
  nik,
  name,
  simperJenis,
});

const FL1 = { id: "fl1", digger: "EX-22", area: "Pit 3 — Panel Utara" };
const FL2 = { id: "fl2", digger: "EX-07", area: "Disposal Utara" };

/** Papan PLAN — pasangan tetap unit ↔ maks. 2 operator. */
export const PLAN_UNITS: BoardUnit[] = [
  {
    code: "EX-22",
    model: "PC2000-8",
    brand: "Komatsu",
    loc: "Pit 3",
    status: "ready",
    fleet: FL1,
    slots: [op("OPS-0388", "Andi Wijaya")],
  },
  {
    code: "DT-101",
    model: "HD785-7",
    brand: "Komatsu",
    loc: "Pit 3",
    status: "ready",
    fleet: FL1,
    slots: [op("OPS-0421", "Budi Santoso"), op("OPS-0510", "Rudi Hartono")],
  },
  {
    code: "DT-102",
    model: "HD785-7",
    brand: "Komatsu",
    loc: "Pit 3",
    status: "ready",
    fleet: FL1,
    slots: [op("OPS-0111", "Joko Prasetyo")],
  },
  {
    code: "DT-104",
    model: "HD785-7",
    brand: "Komatsu",
    loc: "Pit 3",
    status: "breakdown",
    fleet: FL1,
    slots: [],
  },
  {
    code: "DT-105",
    model: "HD785-7",
    brand: "Komatsu",
    loc: "Pit 3",
    status: "ready",
    fleet: FL1,
    slots: [],
  },
  {
    code: "EX-07",
    model: "PC2000-8",
    brand: "Komatsu",
    loc: "Disposal",
    status: "ready",
    fleet: FL2,
    slots: [op("OPS-0367", "Hendra Gunawan")],
  },
  {
    code: "DT-201",
    model: "HD785-7",
    brand: "Komatsu",
    loc: "Disposal",
    status: "ready",
    fleet: FL2,
    slots: [op("OPS-0455", "Fitri Handayani")],
  },
  {
    code: "DT-202",
    model: "HD785-7",
    brand: "Komatsu",
    loc: "Disposal",
    status: "ready",
    fleet: FL2,
    slots: [op("OPS-0290", "Dewi Anggraini")],
  },
  {
    code: "DT-203",
    model: "HD785-7",
    brand: "Komatsu",
    loc: "Disposal",
    status: "standby",
    fleet: FL2,
    slots: [],
  },
  {
    code: "DZ-05",
    model: "D375A-6",
    brand: "Komatsu",
    loc: "Disposal",
    status: "ready",
    fleet: null,
    slots: [op("OPS-0129", "Agus Salim", "KIMPER")],
  },
  {
    code: "GR-02",
    model: "GD825A",
    brand: "Komatsu",
    loc: "Workshop",
    status: "standby",
    fleet: null,
    slots: [],
  },
  {
    code: "WT-01",
    model: "HD465-7 WT",
    brand: "Komatsu",
    loc: "Pit 3",
    status: "ready",
    fleet: null,
    slots: [],
  },
];

/** Papan ACTUAL hasil generate — 1 slot final per unit + kasus khusus. */
export const ACTUAL_UNITS: BoardUnit[] = [
  {
    code: "EX-22",
    model: "PC2000-8",
    brand: "Komatsu",
    loc: "Pit 3",
    status: "ready",
    fleet: FL1,
    slots: [{ ...op("OPS-0388", "Andi Wijaya"), via: "plan", ftw: "fit" }],
  },
  {
    code: "DT-101",
    model: "HD785-7",
    brand: "Komatsu",
    loc: "Pit 3",
    status: "ready",
    fleet: FL1,
    slots: [{ ...op("OPS-0421", "Budi Santoso"), via: "plan", ftw: "fit" }],
  },
  {
    code: "DT-102",
    model: "HD785-7",
    brand: "Komatsu",
    loc: "Pit 3",
    status: "ready",
    fleet: FL1,
    slots: [
      {
        ...op("OPS-0715", "Bagus Priyambodo"),
        via: "spare",
        replacedName: "Joko Prasetyo",
        ftw: "fit",
      },
    ],
  },
  {
    code: "DT-104",
    model: "HD785-7",
    brand: "Komatsu",
    loc: "Pit 3",
    status: "breakdown",
    fleet: FL1,
    slots: [],
  },
  {
    code: "DT-105",
    model: "HD785-7",
    brand: "Komatsu",
    loc: "Pit 3",
    status: "ready",
    fleet: FL1,
    downtime: true,
    slots: [],
  },
  {
    code: "EX-07",
    model: "PC2000-8",
    brand: "Komatsu",
    loc: "Disposal",
    status: "ready",
    fleet: FL2,
    slots: [{ ...op("OPS-0367", "Hendra Gunawan"), via: "plan", gugur: "ftw" }],
  },
  {
    code: "DT-201",
    model: "HD785-7",
    brand: "Komatsu",
    loc: "Disposal",
    status: "ready",
    fleet: FL2,
    slots: [{ ...op("OPS-0455", "Fitri Handayani"), via: "plan", ftw: "fit" }],
  },
  {
    code: "DT-202",
    model: "HD785-7",
    brand: "Komatsu",
    loc: "Disposal",
    status: "ready",
    fleet: FL2,
    slots: [
      {
        ...op("OPS-0733", "Lina Kusuma"),
        via: "manual",
        at: "2026-07-21T06:40",
        ftw: "fit",
      },
    ],
  },
  {
    code: "DT-203",
    model: "HD785-7",
    brand: "Komatsu",
    loc: "Disposal",
    status: "standby",
    fleet: FL2,
    slots: [],
  },
  {
    code: "DZ-05",
    model: "D375A-6",
    brand: "Komatsu",
    loc: "Disposal",
    status: "ready",
    fleet: null,
    slots: [
      { ...op("OPS-0129", "Agus Salim", "KIMPER"), via: "plan", ftw: "fit" },
    ],
  },
  {
    code: "GR-02",
    model: "GD825A",
    brand: "Komatsu",
    loc: "Workshop",
    status: "standby",
    fleet: null,
    slots: [],
  },
  {
    code: "WT-01",
    model: "HD465-7 WT",
    brand: "Komatsu",
    loc: "Pit 3",
    status: "ready",
    fleet: null,
    slots: [],
  },
];

/** Pool spare berurutan — urutan = prioritas substitusi. */
export type SpareRow = { nik: string; name: string };
export const SPARE_INIT: SpareRow[] = [
  { nik: "OPS-0715", name: "Bagus Priyambodo" },
  { nik: "OPS-0733", name: "Lina Kusuma" },
  { nik: "OPS-0602", name: "Rina Marlina" },
  { nik: "OPS-0748", name: "Yusuf Maulana" },
  { nik: "OPS-0752", name: "Tono Sugiarto" },
];

/** Kandidat dialog alokasi. */
export type Candidate = {
  nik: string;
  name: string;
  simperJenis?: string;
  eligible: boolean;
  busyAt?: string;
  here?: boolean;
  complement?: boolean;
  rosterShift?: FaShift;
  ftw?: "fit" | "kurang" | "belum";
};

export const CANDIDATES: Candidate[] = [
  {
    nik: "OPS-0715",
    name: "Bagus Priyambodo",
    simperJenis: "BII",
    eligible: true,
    complement: true,
    rosterShift: "pagi",
    ftw: "fit",
  },
  {
    nik: "OPS-0733",
    name: "Lina Kusuma",
    simperJenis: "BII",
    eligible: true,
    rosterShift: "malam",
    ftw: "fit",
  },
  {
    nik: "OPS-0748",
    name: "Yusuf Maulana",
    simperJenis: "BII",
    eligible: true,
    rosterShift: "pagi",
    ftw: "belum",
  },
  {
    nik: "OPS-0752",
    name: "Tono Sugiarto",
    simperJenis: "BII",
    eligible: true,
    rosterShift: "pagi",
    ftw: "kurang",
  },
  {
    nik: "OPS-0421",
    name: "Budi Santoso",
    simperJenis: "BII",
    eligible: false,
    busyAt: "DT-101",
    rosterShift: "pagi",
    ftw: "fit",
  },
  {
    nik: "OPS-0510",
    name: "Rudi Hartono",
    simperJenis: "BII",
    eligible: false,
    busyAt: "DT-101",
    rosterShift: "pagi",
    ftw: "fit",
  },
  {
    nik: "OPS-0233",
    name: "Sari Lestari",
    eligible: false,
    rosterShift: "pagi",
    ftw: "fit",
  },
  {
    nik: "OPS-0602",
    name: "Rina Marlina",
    eligible: false,
    rosterShift: "pagi",
    ftw: "fit",
  },
];

/** Riwayat ACTUAL per tanggal+shift. */
export type ActualRow = {
  date: string;
  shift: FaShift;
  createdAt: string; // HH:mm
  generatedAt: string | null;
  total: number;
  viaPlan: number;
  viaSpare: number;
  downtime: number;
};

export const ACTUAL_INIT: ActualRow[] = [
  {
    date: "2026-07-21",
    shift: "pagi",
    createdAt: "04:30",
    generatedAt: "05:02",
    total: 9,
    viaPlan: 6,
    viaSpare: 2,
    downtime: 1,
  },
  {
    date: "2026-07-20",
    shift: "malam",
    createdAt: "16:30",
    generatedAt: null,
    total: 0,
    viaPlan: 0,
    viaSpare: 0,
    downtime: 0,
  },
  {
    date: "2026-07-20",
    shift: "pagi",
    createdAt: "04:30",
    generatedAt: "05:04",
    total: 9,
    viaPlan: 8,
    viaSpare: 1,
    downtime: 0,
  },
  {
    date: "2026-07-19",
    shift: "malam",
    createdAt: "16:30",
    generatedAt: "17:03",
    total: 8,
    viaPlan: 7,
    viaSpare: 0,
    downtime: 2,
  },
];

export const ftwBadge: Record<
  "fit" | "kurang" | "belum",
  { variant: BadgeVariant; labelKey: "bFit" | "ftwStatKurang" | "ftwStatBelum" }
> = {
  fit: { variant: "success", labelKey: "bFit" },
  kurang: { variant: "warning", labelKey: "ftwStatKurang" },
  belum: { variant: "neutral", labelKey: "ftwStatBelum" },
};
