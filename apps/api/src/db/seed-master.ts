/**
 * The master catalogues, the timeline, the running texts, and the sample fleet.
 *
 * Transcribed from the static modules the web app rendered before this change
 * (`lib/unit-data.ts`, `lib/area-data.ts`, `lib/departemen-data.ts`,
 * `lib/display-data.ts`), so a migrated installation looks exactly as it did.
 *
 * Two different postures, deliberately (design D14):
 *
 * - **Catalogues, stages, and running texts** are genuine reference data for
 *   the site — five departments, twenty-three work areas, eight unit classes —
 *   and are seeded idempotently by name. Re-running adds what is missing and
 *   touches nothing that exists, matching the role seed.
 * - **The fifteen units** are sample records with invented serial numbers, and
 *   seeding one of those into a production database is not right. They are
 *   guarded on the table being *empty* rather than on per-row absence, so a
 *   database that has ever held a real unit can never receive a sample one —
 *   even if every sample code happens to be free.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import type {
  BloodType,
  EmployeeStatus,
  McuResult,
  ShiftKind,
  TimelineAction,
} from "@universe/contracts";

import { db, schema, type NamedCatalogue } from "./index";

/* --------------------------------------------------------------- catalogues */

const UNIT_TYPES = ["EXCAVATOR", "WHEEL EXCAVATOR", "RIGID", "DUMPTRUCK"];

