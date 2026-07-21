/**
 * Static sample employees — shared by the list, detail, and edit pages so the
 * same person looks identical everywhere. Data-only module, no state.
 */

export type Komp = { jenis: string; exp: string; egis?: string[] };
export type EmpStatus = "aktif" | "cuti" | "nonaktif";
export type Employee = {
  nik: string;
  name: string;
  company: string;
  dept: string;
  pos: string;
  equip?: string;
  join?: string;
  exp?: string;
  license?: string;
  mcu?: string;
  medis?: string;
  mess?: string;
  kamar?: string;
  blood?: string;
  bpjs?: string;
  hp?: string;
  emg?: string;
  komp: Komp[];
  status: EmpStatus;
};

const UDU = "PT Unggul Dinamika Utama";

/* SIMPER master (static): jenis → kualifikasi Type EGI */
export const SIMPER_MASTER: Record<string, string[]> = {
  BII: ["HD785", "PC2000"],
  BI: ["LV", "Bus"],
  KIMPER: ["Dozer", "Grader"],
};

export const MESS_OPTS = [
  "Mess A — Blok 1",
  "Mess A — Blok 2",
  "Mess B — Blok 1",
];

export const EMPLOYEES: Employee[] = [
  {
    nik: "OPS-0421",
    name: "Budi Santoso",
    company: UDU,
    dept: "Operation",
    pos: "Driver OHT",
    equip: "HD785-7",
    join: "2022-03-01",
    exp: "2027-02-28",
    license: "SIM BII Umum",
    mcu: "Fit",
    medis: "—",
    mess: "Mess A — Blok 1",
    kamar: "A-12",
    blood: "O",
    bpjs: "0001234567890",
    hp: "0812-3456-7890",
    emg: "Siti Santoso (istri) — 0813-1111-2222",
    komp: [{ jenis: "BII", exp: "2027-03-14", egis: SIMPER_MASTER["BII"] }],
    status: "aktif",
  },
  {
    nik: "OPS-0388",
    name: "Andi Wijaya",
    company: UDU,
    dept: "Operation",
    pos: "Operator Excavator",
    equip: "PC2000-8",
    join: "2021-08-15",
    mcu: "Fit dengan catatan",
    mess: "Mess A — Blok 2",
    kamar: "A-27",
    komp: [{ jenis: "BII", exp: "2026-08-02", egis: SIMPER_MASTER["BII"] }],
    status: "aktif",
  },
  {
    nik: "OPS-0510",
    name: "Rudi Hartono",
    company: UDU,
    dept: "Operation",
    pos: "Driver OHT",
    equip: "HD785-7",
    join: "2023-01-10",
    mcu: "Fit",
    komp: [{ jenis: "BII", exp: "2026-07-18", egis: SIMPER_MASTER["BII"] }],
    status: "aktif",
  },
  {
    nik: "OPS-0233",
    name: "Sari Lestari",
    company: UDU,
    dept: "HRGA",
    pos: "Admin Site",
    join: "2020-05-04",
    mcu: "Fit",
    komp: [],
    status: "aktif",
  },
  {
    nik: "OPS-0111",
    name: "Joko Prasetyo",
    company: UDU,
    dept: "Operation",
    pos: "Driver OHT",
    equip: "HD785-7",
    join: "2019-11-20",
    mcu: "Fit",
    komp: [{ jenis: "BII", exp: "2026-06-30", egis: SIMPER_MASTER["BII"] }],
    status: "aktif",
  },
  {
    nik: "OPS-0290",
    name: "Dewi Anggraini",
    company: UDU,
    dept: "SDI",
    pos: "Dispatcher",
    join: "2022-09-01",
    mcu: "Fit",
    komp: [],
    status: "aktif",
  },
  {
    nik: "OPS-0367",
    name: "Hendra Gunawan",
    company: UDU,
    dept: "Operation",
    pos: "Operator Dozer",
    equip: "D375A-6",
    join: "2021-02-08",
    mcu: "Fit",
    komp: [
      { jenis: "KIMPER", exp: "2027-01-22", egis: SIMPER_MASTER["KIMPER"] },
    ],
    status: "cuti",
  },
  {
    nik: "OPS-0455",
    name: "Fitri Handayani",
    company: UDU,
    dept: "Operation",
    pos: "Checker",
    join: "2023-06-12",
    mcu: "Fit",
    komp: [],
    status: "aktif",
  },
  {
    nik: "OPS-0129",
    name: "Agus Salim",
    company: UDU,
    dept: "Plant",
    pos: "Mekanik",
    join: "2018-04-02",
    mcu: "Fit",
    komp: [
      { jenis: "KIMPER", exp: "2027-05-08", egis: SIMPER_MASTER["KIMPER"] },
    ],
    status: "aktif",
  },
  {
    nik: "OPS-0602",
    name: "Rina Marlina",
    company: UDU,
    dept: "SDI",
    pos: "Safety Officer",
    join: "2020-10-19",
    mcu: "Fit",
    komp: [],
    status: "nonaktif",
  },
];

export function findEmployee(nik: string): Employee | undefined {
  return EMPLOYEES.find((e) => e.nik === nik);
}
