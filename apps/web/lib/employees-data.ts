/**
 * Static sample employees — shared by the list, detail, and edit pages so the
 * same person looks identical everywhere. Data-only module, no state.
 */

export type Simper = {
  kategori: string; // F (Full permit) / P (Probation) — dari master SIMPER
  nomor: string;
  exp: string;
  skills: string[]; // kode_simper unit yang dikuasai (multi)
};
export type EmpStatus = "aktif" | "cuti" | "nonaktif";
export type Employee = {
  nik: string;
  name: string;
  company: string;
  dept: string;
  pos: string;
  join?: string;
  license?: string;
  /* medis (ringkas) */
  mcu?: string;
  mcuExp?: string; // MCU berlaku s/d
  blood?: string;
  medis?: string; // riwayat penyakit
  /* mess & kontak */
  mess?: string;
  kamar?: string;
  hp?: string;
  emg?: string;
  simper?: Simper; // satu SIMPER per karyawan (opsional)
  status: EmpStatus;
};

const UDU = "PT Unggul Dinamika Utama";

/* Master SIMPER (statis): tipe F/P */
export const SIMPER_TYPES = [
  { kode: "F", nama: "Full permit" },
  { kode: "P", nama: "Probation" },
];
export const SIMPER_LABEL: Record<string, string> = Object.fromEntries(
  SIMPER_TYPES.map((s) => [s.kode, s.nama])
);

export const MESS_OPTS = [
  "Mess A — Blok 1",
  "Mess A — Blok 2",
  "Mess B — Blok 1",
];

export const EMPLOYEES: Employee[] = [
  {
    nik: "503220421",
    name: "Budi Santoso",
    company: UDU,
    dept: "Mining Operation",
    pos: "Driver OHT",
    join: "2022-03-01",
    license: "SIM BII Umum",
    mcu: "Fit",
    mcuExp: "2027-01-15",
    blood: "O",
    medis: "—",
    mess: "Mess A — Blok 1",
    kamar: "A-12",
    hp: "0812-3456-7890",
    emg: "Siti Santoso (istri) — 0813-1111-2222",
    simper: {
      kategori: "F",
      nomor: "F-2022-0421",
      exp: "2027-03-14",
      skills: ["OHT 777", "OHT 773"],
    },
    status: "aktif",
  },
  {
    nik: "508210388",
    name: "Andi Wijaya",
    company: UDU,
    dept: "Mining Operation",
    pos: "Operator Excavator",
    join: "2021-08-15",
    mcu: "Fit dengan catatan",
    mcuExp: "2026-09-30",
    blood: "B",
    medis: "Hipertensi ringan",
    mess: "Mess A — Blok 2",
    kamar: "A-27",
    simper: {
      kategori: "F",
      nomor: "F-2021-0388",
      exp: "2026-08-02",
      skills: ["EXC 2600", "EXC ZX870"],
    },
    status: "aktif",
  },
  {
    nik: "501230510",
    name: "Rudi Hartono",
    company: UDU,
    dept: "Mining Operation",
    pos: "Driver OHT",
    join: "2023-01-10",
    mcu: "Fit",
    mcuExp: "2027-03-01",
    blood: "A",
    simper: {
      kategori: "P",
      nomor: "P-2023-0510",
      exp: "2026-07-18",
      skills: ["OHT 773"],
    },
    status: "aktif",
  },
  {
    nik: "505200233",
    name: "Sari Lestari",
    company: UDU,
    dept: "HRGA",
    pos: "Admin Site",
    join: "2020-05-04",
    mcu: "Fit",
    mcuExp: "2027-02-20",
    blood: "O",
    status: "aktif",
  },
  {
    nik: "511190111",
    name: "Joko Prasetyo",
    company: UDU,
    dept: "Mining Operation",
    pos: "Driver OHT",
    join: "2019-11-20",
    mcu: "Fit",
    mcuExp: "2026-12-10",
    blood: "AB",
    simper: {
      kategori: "F",
      nomor: "F-2019-0111",
      exp: "2026-06-30",
      skills: ["OHT 777"],
    },
    status: "aktif",
  },
  {
    nik: "509220290",
    name: "Dewi Anggraini",
    company: UDU,
    dept: "SDI",
    pos: "Dispatcher",
    join: "2022-09-01",
    mcu: "Fit",
    mcuExp: "2027-04-05",
    blood: "B",
    status: "aktif",
  },
  {
    nik: "502210367",
    name: "Hendra Gunawan",
    company: UDU,
    dept: "Mining Operation",
    pos: "Operator Excavator",
    join: "2021-02-08",
    mcu: "Fit",
    mcuExp: "2026-11-22",
    blood: "O",
    simper: {
      kategori: "F",
      nomor: "F-2021-0367",
      exp: "2027-01-22",
      skills: ["EXC ZX470"],
    },
    status: "cuti",
  },
  {
    nik: "506230455",
    name: "Fitri Handayani",
    company: UDU,
    dept: "Mining Operation",
    pos: "Checker",
    join: "2023-06-12",
    mcu: "Fit",
    mcuExp: "2027-05-30",
    blood: "A",
    status: "aktif",
  },
  {
    nik: "504180129",
    name: "Agus Salim",
    company: UDU,
    dept: "Plant",
    pos: "Mekanik",
    join: "2018-04-02",
    mcu: "Fit",
    mcuExp: "2027-03-18",
    blood: "B",
    simper: {
      kategori: "F",
      nomor: "F-2018-0129",
      exp: "2027-05-08",
      skills: ["DT R12", "DT R10"],
    },
    status: "aktif",
  },
  {
    nik: "510200602",
    name: "Rina Marlina",
    company: UDU,
    dept: "SDI",
    pos: "Safety Officer",
    join: "2020-10-19",
    mcu: "Fit",
    mcuExp: "2026-10-19",
    blood: "O",
    status: "nonaktif",
  },
];

export function findEmployee(nik: string): Employee | undefined {
  return EMPLOYEES.find((e) => e.nik === nik);
}
