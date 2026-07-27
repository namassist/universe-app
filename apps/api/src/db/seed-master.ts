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

import { sql } from "drizzle-orm";
import type { AreaType, TimelineAction } from "@universe/contracts";

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

const DEPARTMENTS: [name: string, description: string][] = [
  ["Mining Operation", "Operasi penambangan"],
  ["Pit Service", "Layanan pit"],
  ["Plant", "Perawatan alat"],
  ["SDI", "Sumber Daya Insani"],
  ["HRGA", "HR & General Affairs"],
];

const WORK_AREAS: [name: string, type: AreaType][] = [
  ["Panel East Puncak Utara", "Mining"],
  ["Panel East Puncak Selatan", "Mining"],
  ["Panel East Tengah", "Mining"],
  ["Panel East Bawah", "Mining"],
  ["Kasturi Puncak", "Mining"],
  ["Kasturi Tengah", "Mining"],
  ["Kasturi Bawah", "Mining"],
  ["High Dump", "Mining"],
  ["Low Wall", "Mining"],
  ["Ambalat", "Mining"],
  ["Mandalika", "Mining"],
  ["Disposal T4", "Mining"],
  ["CPP33", "Non Mining"],
  ["Workshop", "Non Mining"],
  ["Pondok Kontainer", "Non Mining"],
  ["V Point", "Non Mining"],
  ["Parkiran T6", "Non Mining"],
  ["Parkiran Sebatik", "Non Mining"],
  ["Parkiran Panel East", "Non Mining"],
  ["Stock Room T6", "Non Mining"],
  ["Readyline", "Non Mining"],
  ["Bank Soil", "Mining"],
  ["Parkiran Wash Bay", "Non Mining"],
];

/* -------------------------------------------------- allocation & display */

const TIMELINE_STAGES: [name: string, at: string, action: TimelineAction][] = [
  ["Batas Upload FTW", "04:45", "ftw-deadline"],
  ["Batas Finger In", "05:20", "finger-in"],
  ["Ambil Data Finger", "05:21", "finger-ingest"],
  ["Validasi Spare", "05:25", "spare-validate"],
  ["Bus Berangkat", "05:30", "bus-depart"],
];

const RUN_TEXTS: [text: string, color: string][] = [
  ["Selamat datang di UNIVERSE", "Cyan"],
  ["Utamakan keselamatan kerja", "Oranye"],
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
    department: "Mining Operation",
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
    department: "Mining Operation",
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
    department: "Mining Operation",
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
    department: "Mining Operation",
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
    department: "Mining Operation",
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
    department: "Mining Operation",
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
    department: "Pit Service",
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
    department: "Mining Operation",
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
    department: "Mining Operation",
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
    department: "Mining Operation",
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
    department: "Mining Operation",
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
    department: "Mining Operation",
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
    department: "Mining Operation",
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
    department: "Pit Service",
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
    department: "Pit Service",
    serial: "LFCDHB7P8P1044939",
    engineBrand: "WEIICHAI",
    description: "DUMPTRUCK30TSANYSYZ320C-8W®",
    ftw: true,
  },
];

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

async function seedCatalogues(): Promise<void> {
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
  await seedNamed(
    "departemen",
    schema.departments,
    DEPARTMENTS.map(([name, description]) => ({ name, description }))
  );
  await seedNamed(
    "area kerja",
    schema.workAreas,
    WORK_AREAS.map(([name, type]) => ({ name, type }))
  );
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
      missing.map(([name, at, action]) => ({
        name,
        // Postgres `time` wants seconds; the schedule is specified to the minute.
        at: `${at}:00`,
        action,
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
 * The sample fleet, and only into an empty table (design D14).
 *
 * The guard is emptiness rather than per-code absence on purpose: a production
 * database that once held units must never receive a sample one, and checking
 * "is EX8001 free?" would happily insert fifteen invented serial numbers into a
 * site whose own units are all named differently.
 */
async function seedUnits(): Promise<void> {
  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.units);
  if (count > 0) {
    console.log(`  units — ${count} already present, sample fleet skipped`);
    return;
  }

  const [classes, types, models, brands, codes, departments] =
    await Promise.all([
      idsByName(schema.unitClasses),
      idsByName(schema.unitTypes),
      idsByName(schema.unitModels),
      idsByName(schema.unitBrands),
      idsByName(schema.simperCodes),
      idsByName(schema.departments),
    ]);

  const resolve = (map: Map<string, string>, name: string, what: string) => {
    const id = map.get(name.toLowerCase());
    if (!id)
      throw new Error(
        `Sample unit references ${what} "${name}", which the catalogue seed did not create`
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
      departmentId: resolve(departments, u.department, "department"),
      serial: u.serial,
      engineBrand: u.engineBrand,
      description: u.description,
      ftw: u.ftw,
    }))
  );
  console.log(`  units — ${UNITS.length} sample units created`);
}

export async function seedMasterData(): Promise<void> {
  console.log("[seed] master catalogues");
  await seedCatalogues();

  console.log("[seed] timeline & running text");
  await seedSchedule();

  console.log("[seed] sample fleet");
  await seedUnits();
}
