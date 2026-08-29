import type { BadgeVariant } from "@/components/ui/badge";

/**
 * Static data model for the Fleet Allocation board — a server-composed board
 * document (units + resolved slots + fleet embed), scaled down to sample size.
 * No state here; the board keeps local state.
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
  /** Owning department's name; null/absent means a global unit. */
  departmentName?: string | null;
  fleet: { id: string; digger: string; area: string } | null;
  downtime?: boolean;
  slots: Slot[];
};

export const FLEET_OPTIONS = [
  { id: "fl1", digger: "EX8001" },
  { id: "fl2", digger: "EX7001" },
];

const op = (nik: string, name: string, simperJenis = "BII"): Slot => ({
  nik,
  name,
  simperJenis,
});

const FL1 = { id: "fl1", digger: "EX8001", area: "Panel East Puncak Utara" };
const FL2 = { id: "fl2", digger: "EX7001", area: "Disposal T4" };

/** Papan PLAN — pasangan tetap unit ↔ maks. 2 operator. */
export const PLAN_UNITS: BoardUnit[] = [
  {
    code: "EX8001",
    model: "EX2600-7BH",
    brand: "HITACHI",
    loc: "Panel East Puncak Utara",
    status: "ready",
    fleet: FL1,
    slots: [op("508210388", "Andi Wijaya")],
  },
  {
    code: "RD5001",
    model: "777E",
    brand: "CATERPILLAR",
    loc: "Panel East Puncak Utara",
    status: "ready",
    fleet: FL1,
    slots: [op("503220421", "Budi Santoso"), op("501230510", "Rudi Hartono")],
  },
  {
    code: "RD5002",
    model: "777E",
    brand: "CATERPILLAR",
    loc: "Panel East Puncak Utara",
    status: "ready",
    fleet: FL1,
    slots: [op("511190111", "Joko Prasetyo")],
  },
  {
    code: "RD4001",
    model: "773E",
    brand: "CATERPILLAR",
    loc: "Panel East Puncak Utara",
    status: "breakdown",
    fleet: FL1,
    slots: [],
  },
  {
    code: "RD4002",
    model: "773E",
    brand: "CATERPILLAR",
    loc: "Panel East Puncak Utara",
    status: "ready",
    fleet: FL1,
    slots: [],
  },
  {
    code: "EX7001",
    model: "EX2000-7BH",
    brand: "HITACHI",
    loc: "Disposal T4",
    status: "ready",
    fleet: FL2,
    slots: [op("502210367", "Hendra Gunawan")],
  },
  {
    code: "DT4017",
    model: "SYZ440C",
    brand: "SANY",
    loc: "Disposal T4",
    status: "ready",
    fleet: FL2,
    slots: [op("506230455", "Fitri Handayani")],
  },
  {
    code: "DT4018",
    model: "SYZ440C",
    brand: "SANY",
    loc: "Disposal T4",
    status: "ready",
    fleet: FL2,
    slots: [op("509220290", "Dewi Anggraini")],
  },
  {
    code: "DT3013",
    model: "SYZ320C-8W(R)",
    brand: "SANY",
    loc: "Disposal T4",
    status: "standby",
    fleet: FL2,
    slots: [],
  },
  {
    code: "WE2004",
    model: "SY215W",
    brand: "SANY",
    loc: "Workshop",
    status: "ready",
    fleet: null,
    slots: [op("504180129", "Agus Salim", "KIMPER")],
  },
  {
    code: "DT3014",
    model: "SYZ320C-8W(R)",
    brand: "SANY",
    loc: "Workshop",
    status: "standby",
    fleet: null,
    slots: [],
  },
  {
    code: "EX5001",
    model: "ZX870LCH-5G",
    brand: "HITACHI",
    loc: "Panel East Puncak Utara",
    status: "ready",
    fleet: null,
    slots: [],
  },
  {
    code: "EX5002",
    model: "ZX870LCH-5G",
    brand: "HITACHI",
    loc: "Readyline",
    status: "standby",
    fleet: null,
    slots: [],
  },
  {
    code: "EX4001",
    model: "ZX470LC-5G",
    brand: "HITACHI",
    loc: "Readyline",
    status: "standby",
    fleet: null,
    slots: [],
  },
  {
    code: "EX4002",
    model: "ZX470LC-5G",
    brand: "HITACHI",
    loc: "Readyline",
    status: "standby",
    fleet: null,
    slots: [],
  },
];