const UNIT_MODELS = [
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

const UNIT_BRANDS = ["HITACHI", "SANY", "CATERPILLAR"];

const MESS = ["Mess A", "Mess B", "Mess C"];

const UNIT_CLASSES: [name: string, description: string][] = [
  ["BIGDIGGER", "Excavator besar (250T)"],
  ["MEDIUMDIGGER", "Excavator sedang (80T)"],
  ["SMALLDIGGER", "Excavator kecil (40T)"],
  ["WHEEL EXCAVATOR", "Excavator roda (20T)"],
  ["DUMPTRUCKCAT100T", "Rigid dump truck 100T"],
  ["DUMPTRUCK60T", "Rigid dump truck 60T"],
  ["DUMPTRUCK40T", "Dump truck 40T"],
  ["DUMPTRUCK30T", "Dump truck 30T"],
];

/** Permit type — may this person operate at all. Two values, and only two. */
const SIMPER_TYPES: [name: string, description: string][] = [
  ["F", "Full permit"],
  ["P", "Probation"],
];

/**
 * Qualification codes — which units a person may operate.
 *
 * These were derived with `SELECT DISTINCT` over a free-text unit column, which
 * meant the catalogue's contents were a consequence of what someone typed into
 * a form. They are a catalogue in their own right now (design D4).
 */
const SIMPER_CODES: [name: string, description: string][] = [
  ["EXC 2600", "Excavator Hitachi EX2600 / EX2000"],
  ["EXC ZX870", "Excavator Hitachi ZX870"],
  ["EXC ZX470", "Excavator Hitachi ZX470"],
  ["OHT 777", "Off-highway truck Caterpillar 777"],
  ["OHT 773", "Off-highway truck Caterpillar 773"],
  ["DT R12", "Dump truck Sany SYZ440C"],
  ["DT R10", "Dump truck Sany SYZ320C"],
];

/* ------------------------------------------------------------ organisation */

/**
 * Company → department → position → headcount, as one tree.
 *
 * Written as a tree rather than as three flat lists because that is what the
 * schema now says it is, and because the three used to drift: a department
 * belonged to nobody, a position belonged to nowhere, and the only thing tying
 * an employee's company to their department was that whoever typed the row
 * happened to pick a matching pair.
 *
 * Reading it top to bottom is also the order it has to be written in — a
 * department needs its company's id, a position its department's, an employee
 * all three — so the seed walks this once rather than making three passes and
 * looking names back up.
 */
type PositionSeed = {
  name: string;
  description: string;
  /**
   * How many employees to create for this position.
   *
   * Never below two: a position with one holder cannot demonstrate anything
   * that depends on there being a crew — a roster with a stand-in, a spare to
   * allocate, a revision for one person while another keeps their shift.
   */
  headcount: number;
  /** Whether this position operates a unit, and so carries a permit. */
  operator?: boolean;
  /** The qualification codes an operator in this position holds. */
  skills?: string[];
};

type DepartmentSeed = {
  name: string;
  description: string;
  positions: PositionSeed[];
};

type CompanySeed = {
  code: string;
  name: string;
  description: string;
  /** Where this company's accounts get their email addresses. */
  domain: string;
  departments: DepartmentSeed[];
};

/** Every department carries one, because every department needs an account. */
const ADMIN_POSITION: PositionSeed = {
  name: "ADMIN",
  description: "Administrasi departemen",
  headcount: 2,
};

/**
 * The two posts the cross-cutting roles are filled from.
 *
 * `manpower` and `medic` reach every department in every company, but a role's
 * reach is its *scope* — it does not make the holder a person without a desk.
 * Somebody configures the fleet boards and somebody staffs the clinic, and both
 * are filed where that work sits: manpower planning under HRM, the site clinic
 * under General Affair. Their scope is what crosses the organisation; their
 * employment does not have to.
 *
 * Appended to their departments rather than inserted, so the seeded NIKs of
 * everyone already in those departments do not shift — a NIK in yesterday's
 * screenshot should still name the same person.
 */
const MANPOWER_POSITION: PositionSeed = {
  name: "MANPOWER OFFICER",
  description: "Perencanaan tenaga kerja dan konfigurasi operasional",
  headcount: 2,
};

const PARAMEDIC_POSITION: PositionSeed = {
  name: "PARAMEDIC",
  description: "Klinik site dan pemeriksaan fit to work",
  headcount: 2,
};

export const ORGANISATION: CompanySeed[] = [
  {
    code: "UDU",
    name: "PT UNGGUL DINAMIKA UTAMA",
    description: "Kontraktor penambangan",
    domain: "ungguldinamika.co.id",
    departments: [
      {
        name: "MINING OPERATION",
        description: "Operasi penambangan — produksi harian",
        positions: [
          ADMIN_POSITION,
          {
            name: "DISPATCHER",
            description: "Pengatur alokasi unit",
            headcount: 3,
          },
          {
            name: "GROUP LEADER",
            description: "Pimpinan grup shift",
            headcount: 4,
          },
          {
            name: "OPERATOR DUMP TRUCK",
            description: "Operator dump truck produksi",
            headcount: 30,
            operator: true,
            skills: ["OHT 777", "OHT 773"],
          },
          {
            name: "OPERATOR EXCAVATOR",
            description: "Operator alat gali",
            headcount: 12,
            operator: true,
            skills: ["EXC 2600", "EXC ZX870"],
          },
        ],
      },
      {
        name: "PIT SERVICE AND DEVELOPMENT",
        description: "Layanan pit dan pengembangan front",
        positions: [
          ADMIN_POSITION,
          {
            name: "FOREMAN PIT SERVICE",
            description: "Pengawas layanan pit",
            headcount: 2,
          },
          {
            name: "OPERATOR WATER TRUCK",
            description: "Operator penyiraman jalan hauling",
            headcount: 4,
            operator: true,
            skills: ["DT R12"],
          },
          { name: "CHECKER", description: "Pemeriksa lapangan", headcount: 2 },
        ],
      },
      {
        name: "EARTHWORKS & INFRAS",
        description: "Pekerjaan tanah dan infrastruktur site",
        positions: [
          ADMIN_POSITION,
          {
            name: "SURVEYOR",
            description: "Pengukuran dan pemetaan",
            headcount: 2,
          },
          {
            name: "OPERATOR DOZER",
            description: "Operator bulldozer",
            headcount: 4,
            operator: true,
            skills: ["EXC ZX470"],
          },
          {
            name: "FOREMAN EARTHWORKS",
            description: "Pengawas pekerjaan tanah",
            headcount: 2,
          },
        ],
      },
      {
        name: "HRM",
        description: "Human Resource Management",
        positions: [
          ADMIN_POSITION,
          {
            name: "RECRUITMENT OFFICER",
            description: "Rekrutmen dan seleksi",
            headcount: 2,
          },
          {
            name: "PAYROLL OFFICER",
            description: "Penggajian dan benefit",
            headcount: 2,
          },
          MANPOWER_POSITION,
        ],
      },
      {
        name: "SUPPLY CHAIN MANAGEMENT",
        description: "Pengadaan, gudang, dan logistik",
        positions: [
          ADMIN_POSITION,
          {
            name: "WAREHOUSE OFFICER",
            description: "Pengelolaan gudang",
            headcount: 3,
          },
          {
            name: "PURCHASING OFFICER",
            description: "Pengadaan barang dan jasa",
            headcount: 2,
          },
        ],
      },
      {
        name: "GENERAL AFFAIR",
        description: "Sarana, mess, dan keamanan site",
        positions: [
          ADMIN_POSITION,
          {
            name: "SECURITY OFFICER",
            description: "Keamanan site",
            headcount: 4,
          },
          {
            name: "MESS OFFICER",
            description: "Pengelolaan mess dan katering",
            headcount: 2,
          },
          PARAMEDIC_POSITION,
        ],
      },
      {
        name: "SYSTEM DEVELOPMENT AND INTEGRATION",
        description: "Pengembangan sistem dan integrasi teknologi",
        positions: [
          ADMIN_POSITION,
          {
            name: "PROGRAMMER DEVELOPMENT OFFICER",
            description: "Pengembangan aplikasi internal",
            headcount: 3,
          },
          {
            name: "IT FMS TECHNICIAN OFFICER",
            description: "Teknisi fleet management system",
            headcount: 3,
          },
          {
            name: "IT TECHNICIAN NETWORK & ERP",
            description: "Jaringan dan dukungan ERP",
            headcount: 2,
          },
        ],
      },
      {
        name: "COST CONTROL AND COMMERCIAL",
        description: "Pengendalian biaya dan komersial",
        positions: [
          ADMIN_POSITION,
          {
            name: "COST CONTROL OFFICER",
            description: "Pengendalian biaya operasi",
            headcount: 2,
          },
          {
            name: "COMMERCIAL ANALYST",
            description: "Analisa komersial dan kontrak",
            headcount: 2,
          },
        ],
      },
    ],
  },
  {
    code: "RBS",
    name: "PT REZEKI BORNEO SEBUKU",
    description: "Kontraktor penambangan — site Sebuku",
    domain: "rezekiborneo.co.id",
    departments: [
      {
        name: "MINING OPERATION",
        description: "Operasi penambangan — produksi harian",
        positions: [
          ADMIN_POSITION,
          {
            name: "DISPATCHER",
            description: "Pengatur alokasi unit",
            headcount: 2,
          },
          {
            name: "OPERATOR DUMP TRUCK",
            description: "Operator dump truck produksi",
            headcount: 16,
            operator: true,
            skills: ["DT R12", "DT R10"],
          },
          {
            name: "OPERATOR EXCAVATOR",
            description: "Operator alat gali",
            headcount: 6,
            operator: true,
            skills: ["EXC ZX870", "EXC ZX470"],
          },
        ],
      },
      {
        name: "PLANT AND MAINTENANCE",
        description: "Perawatan dan perbaikan alat",
        positions: [
          ADMIN_POSITION,
          {
            name: "MEKANIK",
            description: "Perawatan alat berat",
            headcount: 4,
          },
          {
            name: "TYRE MAN",
            description: "Perawatan ban alat berat",
            headcount: 2,
          },
        ],
      },
      {
        name: "HRM",
        description: "Human Resource Management",
        positions: [
          ADMIN_POSITION,
          { name: "HR OFFICER", description: "Kepegawaian site", headcount: 2 },
          MANPOWER_POSITION,
        ],
      },
      {
        name: "SUPPLY CHAIN MANAGEMENT",
        description: "Pengadaan dan gudang",
        positions: [
          ADMIN_POSITION,
          {
            name: "WAREHOUSE OFFICER",
            description: "Pengelolaan gudang",
            headcount: 2,
          },
        ],
      },
      {
        name: "GENERAL AFFAIR",
        description: "Sarana, mess, dan keamanan site",
        positions: [
          ADMIN_POSITION,
          {
            name: "SECURITY OFFICER",
            description: "Keamanan site",
            headcount: 3,
          },
          PARAMEDIC_POSITION,
        ],
      },
      {
        name: "HSE",
        description: "Health, Safety & Environment",
        positions: [
          ADMIN_POSITION,
          {
            name: "SAFETY OFFICER",
            description: "Keselamatan kerja",
            headcount: 3,
          },
        ],
      },
    ],
  },
];

/**
 * The department the sample fleet belongs to.
 *
 * Units key on a department, and `MINING OPERATION` now exists under both
 * companies — so a lookup by name alone would resolve to whichever row the
 * query happened to return first. The operating contractor owns the fleet.
 */
const FLEET_COMPANY = "UDU";

/* -------------------------------------------------- allocation & display */

// The agreed morning sequence: each ingest stage starts at its deadline and
// re-pulls for a bounded window; everything must be done before the bus.
/**
 * The schedule, both halves of it.
 *
 * FTW and fingerprint are required on the night shift as well as the day one
 * (owner, 2026-08-29), so the morning's six stages have a mirror twelve hours
 * later. The night rows are not a copy for symmetry's sake: without an
 * afternoon ingest, a night worker's 15:00 FTW upload and 17:00 tap are not
 * pulled until the *next* morning's run, roughly fourteen hours after the
 * night board needs them.
 *
 * Nothing in `scheduler.ts` changes to support this. Stages are claimed per
 * row (`stage:${id}:${date}`), so a second row carrying the same action fires
 * on its own, and both ingest hooks are idempotent upserts.
 */
const TIMELINE_STAGES: [
  name: string,
  at: string,
  action: TimelineAction,
  shift: ShiftKind,
][] = [
  ["Batas Upload FTW", "04:45", "ftw-deadline", "day"],
  ["Ambil Data FTW", "04:45", "ftw-ingest", "day"],
  ["Batas Finger In", "05:15", "finger-in", "day"],
  ["Ambil Data Finger", "05:15", "finger-ingest", "day"],
  ["Validasi Spare", "05:25", "spare-validate", "day"],
  ["Bus Berangkat", "05:30", "bus-depart", "day"],

  ["Batas Upload FTW Malam", "16:45", "ftw-deadline", "night"],
  ["Ambil Data FTW Malam", "16:45", "ftw-ingest", "night"],
  ["Batas Finger In Malam", "17:15", "finger-in", "night"],
  ["Ambil Data Finger Malam", "17:15", "finger-ingest", "night"],
  ["Validasi Spare Malam", "17:25", "spare-validate", "night"],
  ["Bus Berangkat Malam", "17:30", "bus-depart", "night"],
];

const RUN_TEXTS: [text: string, color: string][] = [
  ["Selamat datang di UNIVERSE", "Cyan"],
  ["Utamakan keselamatan kerja", "Oranye"],
];

/**
 * The fingerprint machines on site, as supplied by the owner (2026-08-27).
 *
 * Real operational data rather than sample rows, which is why this seeds like
 * the timeline (insert what is missing) and not like the sample fleet (only
 * into an empty table): a site that already registered its machines keeps
 * every rename and re-IP, and a machine added to this list later still lands.
 *
 * They span three subnets — 179.x at KM 31, 150.x across the workshops, port
 * and messes, and 109.x for FAS/TF.
 */
const FINGERPRINT_MACHINES: [name: string, ip: string][] = [
  ["MESIN 2 PORT (STOCKPILE)", "192.168.150.118"],
  ["MAIN OFFICE", "192.168.150.166"],
  ["MESIN 21 KM 31", "192.168.179.237"],
  ["MESIN 20 KM 31", "192.168.179.232"],
  ["MESIN 2 WORKSHOP MAINTENANCE", "192.168.150.163"],
  ["MESIN 22 KM 31", "192.168.179.213"],
  ["MESIN 3 KM 31", "192.168.179.228"],
  ["MESIN 2 KM 31", "192.168.179.201"],
  ["MESS KM13 - 2", "192.168.150.86"],
  ["MESS KM13 - 1", "192.168.150.88"],
  ["MESIN 9 KM 31", "192.168.179.248"],
  ["MESIN 5 KM 31", "192.168.179.227"],
  ["MESIN 40 KM 31", "192.168.179.243"],
  ["MESIN 38 KM 31", "192.168.179.244"],
  ["MESIN 37 KM 31", "192.168.179.219"],
  ["MESIN 29 KM 31", "192.168.179.242"],
  ["MESIN 28 KM 31", "192.168.179.216"],
  ["MESIN 24 KM 31", "192.168.179.214"],
  ["MESIN 23 KM 31", "192.168.179.238"],
  ["MESIN 2 CHIPSEAL", "192.168.150.224"],
  ["MESIN 19 KM 31", "192.168.179.208"],
  ["MESIN 15 KM 31", "192.168.179.210"],
  ["MESIN 14 KM 31", "192.168.179.57"],
  ["MESIN 1 WORKSHOP MAINTENANCE", "192.168.150.162"],
  ["MESIN 1 WAREHOUSE SCM", "192.168.150.161"],
  ["MESIN 3 WORKSHOP MAINTENANCE", "192.168.179.51"],
  ["MESIN 1 PORT (WORKSHOP)", "192.168.150.230"],
  ["MESIN 1 KM 31", "192.168.179.229"],
  ["MESIN FINGER OFFICE FMS", "192.168.179.250"],
  ["MESIN 4 WORKSHOP MAINTENANCE", "192.168.179.54"],
  ["MESIN 12 KM 31", "192.168.179.236"],
  ["MESIN 27 KM 31", "192.168.179.241"],
  ["MESIN 26 KM 31", "192.168.179.215"],
  ["MESIN 25 KM 31", "192.168.179.239"],
  ["MESIN 1 CHIPSEAL", "192.168.150.87"],
  ["MAINTANK PORT", "192.168.179.252"],
  ["MESIN 36 KM 31", "192.168.179.245"],
  ["MESIN 35 KM 31", "192.168.179.223"],
  ["MESIN 34 KM 31", "192.168.179.246"],
  ["MESIN 8 KM 31", "192.168.179.235"],
  ["MESIN 7 KM 31", "192.168.179.220"],
  ["MESIN 6 KM 31", "192.168.179.205"],
  ["MESIN 13 KM 31", "192.168.179.211"],
  ["MESIN 11 KM 31", "192.168.179.212"],
  ["MESIN 10 KM 31", "192.168.179.207"],
  ["MESIN 5 WORKSHOP MAINTENANCE", "192.168.179.55"],
  ["MESIN 4 KM 31", "192.168.179.202"],
  ["MESIN 39 KM 31", "192.168.179.226"],
  ["MESIN 18 KM 31", "192.168.179.233"],
  ["MESIN 17 KM 31", "192.168.179.209"],
  ["MESIN 16 KM 31", "192.168.179.234"],
  ["MESIN 33 KM 31", "192.168.179.224"],
  ["MESIN 32 KM 31", "192.168.179.247"],
  ["MESIN 31 KM 31", "192.168.179.225"],
  ["MESIN 30 KM 31", "192.168.179.217"],
  ["MESIN 3 CHIPSEAL (OFFICE)", "192.168.150.227"],
  ["FAS", "192.168.109.26"],
  ["TF", "192.168.109.25"],
];

/* ------------------------------------------------------------ sample fleet */

type UnitSeed = {
  code: string;
  cls: string;
  type: string;
  model: string;
  brand: string;
  /** Empty means no qualification requirement — a real state, not a gap. */
  simper: string;
  department: string;
  serial: string;
  engineBrand: string;
  description: string;
  ftw: boolean;
};

const UNITS: UnitSeed[] = [
  {
    code: "EX8001",
    cls: "BIGDIGGER",
    type: "EXCAVATOR",
    model: "EX2600-7BH",
    brand: "HITACHI",
    simper: "EXC 2600",
    department: "MINING OPERATION",
    serial: "KEA90E00007046",
    engineBrand: "CUMMINS",
    description: "EXCAVATOR250T",
    ftw: false,
  },
  {
    code: "EX7001",
    cls: "BIGDIGGER",
    type: "EXCAVATOR",
    model: "EX2000-7BH",
    brand: "HITACHI",
    simper: "EXC 2600",
    department: "MINING OPERATION",
    serial: "HCMKDA90H00007002",
    engineBrand: "CUMMINS",
    description: "EXCAVATOR200T",
    ftw: false,
  },
  {
    code: "EX5001",
    cls: "MEDIUMDIGGER",
    type: "EXCAVATOR",
    model: "ZX870LCH-5G",
    brand: "HITACHI",
    simper: "EXC ZX870",
    department: "MINING OPERATION",
    serial: "HCMJBE93E00051019",
    engineBrand: "ISUZU-6WG1-XQA",
    description: "EXCAVATOR80T,HITACHIZX870-LCH",
    ftw: false,
  },
  {
    code: "EX5002",
    cls: "MEDIUMDIGGER",
    type: "EXCAVATOR",
    model: "ZX870LCH-5G",
    brand: "HITACHI",
    simper: "EXC ZX870",
    department: "MINING OPERATION",
    serial: "HCMJBE93E00051103",
    engineBrand: "ISUZU-6WG1-XQA",
    description: "EXCAVATOR80T,HITACHIZX870-LCH",
    ftw: false,
  },
  {
    code: "EX4001",
    cls: "SMALLDIGGER",
    type: "EXCAVATOR",
    model: "ZX470LC-5G",
    brand: "HITACHI",
    simper: "EXC ZX470",
    department: "MINING OPERATION",
    serial: "JACE1L00200077",
    engineBrand: "ISUZU",
    description: "EXCAVATOR40T",
    ftw: false,
  },
  {
    code: "EX4002",
    cls: "SMALLDIGGER",
    type: "EXCAVATOR",
    model: "ZX470LC-5G",
    brand: "HITACHI",
    simper: "EXC ZX470",
    department: "MINING OPERATION",
    serial: "JACE1V00200139",
    engineBrand: "ISUZU",
    description: "EXCAVATOR40T",
    ftw: false,
  },
  {
    code: "WE2004",
    cls: "WHEEL EXCAVATOR",
    type: "WHEEL EXCAVATOR",
    model: "SY215W",
    brand: "SANY",
    simper: "",
    department: "PIT SERVICE AND DEVELOPMENT",
    serial: "SY021CF0090K8",
    engineBrand: "4HK1",
    description: "WHEELEXCAVATOR20T",
    ftw: false,
  },
  {
    code: "RD5001",
    cls: "DUMPTRUCKCAT100T",
    type: "RIGID",
    model: "777E",
    brand: "CATERPILLAR",
    simper: "OHT 777",
    department: "MINING OPERATION",
    serial: "KYD00379",
    engineBrand: "CAT",
    description: "DUMPTRUCK100T",
    ftw: true,
  },
  {
    code: "RD5002",
    cls: "DUMPTRUCKCAT100T",
    type: "RIGID",
    model: "777E",
    brand: "CATERPILLAR",
    simper: "OHT 777",
    department: "MINING OPERATION",
    serial: "KYD00380",
    engineBrand: "CAT",
    description: "DUMPTRUCK100T",
    ftw: true,
  },
  {
    code: "RD4001",
    cls: "DUMPTRUCK60T",
    type: "RIGID",
    model: "773E",
    brand: "CATERPILLAR",
    simper: "OHT 773",
    department: "MINING OPERATION",
    serial: "PRB00688",
    engineBrand: "CAT",
    description: "DUMPTRUCK60T",
    ftw: true,
  },
  {
    code: "RD4002",
    cls: "DUMPTRUCK60T",
    type: "RIGID",
    model: "773E",
    brand: "CATERPILLAR",
    simper: "OHT 773",
    department: "MINING OPERATION",
    serial: "PRB00743",
    engineBrand: "CAT",
    description: "DUMPTRUCK60T",
    ftw: true,
  },
  {
    code: "DT4017",
    cls: "DUMPTRUCK40T",
    type: "DUMPTRUCK",
    model: "SYZ440C",
    brand: "SANY",
    simper: "DT R12",
    department: "MINING OPERATION",
    serial: "LFCDKG7PON1021232",
    engineBrand: "WEIICHAI",
    description: "DUMPTRUCK40TSANYSYZ440C-8W®",
    ftw: true,
  },
  {
    code: "DT4018",
    cls: "DUMPTRUCK40T",
    type: "DUMPTRUCK",
    model: "SYZ440C",
    brand: "SANY",
    simper: "DT R12",
    department: "MINING OPERATION",
    serial: "LFCDKG7P9N1021732",
    engineBrand: "WEIICHAI",
    description: "DUMPTRUCK40TSANYSYZ440C-8W®",
    ftw: true,
  },
  {
    code: "DT3013",
    cls: "DUMPTRUCK30T",
    type: "DUMPTRUCK",
    model: "SYZ320C-8W(R)",
    brand: "SANY",
    simper: "DT R10",
    department: "PIT SERVICE AND DEVELOPMENT",
    serial: "LFCDHB7P4P1044869",
    engineBrand: "WEIICHAI",
    description: "DUMPTRUCK30TSANYSYZ320C-8W®",
    ftw: true,
  },
  {
    code: "DT3014",
    cls: "DUMPTRUCK30T",
    type: "DUMPTRUCK",
    model: "SYZ320C-8W(R)",
    brand: "SANY",
    simper: "DT R10",
    department: "PIT SERVICE AND DEVELOPMENT",
    serial: "LFCDHB7P8P1044939",
    engineBrand: "WEIICHAI",
    description: "DUMPTRUCK30TSANYSYZ320C-8W®",
    ftw: true,
  },
];

/* ------------------------------------------------------- sample workforce */

/**
 * The workforce is generated from `ORGANISATION`, not listed.
 *
 * The ten hand-written people this replaced were transcribed from the static
 * web module, and they could not answer the question the roster asks: a
 * department with three people has no roster worth looking at, and a position
 * with one holder cannot show a shift being covered. Every position now gets at
 * least two, and the mining operators get a crew large enough that a month's
 * grid is a real grid.
 *
 * Generated, but not random. Every field is a pure function of the person's
 * index, so two runs of the seed produce the same register down to the NIK —
 * which is what lets a screenshot, a bug report, or a test that names a NIK
 * still mean something tomorrow.
 */

/**
 * Name parts, combined by index rather than drawn.
 *
 * Forty by thirty is twelve hundred distinct combinations, and the workforce is
 * a fraction of that — so `personName` never repeats within a seed, and a NIK
 * and a name stay in step across runs.
 */
const FIRST_NAMES = [
  "Adi",
  "Agus",
  "Ahmad",
  "Andi",
  "Anton",
  "Arif",
  "Bagus",
  "Bambang",
  "Budi",
  "Cahyo",
  "Dedi",
  "Dimas",
  "Eko",
  "Fajar",
  "Firman",
  "Gunawan",
  "Hadi",
  "Hendra",
  "Ilham",
  "Irfan",
  "Joko",
  "Kurnia",
  "Lukman",
  "Marwan",
  "Nanda",
  "Oki",
  "Panji",
  "Rahmat",
  "Reza",
  "Rudi",
  "Samsul",
  "Slamet",
  "Taufik",
  "Umar",
  "Wahyu",
  "Yudi",
  "Zainal",
  "Bayu",
  "Candra",
  "Dwi",
];

const LAST_NAMES = [
  "Santoso",
  "Wijaya",
  "Hartono",
  "Lestari",
  "Prasetyo",
  "Anggraini",
  "Gunawan",
  "Handayani",
  "Salim",
  "Marlina",
  "Nugroho",
  "Setiawan",
  "Kusuma",
  "Pratama",
  "Ramadhan",
  "Siregar",
  "Simanjuntak",
  "Butar",
  "Maulana",
  "Hidayat",
  "Saputra",
  "Permana",
  "Wibowo",
  "Susanto",
  "Purnama",
  "Yulianto",
  "Firmansyah",
  "Rahayu",
  "Utami",
  "Syahputra",
];

const pad = (n: number, width: number) => String(n).padStart(width, "0");

const personName = (i: number) =>
  `${FIRST_NAMES[i % FIRST_NAMES.length]!} ` +
  `${LAST_NAMES[Math.floor(i / FIRST_NAMES.length) % LAST_NAMES.length]!}`;

/**
 * One planned person: everything the register needs, plus what the account
 * seed needs to find them again.
 */
export type PersonPlan = {
  nik: string;
  name: string;
  companyCode: string;
  companyName: string;
  companyDomain: string;
  department: string;
  position: string;
  /** The one holder of this department's ADMIN post who gets an account. */
  departmentAdmin: boolean;
  joinDate: string;
  simperType: string;
  simperNo: string;
  simperExp: string;
  skills: string[];
  license: string;
  mcu: McuResult;
  mcuExp: string;
  blood: BloodType;
  medical: string;
  mess: string;
  block: string;
  room: string;
  phone: string;
  emergency: string;
  status: EmployeeStatus;
};

const BLOODS: BloodType[] = ["A", "B", "AB", "O"];
const MESSES = ["Mess A", "Mess B", "Mess C"];

/**
 * The whole register, in the order it will be written.
 *
 * The NIK encodes where a person sits — `5`, company, department, sequence —
 * which is not how a real payroll number is built, but it makes a seeded NIK
 * readable at a glance while debugging, and guarantees uniqueness without a
 * lookup.
 */
export function workforce(): PersonPlan[] {
  const people: PersonPlan[] = [];
  let n = 0;

  ORGANISATION.forEach((company, ci) => {
    company.departments.forEach((department, di) => {
      let seq = 0;
      for (const position of department.positions) {
        for (let k = 0; k < position.headcount; k++) {
          seq += 1;
          const i = n++;
          const operator = position.operator === true;
          const year = 2018 + (i % 8);

          people.push({
            nik: `5${ci + 1}${pad(di + 1, 2)}${pad(seq, 4)}`,
            name: personName(i),
            companyCode: company.code,
            companyName: company.name,
            companyDomain: company.domain,
            department: department.name,
            position: position.name,
            departmentAdmin: position === ADMIN_POSITION && k === 0,
            joinDate: `${year}-${pad((i % 12) + 1, 2)}-${pad((i % 28) + 1, 2)}`,
            // Only someone who operates a unit carries a permit; an office
            // record with an invented SIMPER number is a record that would
            // fail the first audit it met.
            simperType: operator ? (i % 7 === 0 ? "P" : "F") : "",
            simperNo: operator
              ? `${i % 7 === 0 ? "P" : "F"}-${year}-${pad(i, 4)}`
              : "",
            simperExp: operator ? `${year + 5}-${pad((i % 12) + 1, 2)}-15` : "",
            skills: operator ? (position.skills ?? []) : [],
            license: operator ? "SIM BII Umum" : "",
            mcu: i % 11 === 0 ? "Fit dengan catatan" : "Fit",
            mcuExp: `${2026 + (i % 2)}-${pad((i % 12) + 1, 2)}-20`,
            blood: BLOODS[i % BLOODS.length]!,
            medical: i % 11 === 0 ? "Hipertensi ringan" : "",
            mess: operator ? MESSES[i % MESSES.length]! : "",
            block: operator ? `Blok ${(i % 4) + 1}` : "",
            room: operator
              ? `${String.fromCharCode(65 + (i % 3))}-${pad((i % 40) + 1, 2)}`
              : "",
            phone: `08${pad(12 + (i % 80), 2)}-${pad(1000 + i, 4)}-${pad(2000 + i * 3, 4)}`,
            emergency: "",
            // Everyone active. A roster is a plan for people who work, and a
            // seeded `nonaktif` would quietly shrink every template by one
            // without saying why.
            status: "aktif",
          });
        }
      }
    });
  });

  return people;
}

/* -------------------------------------------------------------------------- */

/**
 * Insert what is missing and leave what is there.
 *
 * `ON CONFLICT DO NOTHING` untargeted rather than aimed at a named constraint:
 * the uniqueness these tables carry is an expression index over `lower(name)`,
 * which is not nameable as a conflict target in the same breath as the column.
 * Every one of these tables has exactly one unique index, so "any conflict" and
 * "a duplicate name" are the same statement here.
 */
async function seedNamed(
  label: string,
  table: NamedCatalogue,
  values: Record<string, unknown>[]
): Promise<void> {
  const inserted = await db
    .insert(table)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: table.id });
  console.log(
    `  ${label} — ${inserted.length} created, ${values.length - inserted.length} already present`
  );
}

