/**
 * Static master-data unit — shared between the list menu (`database-unit`)
 * and the add/edit form pages (`unit-form`). Faithful sample content, no
 * persistence (mutations are toast-only, like the employees module).
 */

import { DEPARTEMEN_NAMES } from "./departemen-data";

export type Unit = {
  uid: string;
  code: string; // kode unit (ID Number)
  cls: string; // kelas unit (grup Excel)
  egiType: string; // jenis unit (Unit)
  egi: string; // model unit (Machine Model)
  product: string; // merk / make
  simper: string; // kode simper (teks, hanya di unit)
  departemen: string; // departemen
  serial: string; // machine S/N
  engineBrand: string; // engine brand
  description: string; // description (spek, dari Excel)
  ftw: boolean; // Savera Watch → FTW (terpisah dari status)
  active: boolean;
  standby?: boolean;
  breakdown?: boolean;
};

export const CLS_OPTS = [
  "BIGDIGGER",
  "MEDIUMDIGGER",
  "SMALLDIGGER",
  "WHEEL EXCAVATOR",
  "DUMPTRUCKCAT100T",
  "DUMPTRUCK60T",
  "DUMPTRUCK40T",
  "DUMPTRUCK30T",
];
export const MODEL_OPTS = [
  "EX2600-7BH",
  "EX2000-7BH",
  "ZX870LCH-5G",
  "ZX470LC-5G",
  "SY215W",
  "777E",
  "773E",
  "SYZ440C",
  "SYZ320C-8W(R)",
];
export const EGI_OPTS = ["EXCAVATOR", "WHEEL EXCAVATOR", "RIGID", "DUMPTRUCK"];
export const PROD_OPTS = ["HITACHI", "SANY", "CATERPILLAR"];
/* departemen: satu sumber bersama dgn karyawan & master (lib/departemen-data) */
export const DEPT_OPTS = DEPARTEMEN_NAMES;

