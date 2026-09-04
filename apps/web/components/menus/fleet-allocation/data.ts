import type { BadgeVariant } from "@/components/ui/badge";

/**
 * Static data model for the Unit No-Operator board — a server-composed board
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

/**
 * One unit as a board card reads it.
 *
 * The work area is deliberately absent. It belongs to the fleet, not the
 * machine — identical for every unit in a formation — so a card that printed
 * it repeated the same words down the whole grid. It lives on `FLEET_OPTIONS`
 * now, where the board states it once for whichever formation is on screen.
 */
export type BoardUnit = {
  code: string;
  brand: string;
  status: UnitStatus;
  /** Which permit the machine takes; null when none is recorded. */
  simperCode?: string | null;
  /** Whether its operator has to clear Fit To Work first. */
  requiresFtw?: boolean;
  /** Owning department's name; null/absent means a global unit. */
  departmentName?: string | null;
  fleet: { id: string; digger: string } | null;
  /** Crewed without a formation — a dozer, a water truck, a spare digger. */
  fleetSupport?: boolean;
  downtime?: boolean;
  slots: Slot[];
};

export const FLEET_OPTIONS = [
  { id: "fl1", digger: "EX8001", area: "Panel East Puncak Utara" },
  { id: "fl2", digger: "EX7001", area: "Disposal T4" },
];

const op = (nik: string, name: string, simperJenis = "BII"): Slot => ({
  nik,
  name,
  simperJenis,
});

const FL1 = { id: "fl1", digger: "EX8001" };
const FL2 = { id: "fl2", digger: "EX7001" };

/** Papan ACTUAL hasil generate — 1 slot final per unit + kasus khusus. */
export const ACTUAL_UNITS: BoardUnit[] = [
  {
    code: "EX8001",
    brand: "HITACHI",
    status: "ready",
    fleet: FL1,
    slots: [{ ...op("508210388", "Andi Wijaya"), via: "plan", ftw: "fit" }],
  },
  {
    code: "RD5001",
    brand: "CATERPILLAR",
    status: "ready",
    fleet: FL1,
    slots: [{ ...op("503220421", "Budi Santoso"), via: "plan", ftw: "fit" }],
  },
  {
    code: "RD5002",
    brand: "CATERPILLAR",
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
    brand: "CATERPILLAR",
    status: "breakdown",
    fleet: FL1,
    slots: [],
  },
  {
    code: "RD4002",
    brand: "CATERPILLAR",
    status: "ready",
    fleet: FL1,
    downtime: true,
    slots: [],
  },
  {
    code: "EX7001",
    brand: "HITACHI",
    status: "ready",
    fleet: FL2,
    slots: [
      { ...op("502210367", "Hendra Gunawan"), via: "plan", gugur: "ftw" },
    ],
  },
  {
    code: "DT4017",
    brand: "SANY",
    status: "ready",
    fleet: FL2,
    slots: [{ ...op("506230455", "Fitri Handayani"), via: "plan", ftw: "fit" }],
  },
  {
    code: "DT4018",
    brand: "SANY",
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
    brand: "SANY",
    status: "standby",
    fleet: FL2,
    slots: [],
  },
  {
    code: "WE2004",
    brand: "SANY",
    status: "ready",
    fleet: null,
    slots: [
      { ...op("504180129", "Agus Salim", "KIMPER"), via: "plan", ftw: "fit" },
    ],
  },
  {
    code: "DT3014",
    brand: "SANY",
    status: "standby",
    fleet: null,
    slots: [],
  },
  {
    code: "EX5001",
    brand: "HITACHI",
    status: "ready",
    fleet: null,
    slots: [],
  },
  {
    code: "EX5002",
    brand: "HITACHI",
    status: "standby",
    fleet: null,
    slots: [],
  },
  {
    code: "EX4001",
    brand: "HITACHI",
    status: "standby",
    fleet: null,
    slots: [],
  },
  {
    code: "EX4002",
    brand: "HITACHI",
    status: "standby",
    fleet: null,
    slots: [],
  },
];

/** Pool spare — tanpa urutan prioritas (bukan senioritas). */
export type SpareRow = {
  nik: string;
  name: string;
  departmentName?: string;
  /** The SIMPER codes this operator holds, by name — what a unit matches on. */
  skills?: string[];
};
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

/**
 * An instant from the API, as a clock on the wall at site.
 *
 * The API sends `generated_at` — a `timestamptz` — through `toISOString()`, so
 * what arrives is **UTC**: a board generated at 20:03 WITA reads
 * `…T12:03:00.000Z`. Slicing characters 11–16 out of that string, as this
 * screen used to, prints the UTC clock and calls it local — eight hours wrong,
 * every time, with no error anywhere.
 *
 * Parsing and formatting is the whole fix. It follows the machine's timezone,
 * which is the same convention the rest of the app labels "WITA" (see
 * `unit-status.tsx`, `dashboard.tsx`).
 *
 * Not to be used on `sent_at` or the attendance in/out columns: those columns
 * are `timestamp` *without* time zone, carrying a naive local clock already,
 * and running them through here would shift a time that was never UTC.
 */
export function siteClock(iso: string | null | undefined): string {
  if (!iso) return "—";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
}