/** name → id, keyed lowercase so a lookup matches the way the index does. */
async function idsByName(table: NamedCatalogue): Promise<Map<string, string>> {
  const rows = (await db
    .select({ id: table.id, name: table.name })
    .from(table)) as { id: string; name: string }[];
  return new Map(rows.map((r) => [r.name.toLowerCase(), r.id]));
}

async function seedCatalogues(): Promise<OrganisationIds> {
  await seedNamed(
    "jenis unit",
    schema.unitTypes,
    UNIT_TYPES.map((name) => ({ name }))
  );
  await seedNamed(
    "model unit",
    schema.unitModels,
    UNIT_MODELS.map((name) => ({ name }))
  );
  await seedNamed(
    "merk unit",
    schema.unitBrands,
    UNIT_BRANDS.map((name) => ({ name }))
  );
  await seedNamed(
    "mess",
    schema.mess,
    MESS.map((name) => ({ name }))
  );
  await seedNamed(
    "kelas unit",
    schema.unitClasses,
    UNIT_CLASSES.map(([name, description]) => ({ name, description }))
  );
  await seedNamed(
    "simper",
    schema.simperTypes,
    SIMPER_TYPES.map(([name, description]) => ({ name, description }))
  );
  await seedNamed(
    "kode simper",
    schema.simperCodes,
    SIMPER_CODES.map(([name, description]) => ({ name, description }))
  );
  return seedOrganisation();
}