export const UNITS: Unit[] = [
  {
    uid: "u1",
    code: "EX8001",
    cls: "BIGDIGGER",
    egiType: "EXCAVATOR",
    egi: "EX2600-7BH",
    product: "HITACHI",
    simper: "EXC 2600",
    departemen: "Mining Operation",
    serial: "KEA90E00007046",
    engineBrand: "CUMMINS",
    description: "EXCAVATOR250T",
    ftw: false,
    active: true,
  },
  {
    uid: "u2",
    code: "EX7001",
    cls: "BIGDIGGER",
    egiType: "EXCAVATOR",
    egi: "EX2000-7BH",
    product: "HITACHI",
    simper: "EXC 2600",
    departemen: "Mining Operation",
    serial: "HCMKDA90H00007002",
    engineBrand: "CUMMINS",
    description: "EXCAVATOR200T",
    ftw: false,
    active: true,
  },
  {
    uid: "u3",
    code: "EX5001",
    cls: "MEDIUMDIGGER",
    egiType: "EXCAVATOR",
    egi: "ZX870LCH-5G",
    product: "HITACHI",
    simper: "EXC ZX870",
    departemen: "Mining Operation",
    serial: "HCMJBE93E00051019",
    engineBrand: "ISUZU-6WG1-XQA",
    description: "EXCAVATOR80T,HITACHIZX870-LCH",
    ftw: false,
    active: true,
  },
  {
    uid: "u4",
    code: "EX5002",
    cls: "MEDIUMDIGGER",
    egiType: "EXCAVATOR",
    egi: "ZX870LCH-5G",
    product: "HITACHI",
    simper: "EXC ZX870",
    departemen: "Mining Operation",
    serial: "HCMJBE93E00051103",
    engineBrand: "ISUZU-6WG1-XQA",
    description: "EXCAVATOR80T,HITACHIZX870-LCH",
    ftw: false,
    active: true,
  },
  {
    uid: "u5",
    code: "EX4001",
    cls: "SMALLDIGGER",
    egiType: "EXCAVATOR",
    egi: "ZX470LC-5G",
    product: "HITACHI",
    simper: "EXC ZX470",
    departemen: "Mining Operation",
    serial: "JACE1L00200077",
    engineBrand: "ISUZU",
    description: "EXCAVATOR40T",
    ftw: false,
    active: true,
  },
  {
    uid: "u6",
    code: "EX4002",
    cls: "SMALLDIGGER",
    egiType: "EXCAVATOR",
    egi: "ZX470LC-5G",
    product: "HITACHI",
    simper: "EXC ZX470",
    departemen: "Mining Operation",
    serial: "JACE1V00200139",
    engineBrand: "ISUZU",
    description: "EXCAVATOR40T",
    ftw: false,
    active: true,
  },
  {
    uid: "u7",
    code: "WE2004",
    cls: "WHEEL EXCAVATOR",
    egiType: "WHEEL EXCAVATOR",
    egi: "SY215W",
    product: "SANY",
    simper: "",
    departemen: "Pit Service",
    serial: "SY021CF0090K8",
    engineBrand: "4HK1",
    description: "WHEELEXCAVATOR20T",
    ftw: false,
    active: true,
  },
  {
    uid: "u8",
    code: "RD5001",
    cls: "DUMPTRUCKCAT100T",
    egiType: "RIGID",
    egi: "777E",
    product: "CATERPILLAR",
    simper: "OHT 777",
    departemen: "Mining Operation",
    serial: "KYD00379",
    engineBrand: "CAT",
    description: "DUMPTRUCK100T",
    ftw: true,
    active: true,
  },
  {
    uid: "u9",
    code: "RD5002",
    cls: "DUMPTRUCKCAT100T",
    egiType: "RIGID",
    egi: "777E",
    product: "CATERPILLAR",
    simper: "OHT 777",
    departemen: "Mining Operation",
    serial: "KYD00380",
    engineBrand: "CAT",
    description: "DUMPTRUCK100T",
    ftw: true,
    active: true,
  },
  {
    uid: "u10",
    code: "RD4001",
    cls: "DUMPTRUCK60T",
    egiType: "RIGID",
    egi: "773E",
    product: "CATERPILLAR",
    simper: "OHT 773",
    departemen: "Mining Operation",
    serial: "PRB00688",
    engineBrand: "CAT",
    description: "DUMPTRUCK60T",
    ftw: true,
    active: true,
  },
  {
    uid: "u11",
    code: "RD4002",
    cls: "DUMPTRUCK60T",
    egiType: "RIGID",
    egi: "773E",
    product: "CATERPILLAR",
    simper: "OHT 773",
    departemen: "Mining Operation",
    serial: "PRB00743",
    engineBrand: "CAT",
    description: "DUMPTRUCK60T",
    ftw: true,
    active: true,
  },
  {
    uid: "u12",
    code: "DT4017",
    cls: "DUMPTRUCK40T",
    egiType: "DUMPTRUCK",
    egi: "SYZ440C",
    product: "SANY",
    simper: "DT R12",
    departemen: "Mining Operation",
    serial: "LFCDKG7PON1021232",
    engineBrand: "WEIICHAI",
    description: "DUMPTRUCK40TSANYSYZ440C-8W®",
    ftw: true,
    active: true,
  },
  {
    uid: "u13",
    code: "DT4018",
    cls: "DUMPTRUCK40T",
    egiType: "DUMPTRUCK",
    egi: "SYZ440C",
    product: "SANY",
    simper: "DT R12",
    departemen: "Mining Operation",
    serial: "LFCDKG7P9N1021732",
    engineBrand: "WEIICHAI",
    description: "DUMPTRUCK40TSANYSYZ440C-8W®",
    ftw: true,
    active: true,
  },
  {
    uid: "u14",
    code: "DT3013",
    cls: "DUMPTRUCK30T",
    egiType: "DUMPTRUCK",
    egi: "SYZ320C-8W(R)",
    product: "SANY",
    simper: "DT R10",
    departemen: "Pit Service",
    serial: "LFCDHB7P4P1044869",
    engineBrand: "WEIICHAI",
    description: "DUMPTRUCK30TSANYSYZ320C-8W®",
    ftw: true,
    active: true,
  },
  {
    uid: "u15",
    code: "DT3014",
    cls: "DUMPTRUCK30T",
    egiType: "DUMPTRUCK",
    egi: "SYZ320C-8W(R)",
    product: "SANY",
    simper: "DT R10",
    departemen: "Pit Service",
    serial: "LFCDHB7P8P1044939",
    engineBrand: "WEIICHAI",
    description: "DUMPTRUCK30TSANYSYZ320C-8W®",
    ftw: true,
    active: true,
  },
];

export function findUnit(code: string): Unit | undefined {
  return UNITS.find((u) => u.code === code);
}

/** Label tipe unit ringkas: "model · merk". */
export const unitTypeLabel = (u: Unit): string => `${u.egi} · ${u.product}`;

/** Kelas yang dianggap digger (fleet leader). */
export const DIGGER_CLASSES = ["BIGDIGGER", "MEDIUMDIGGER", "SMALLDIGGER"];

/** Digger = jenis EXCAVATOR atau kelas BIGDIGGER/MEDIUMDIGGER/SMALLDIGGER. */
export const isDigger = (u: Unit): boolean =>
  u.egiType === "EXCAVATOR" || DIGGER_CLASSES.includes(u.cls);

/** Unit digger (kandidat fleet leader). */
export const DIGGER_UNITS = UNITS.filter(isDigger);
/** Unit non-digger (kandidat anggota fleet / hauler). */
export const FLEET_MEMBER_UNITS = UNITS.filter((u) => !isDigger(u));
/** Unit berjenis BUS (kode bus fleet) — belum ada sampai unit BUS ditambahkan. */
export const BUS_UNITS = UNITS.filter((u) => u.egiType === "BUS");

/**
 * Distinct non-empty unit `simper` codes — the "skill" catalogue an operator
 * can be qualified against (e.g. "EXC 2600", "OHT 777"). Derived from UNITS so
 * it stays in sync with the fleet.
 */
export const SIMPER_CODES = Array.from(
  new Set(UNITS.map((u) => u.simper).filter(Boolean))
);