/** Papan ACTUAL hasil generate — 1 slot final per unit + kasus khusus. */
export const ACTUAL_UNITS: BoardUnit[] = [
  {
    code: "EX8001",
    model: "EX2600-7BH",
    brand: "HITACHI",
    loc: "Panel East Puncak Utara",
    status: "ready",
    fleet: FL1,
    slots: [{ ...op("508210388", "Andi Wijaya"), via: "plan", ftw: "fit" }],
  },
  {
    code: "RD5001",
    model: "777E",
    brand: "CATERPILLAR",
    loc: "Panel East Puncak Utara",
    status: "ready",
    fleet: FL1,
    slots: [{ ...op("503220421", "Budi Santoso"), via: "plan", ftw: "fit" }],
  },
  {
    code: "RD5002",
    model: "777E",
    brand: "CATERPILLAR",
    loc: "Panel East Puncak Utara",
    status: "ready",
    fleet: FL1,
    slots: [
      {
        ...op("507230715", "Bagus Priyambodo"),
        via: "spare",
        replacedName: "Joko Prasetyo",
        ftw: "fit",
      },
    ],
  },
  {
    code: "RD4001",
    model: "773E",
    brand: "CATERPILLAR",
    loc: "Panel East Puncak Utara",
    status: "breakdown",
    fleet: FL1,
    slots: [],
  },
  {
    code: "RD4002",
    model: "773E",
    brand: "CATERPILLAR",
    loc: "Panel East Puncak Utara",
    status: "ready",
    fleet: FL1,
    downtime: true,
    slots: [],
  },
  {
    code: "EX7001",
    model: "EX2000-7BH",
    brand: "HITACHI",
    loc: "Disposal T4",
    status: "ready",
    fleet: FL2,
    slots: [
      { ...op("502210367", "Hendra Gunawan"), via: "plan", gugur: "ftw" },
    ],
  },
  {
    code: "DT4017",
    model: "SYZ440C",
    brand: "SANY",
    loc: "Disposal T4",
    status: "ready",
    fleet: FL2,
    slots: [{ ...op("506230455", "Fitri Handayani"), via: "plan", ftw: "fit" }],
  },
  {
    code: "DT4018",
    model: "SYZ440C",
    brand: "SANY",
    loc: "Disposal T4",
    status: "ready",
    fleet: FL2,
    slots: [
      {
        ...op("507230733", "Lina Kusuma"),
        via: "manual",
        at: "2026-07-21T06:40",
        ftw: "fit",
      },
    ],
  },
  {
    code: "DT3013",
    model: "SYZ320C-8W(R)",
    brand: "SANY",
    loc: "Disposal T4",
    status: "standby",
    fleet: FL2,
    slots: [],
  },
  {
    code: "WE2004",
    model: "SY215W",
    brand: "SANY",
    loc: "Workshop",
    status: "ready",
    fleet: null,
    slots: [
      { ...op("504180129", "Agus Salim", "KIMPER"), via: "plan", ftw: "fit" },
    ],
  },
  {
    code: "DT3014",
    model: "SYZ320C-8W(R)",
    brand: "SANY",
    loc: "Workshop",
    status: "standby",
    fleet: null,
    slots: [],
  },
  {
    code: "EX5001",
    model: "ZX870LCH-5G",
    brand: "HITACHI",
    loc: "Panel East Puncak Utara",
    status: "ready",
    fleet: null,
    slots: [],
  },
  {
    code: "EX5002",
    model: "ZX870LCH-5G",
    brand: "HITACHI",
    loc: "Readyline",
    status: "standby",
    fleet: null,
    slots: [],
  },
  {
    code: "EX4001",
    model: "ZX470LC-5G",
    brand: "HITACHI",
    loc: "Readyline",
    status: "standby",
    fleet: null,
    slots: [],
  },
  {
    code: "EX4002",
    model: "ZX470LC-5G",
    brand: "HITACHI",
    loc: "Readyline",
    status: "standby",
    fleet: null,
    slots: [],
  },
];

/** Pool spare — tanpa urutan prioritas (bukan senioritas). */
export type SpareRow = { nik: string; name: string; departmentName?: string };
export const SPARE_INIT: SpareRow[] = [
  { nik: "507230715", name: "Bagus Priyambodo" },
  { nik: "507230733", name: "Lina Kusuma" },
  { nik: "510200602", name: "Rina Marlina" },
  { nik: "508230748", name: "Yusuf Maulana" },
  { nik: "508230752", name: "Tono Sugiarto" },
];

/** Kandidat dialog alokasi. */
export type Candidate = {
  nik: string;
  name: string;
  simperJenis?: string;
  departmentName?: string;
  eligible: boolean;
  busyAt?: string;
  here?: boolean;
  complement?: boolean;
  rosterShift?: FaShift;
  ftw?: "fit" | "kurang" | "belum";
};

export const CANDIDATES: Candidate[] = [
  {
    nik: "507230715",
    name: "Bagus Priyambodo",
    simperJenis: "BII",
    eligible: true,
    complement: true,
    rosterShift: "pagi",
    ftw: "fit",
  },
  {
    nik: "507230733",
    name: "Lina Kusuma",
    simperJenis: "BII",
    eligible: true,
    rosterShift: "malam",
    ftw: "fit",
  },
  {
    nik: "508230748",
    name: "Yusuf Maulana",
    simperJenis: "BII",
    eligible: true,
    rosterShift: "pagi",
    ftw: "belum",
  },
  {
    nik: "508230752",
    name: "Tono Sugiarto",
    simperJenis: "BII",
    eligible: true,
    rosterShift: "pagi",
    ftw: "kurang",
  },
  {
    nik: "503220421",
    name: "Budi Santoso",
    simperJenis: "BII",
    eligible: false,
    busyAt: "RD5001",
    rosterShift: "pagi",
    ftw: "fit",
  },
  {
    nik: "501230510",
    name: "Rudi Hartono",
    simperJenis: "BII",
    eligible: false,
    busyAt: "RD5001",
    rosterShift: "pagi",
    ftw: "fit",
  },
  {
    nik: "505200233",
    name: "Sari Lestari",
    eligible: false,
    rosterShift: "pagi",
    ftw: "fit",
  },
  {
    nik: "510200602",
    name: "Rina Marlina",
    eligible: false,
    rosterShift: "pagi",
    ftw: "fit",
  },
];

/** Riwayat ACTUAL per tanggal+shift. */

export const ftwBadge: Record<
  "fit" | "kurang" | "belum",
  { variant: BadgeVariant; labelKey: "bFit" | "ftwStatKurang" | "ftwStatBelum" }
> = {
  fit: { variant: "success", labelKey: "bFit" },
  kurang: { variant: "warning", labelKey: "ftwStatKurang" },
  belum: { variant: "neutral", labelKey: "ftwStatBelum" },
};