/* ----------------------------------------------------------- organisation */

/** Where a department or a position sits, resolved once and looked up by key. */
export type OrganisationIds = {
  /** `UDU` → company id. */
  companyByCode: Map<string, string>;
  /** `UDU|mining operation` → department id. */
  departmentByKey: Map<string, string>;
  /** `<department id>|admin` → position id. */
  positionByKey: Map<string, string>;
};

export const departmentKey = (companyCode: string, department: string) =>
  `${companyCode}|${department.toLowerCase()}`;

const positionKey = (departmentId: string, position: string) =>
  `${departmentId}|${position.toLowerCase()}`;

/**
 * Companies, then their departments, then their positions — in that order,
 * because each level needs the one above it to exist first.
 *
 * The lookups are keyed on the parent as well as the name, mirroring the unique
 * indexes: `MINING OPERATION` now names two different departments, and a map
 * keyed on the name alone would silently hand back whichever was written last.
 */
async function seedOrganisation(): Promise<OrganisationIds> {
  const companyByCode = new Map<string, string>();
  const departmentByKey = new Map<string, string>();
  const positionByKey = new Map<string, string>();

  let departments = 0;
  let positions = 0;

  for (const company of ORGANISATION) {
    const [row] = await db
      .insert(schema.companies)
      .values({
        code: company.code,
        name: company.name,
        description: company.description,
      })
      .onConflictDoNothing()
      .returning({ id: schema.companies.id });

    const companyId =
      row?.id ??
      (
        await db
          .select({ id: schema.companies.id })
          .from(schema.companies)
          .where(
            sql`lower(${schema.companies.code}) = ${company.code.toLowerCase()}`
          )
          .limit(1)
      )[0]!.id;
    companyByCode.set(company.code, companyId);

    for (const department of company.departments) {
      const [made] = await db
        .insert(schema.departments)
        .values({
          companyId,
          name: department.name,
          description: department.description,
        })
        .onConflictDoNothing()
        .returning({ id: schema.departments.id });

      const departmentId =
        made?.id ??
        (
          await db
            .select({ id: schema.departments.id })
            .from(schema.departments)
            .where(
              and(
                eq(schema.departments.companyId, companyId),
                sql`lower(${schema.departments.name}) = ${department.name.toLowerCase()}`
              )
            )
            .limit(1)
        )[0]!.id;
      if (made) departments += 1;
      departmentByKey.set(
        departmentKey(company.code, department.name),
        departmentId
      );

      for (const position of department.positions) {
        const [created] = await db
          .insert(schema.positions)
          .values({
            departmentId,
            name: position.name,
            description: position.description,
            // The same flag that decides whether these people carry a permit:
            // a position that operates a unit is a position the allocation
            // engine draws from, and stating it twice would be two things to
            // keep true.
            fleetAllocation: position.operator === true,
          })
          .onConflictDoNothing()
          .returning({ id: schema.positions.id });

        const positionId =
          created?.id ??
          (
            await db
              .select({ id: schema.positions.id })
              .from(schema.positions)
              .where(
                and(
                  eq(schema.positions.departmentId, departmentId),
                  sql`lower(${schema.positions.name}) = ${position.name.toLowerCase()}`
                )
              )
              .limit(1)
          )[0]!.id;
        if (created) positions += 1;
        positionByKey.set(positionKey(departmentId, position.name), positionId);
      }
    }
  }

  console.log(
    `  perusahaan — ${ORGANISATION.length}, departemen — ${departments} created, ` +
      `jabatan — ${positions} created`
  );
  return { companyByCode, departmentByKey, positionByKey };
}

/**
 * Stages and running texts carry no unique index — two stages may legitimately
 * share a name, and two tickers a text — so idempotence is a read-then-insert
 * rather than an upsert. That is safe here because the seed is the only writer
 * that ever runs against an empty database.
 */
async function seedSchedule(): Promise<void> {
  const stages = await db
    .select({ name: schema.timelineStages.name })
    .from(schema.timelineStages);
  const known = new Set(stages.map((s) => s.name.toLowerCase()));
  const missing = TIMELINE_STAGES.filter(
    ([name]) => !known.has(name.toLowerCase())
  );
  if (missing.length)
    await db.insert(schema.timelineStages).values(
      missing.map(([name, at, action, shift]) => ({
        name,
        // Postgres `time` wants seconds; the schedule is specified to the minute.
        at: `${at}:00`,
        action,
        shift,
      }))
    );
  console.log(
    `  timeline — ${missing.length} created, ${TIMELINE_STAGES.length - missing.length} already present`
  );

  const texts = await db
    .select({ text: schema.runTexts.text })
    .from(schema.runTexts);
  const knownTexts = new Set(texts.map((t) => t.text.toLowerCase()));
  const missingTexts = RUN_TEXTS.filter(
    ([text]) => !knownTexts.has(text.toLowerCase())
  );
  if (missingTexts.length)
    await db
      .insert(schema.runTexts)
      .values(missingTexts.map(([text, color]) => ({ text, color })));
  console.log(
    `  running text — ${missingTexts.length} created, ` +
      `${RUN_TEXTS.length - missingTexts.length} already present`
  );
}

/**
 * The fingerprint machine registry.
 *
 * Keyed on IP, not name: the address is the machine's identity here (it is
 * what the prober dials and what the table's unique constraint enforces), so a
 * machine an operator renamed on the registry screen is still recognised as
 * present and is not inserted a second time under its seeded name.
 */
async function seedFingerprintMachines(): Promise<void> {
  const rows = await db
    .select({ ip: schema.fingerprintMachines.ip })
    .from(schema.fingerprintMachines);
  const known = new Set(rows.map((r) => r.ip));
  const missing = FINGERPRINT_MACHINES.filter(([, ip]) => !known.has(ip));
  if (missing.length)
    await db
      .insert(schema.fingerprintMachines)
      .values(missing.map(([name, ip]) => ({ name, ip })));
  console.log(
    `  mesin fingerprint — ${missing.length} created, ` +
      `${FINGERPRINT_MACHINES.length - missing.length} already present`
  );
}

/**
 * The sample fleet, and only into an empty table (design D14).
 *
 * The guard is emptiness rather than per-code absence on purpose: a production
 * database that once held units must never receive a sample one, and checking
 * "is EX8001 free?" would happily insert fifteen invented serial numbers into a
 * site whose own units are all named differently.
 */
async function seedUnits(organisation: OrganisationIds): Promise<void> {
  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.units);
  if (count > 0) {
    console.log(`  units — ${count} already present, sample fleet skipped`);
    return;
  }

  const [classes, types, models, brands, codes] = await Promise.all([
    idsByName(schema.unitClasses),
    idsByName(schema.unitTypes),
    idsByName(schema.unitModels),
    idsByName(schema.unitBrands),
    idsByName(schema.simperCodes),
  ]);

  const resolve = (map: Map<string, string>, name: string, what: string) => {
    const id = map.get(name.toLowerCase());
    if (!id)
      throw new Error(
        `Sample unit references ${what} "${name}", which the catalogue seed did not create`
      );
    return id;
  };

  /** Company-qualified, because two companies now run a `MINING OPERATION`. */
  const department = (name: string) => {
    const id = organisation.departmentByKey.get(
      departmentKey(FLEET_COMPANY, name)
    );
    if (!id)
      throw new Error(
        `Sample unit references department "${name}" under ${FLEET_COMPANY}, which the organisation seed did not create`
      );
    return id;
  };

  await db.insert(schema.units).values(
    UNITS.map((u) => ({
      code: u.code,
      classId: resolve(classes, u.cls, "unit class"),
      typeId: resolve(types, u.type, "unit type"),
      modelId: resolve(models, u.model, "unit model"),
      brandId: resolve(brands, u.brand, "unit brand"),
      simperCodeId: u.simper
        ? resolve(codes, u.simper, "simper code")
        : undefined,
      departmentId: department(u.department),
      serial: u.serial,
      engineBrand: u.engineBrand,
      description: u.description,
      ftw: u.ftw,
    }))
  );
  console.log(`  units — ${UNITS.length} sample units created`);
}

/**
 * The two sample fleets of the static port, over the sample units above.
 *
 * Composition only — which digger leads which haulers where. Codes rather
 * than ids, resolved at insert, exactly as the units resolve their catalogue
 * names.
 */
const SAMPLE_FLEETS: { digger: string; area: string; units: string[] }[] = [
  {
    digger: "EX8001",
    area: "Panel East Puncak Utara",
    units: ["RD5001", "RD5002", "RD4001", "RD4002"],
  },
  {
    digger: "EX7001",
    area: "Disposal T4",
    units: ["DT4017", "DT4018", "DT3013"],
  },
];

/**
 * Sample fleets, and only into an empty table — the same guard as the units.
 *
 * One extra out: the fleets are compositions *over the sample units*, so if
 * those units are absent (a site running its own fleet skipped the sample
 * seed), the fleets are skipped with a note rather than thrown over —
 * missing sample data is not an error the way a missing catalogue row is.
 */
async function seedFleets(): Promise<void> {
  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.fleets);
  if (count > 0) {
    console.log(`  fleets — ${count} already present, sample fleets skipped`);
    return;
  }

  const codes = SAMPLE_FLEETS.flatMap((f) => [f.digger, ...f.units]);
  const units = await db
    .select({ id: schema.units.id, code: schema.units.code })
    .from(schema.units)
    .where(inArray(schema.units.code, codes));
  const unitByCode = new Map(units.map((u) => [u.code, u.id]));

  for (const fleet of SAMPLE_FLEETS) {
    const diggerId = unitByCode.get(fleet.digger);
    const memberIds = fleet.units.map((c) => unitByCode.get(c));
    if (!diggerId || memberIds.some((id) => !id)) {
      console.log(
        `  fleets — sample units for Fleet ${fleet.digger} not present, skipped`
      );
      continue;
    }
    const [row] = await db
      .insert(schema.fleets)
      .values({ diggerUnitId: diggerId, workArea: fleet.area })
      .returning({ id: schema.fleets.id });
    await db.insert(schema.fleetUnits).values(
      (memberIds as string[]).map((unitId) => ({
        fleetId: row!.id,
        unitId,
      }))
    );
    console.log(
      `  fleets — Fleet ${fleet.digger} created with ${fleet.units.length} units`
    );
  }
}

/**
 * The sample workforce, and only into an empty table (design D13).
 *
 * The same guard as the sample fleet, for the same reason: a database that has
 * ever held a real employee must never receive an invented one, and checking
 * "is this NIK free?" would happily insert a hundred and sixty strangers into a
 * site whose own people are numbered differently. `db:seed:fresh` is the door
 * out of this guard, and it is a door somebody has to open on purpose.
 */
async function seedEmployees(organisation: OrganisationIds): Promise<void> {
  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.employees);
  if (count > 0) {
    console.log(`  employees — ${count} already present, sample crew skipped`);
    return;
  }

  const [messes, simperTypes, simperCodes] = await Promise.all([
    idsByName(schema.mess),
    idsByName(schema.simperTypes),
    idsByName(schema.simperCodes),
  ]);

  const resolve = (map: Map<string, string>, name: string, what: string) => {
    const id = map.get(name.toLowerCase());
    if (!id)
      throw new Error(
        `Sample employee references ${what} "${name}", which the catalogue seed did not create`
      );
    return id;
  };

  const people = workforce();

  const values = people.map((e) => {
    const companyId = organisation.companyByCode.get(e.companyCode)!;
    const departmentId = organisation.departmentByKey.get(
      departmentKey(e.companyCode, e.department)
    )!;
    const positionId = organisation.positionByKey.get(
      `${departmentId}|${e.position.toLowerCase()}`
    )!;
    return {
      nik: e.nik,
      name: e.name,
      companyId,
      departmentId,
      positionId,
      messId: e.mess ? resolve(messes, e.mess, "mess") : null,
      simperTypeId: e.simperType
        ? resolve(simperTypes, e.simperType, "simper type")
        : null,
      joinDate: e.joinDate || null,
      license: e.license,
      simperNo: e.simperNo,
      simperExp: e.simperExp || null,
      mcu: e.mcu,
      mcuExp: e.mcuExp || null,
      blood: e.blood,
      medical: e.medical,
      block: e.block,
      room: e.room,
      phone: e.phone,
      emergency: e.emergency,
      status: e.status,
    };
  });

  // Sliced for the same reason the roster's day inserts are: Postgres caps the
  // parameters one statement may carry, and this is a hundred and sixty rows of
  // twenty columns.
  const rows: { id: string; nik: string }[] = [];
  for (let i = 0; i < values.length; i += 200)
    rows.push(
      ...(await db
        .insert(schema.employees)
        .values(values.slice(i, i + 200))
        .returning({ id: schema.employees.id, nik: schema.employees.nik }))
    );

  const idByNik = new Map(rows.map((r) => [r.nik, r.id]));
  const skills = people.flatMap((e) =>
    e.skills.map((code) => ({
      employeeId: idByNik.get(e.nik)!,
      simperCodeId: resolve(simperCodes, code, "simper code"),
    }))
  );
  for (let i = 0; i < skills.length; i += 200)
    await db.insert(schema.employeeSkills).values(skills.slice(i, i + 200));

  console.log(
    `  employees — ${people.length} sample employees created, ` +
      `${skills.length} skill assignments`
  );
}

export async function seedMasterData(): Promise<OrganisationIds> {
  console.log("[seed] master catalogues");
  const organisation = await seedCatalogues();

  console.log("[seed] timeline & running text");
  await seedSchedule();

  console.log("[seed] fingerprint machines");
  await seedFingerprintMachines();

  console.log("[seed] sample fleet");
  await seedUnits(organisation);
  await seedFleets();

  console.log("[seed] sample workforce");
  await seedEmployees(organisation);

  return organisation;
}
