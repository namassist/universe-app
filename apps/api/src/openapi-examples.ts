/**
 * Real values in the committed OpenAPI document (`integrations/openapi.ts`).
 *
 * Elysia publishes a response's shape and nothing of its content, so a
 * viewer drew every example as `{ "unit": "" }` and a reader had to find the
 * backend to learn that `status` is `holder` or `spare`. Here every field of
 * every success gets an `example` drawn from what the API really sends, and
 * every field with a closed set of values says what they are:
 *
 * - an `enum` (`t.UnionEnum`) lists its own members in the description;
 * - a free string fed by a closed source names its values from that source:
 *   savera's FTW categories and decisions (`readiness.ts`), the roster codes,
 *   the employee statuses, the board's own refusal sentences.
 *
 * A field is found by `parent.name` first, then by `name`, `parent` being the
 * object or array it sits in. A field with no example fails
 * `openapi-examples.test.ts`, so a new one cannot ship as `""`.
 */

import {
  BLOOD_TYPES,
  EMPLOYEE_STATUSES,
  MCU_RESULTS,
  NO_FTW_READING_LABEL,
  ROSTER_CODES,
} from "@universe/contracts";

import { KNOWN_CATEGORIES, KNOWN_DECISIONS } from "./readiness";

type Json = Record<string, unknown>;

type FieldDoc = {
  example: unknown;
  /** The closed set of values a string field can carry. */
  values?: readonly string[];
  /** Said beside the values, for a set that is not closed or needs a key. */
  note?: string;
};

/** savera's words as it spells them; `readiness.ts` compares them lowercased. */
const titleCase = (words: string) =>
  words.replace(/\b\w+/g, (w) =>
    w === "ftw" ? "FTW" : w.charAt(0).toUpperCase() + w.slice(1)
  );
export const FTW_CATEGORIES = [...KNOWN_CATEGORIES].map(titleCase);
export const FTW_DECISIONS = [...KNOWN_DECISIONS].map(titleCase);

const UNIT_CATEGORY_NOTE =
  "A unit type from master data, or an excavator's class (`BIGDIGGER`, `MEDIUMDIGGER`, `SMALLDIGGER`, `WHEELDIGGER`); `TANPA KATEGORI` for an operator with none.";

const ROSTER: FieldDoc = {
  example: "D",
  values: ROSTER_CODES,
  note: "`D` day shift, `N` night shift; every other code means not on a shift.",
};
const FTW_CATEGORY: FieldDoc = {
  example: "Dapat Bekerja",
  values: FTW_CATEGORIES,
  note: "savera's sleep category; only `Dapat Bekerja` passes. Compared without regard to case.",
};
const FTW_DECISION: FieldDoc = {
  example: "FTW Aman",
  values: FTW_DECISIONS,
  note: "savera's decision; only `FTW Aman` passes. Compared without regard to case.",
};
/** A report's FTW cell: savera's category, or one of the report's own. */
const REPORT_FTW_CELL: FieldDoc = {
  example: "Istirahat Minimal 1 Jam",
  values: [...FTW_CATEGORIES, NO_FTW_READING_LABEL],
  note: "On Operator No FTW also `Terlambat FTW (HH:MM)` for an upload after the deadline, or savera's decision when it gave no category.",
};
const REFUSAL: FieldDoc = {
  example: 'Tidak punya SIMPER "OHT 100T"',
  values: [
    "Karyawan berstatus <status> — hanya karyawan aktif yang masuk alokasi",
    'Posisi "<position>" tidak masuk alokasi fleet',
    'Beda departemen — unit ini milik "<department>"',
    'Tidak punya SIMPER "<simper code>"',
    "SIMPER kedaluwarsa <YYYY-MM-DD>",
  ],
  note: "The board's own sentence, shown as it is (`pairingRefusal`); `<…>` is filled in.",
};

const ISO = "2026-11-09T05:26:00.000Z";
const LOCAL_STAMP = "2026-11-09 04:41:12";
const DATE = "2026-11-09";

const UUID = {
  employee: "5b1d2c3e-8f4a-4b6c-9d0e-1f2a3b4c5d6e",
  user: "0e9c8b7a-6d5e-4f3a-8b2c-1d0e9f8a7b6c",
  unit: "7c6b5a49-3827-4615-a403-f2e1d0c9b8a7",
  role: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  generic: "3f2a8c1e-4b5d-4e6f-9a0b-1c2d3e4f5a6b",
};

export const FIELDS: Record<string, FieldDoc> = {
  /* Identity */
  nik: { example: "506264337" },
  name: { example: "Budi Santoso" },
  email: { example: "budi.santoso@ungguldinamika.co.id" },
  phone: { example: "081234567890" },
  emergency: { example: "Siti (istri) 081298765432" },
  id: { example: UUID.generic },
  employeeId: { example: UUID.employee },
  "principal.id": { example: UUID.user },
  "users.id": { example: UUID.user },
  roleId: { example: UUID.role },
  "principal.roleId": {
    example: UUID.role,
    note: "The session's active role, the one permissions and scope answer to. Login and switch-role take one the account holds (else 403 `role_not_held`).",
  },
  roleIds: {
    example: [UUID.role],
    note: "Every role the account holds, the default `roleId` among them.",
  },
  roles: {
    example: [{ id: UUID.role, name: "User", scope: "self" }],
    note: "Every role the account holds, default first. Offer a choice when there is more than one; switch with `POST /v1/auth/switch-role`.",
  },
  unitId: { example: UUID.unit },
  companyId: { example: UUID.generic },
  departmentId: { example: UUID.generic },
  positionId: { example: UUID.generic },
  messId: { example: UUID.generic },
  simperTypeId: { example: UUID.generic },
  uploadedById: { example: UUID.user },
  sessionId: { example: "s_9fK2xQ7mLp4tR8vW1yZ3" },
  roleName: {
    example: "User",
    note: "A role's display name, set on the Roles screen (`User`, `Pengawas Lapangan`, `Superadmin`, …). Choose screens from `permissions`, never from this.",
  },
  "skills.id": { example: UUID.generic },
  "skills.name": { example: "OHT 100T" },
  "skills.description": { example: "Dump truck, Water truck" },
  skills: { example: "OHT 100T" },

  /* Organisation */
  company: { example: "PT Universe Mining" },
  companyName: { example: "PT Universe Mining" },
  department: { example: "MINING OPERATION" },
  departmentName: { example: "MINING OPERATION" },
  "department.id": { example: UUID.generic },
  "department.name": { example: "MINING OPERATION" },
  position: { example: "Operator OHT" },
  positionName: { example: "Operator OHT" },
  positions: { example: "Operator OHT" },
  mess: { example: "Mess A" },
  messName: { example: "Mess A" },
  block: { example: "B" },
  room: { example: "12" },
  "data.company": { example: "PT Universe Mining" },
  "data.department": { example: "MINING OPERATION" },
  "data.position": { example: "Operator OHT" },
  "data.name": { example: "Budi Santoso" },
  "data.nik": { example: "506264337" },
  "data.skills": { example: "OHT 100T" },
  "data.status": { example: "aktif", values: EMPLOYEE_STATUSES },
  status: { example: "aktif", values: EMPLOYEE_STATUSES },
  joinDate: { example: "2021-03-15" },

  /* Licences and health */
  license: { example: "SIM B2 Umum" },
  simper: { example: "OHT 100T" },
  simperNo: { example: "SMP-2024-00871" },
  simperExp: { example: "2027-03-31" },
  simperCode: { example: "OHT 100T" },
  simperMatrix: { example: "OHT 100T; DT 30T" },
  simperTypeName: { example: "SIMPER Permanen" },
  mcu: { example: "Fit", values: MCU_RESULTS },
  mcuExp: { example: "2027-01-20" },
  blood: { example: "O", values: BLOOD_TYPES },
  medical: { example: "Tidak ada" },

  /* Units and the board */
  unit: { example: "DT4023" },
  unitCode: { example: "DT4023" },
  planUnit: { example: "DT4023" },
  code: { example: "DT4023" },
  leaderCode: { example: "EX1203" },
  fleet: { example: "EX1203" },
  area: { example: "PIT 3 SELATAN" },
  unitArea: { example: "PIT 3 SELATAN" },
  location: { example: "PIT 3 SELATAN" },
  bus: { example: "BUS 07" },
  busCode: { example: "BUS 07" },
  className: {
    example: "REARDUMP100T",
    note: "A unit class from master data; empty on the spare wall.",
  },
  modelName: { example: "HD785-7" },
  brandName: { example: "Komatsu" },
  breakdownCodes: { example: "DT4023" },
  employeeName: { example: "Budi Santoso" },
  employeeNik: { example: "506264337" },
  employeePhotoFile: { example: "506264337.jpg" },
  deviceName: { example: "TV Fleet Pos 1" },
  "fleets.id": { example: UUID.generic },
  "equipment.unitClass": {
    example: "REARDUMP100T",
    note: "A unit class from master data.",
  },
  "operators.category": { example: "OHT", note: UNIT_CATEGORY_NOTE },
  "spares.category": { example: "OHT", note: UNIT_CATEGORY_NOTE },
  "resting.category": { example: "OHT", note: UNIT_CATEGORY_NOTE },
  refusal: REFUSAL,
  "unitStatus.at": { example: "2026-11-09T05:33:00.000Z" },
  "withdrawn.at": { example: "2026-11-09T05:35:00.000Z" },
  "withdrawn.slipPrintedAt": { example: "2026-11-09T05:06:00.000Z" },
  "withdrawn.unit": { example: "DT4023" },
  "seat.placedAt": { example: "2026-11-09T05:41:00.000Z" },
  boardAt: { example: "2026-11-09T05:26:00.000Z" },

  /* Shift, roster and readiness */
  date: { example: DATE },
  month: { example: "2026-11-01" },
  days: { example: DATE },
  roster: ROSTER,
  rosterCode: ROSTER,
  codes: { example: "D", values: ROSTER_CODES },
  fromCode: { example: "OFF", values: ROSTER_CODES },
  toCode: { example: "D", values: ROSTER_CODES },
  "corrections.reason": { example: "Tukar shift dengan rekan satu unit" },
  "corrections.createdByName": { example: "Admin MINING OPERATION" },
  "summary.code": ROSTER,
  shift: { example: "day", values: ["day", "night"] },
  "rows.shift": {
    example: "Shift 1",
    note: "savera's own name for the shift the upload was filed for, as savera spells it.",
  },
  fileName: { example: "Roster MINING OPERATION 2026-11.xlsx" },
  "ftw.category": FTW_CATEGORY,
  sleepCategory: FTW_CATEGORY,
  ftwDecision: FTW_DECISION,
  saveraStatus: REPORT_FTW_CELL,
  sleepStatus: REPORT_FTW_CELL,
  sentAt: {
    example: LOCAL_STAMP,
    note: "Site-local time, `YYYY-MM-DD HH:MM:SS`, as savera sent it.",
  },
  firstInAt: {
    example: "2026-11-09 05:12:40",
    note: "Site-local time of the first IN tap, `YYYY-MM-DD HH:MM:SS`.",
  },
  firstInIp: { example: "192.168.151.41" },
  firstInMachine: { example: "Finger Pos 1" },
  jamIn: { example: "05:12" },
  checkInAt: {
    example: "05:12:40",
    note: "Site-local time of the first IN tap, `HH:MM:SS`.",
  },
  tappedAt: { example: "05:12:40" },
  "gates.rosterIngest": { example: "03:00" },
  "gates.shiftStart": { example: "04:00" },
  "gates.ftwDeadline": { example: "05:00" },
  "gates.fingerIn": { example: "05:25" },
  "gates.board": { example: "05:26" },
  "gates.secondFinger": { example: "05:28" },
  "gates.busDepart": { example: "05:30" },
  remarks: { example: "Unit breakdown 05:33" },

  /* The timeline monitor */
  "stages.id": { example: UUID.generic },
  "stages.name": { example: "Validasi spare" },
  "stages.at": { example: "05:26" },
  "lastRun.at": { example: ISO },
  "lastRun.note": {
    example: "Papan dibuat: 118 dari 120 unit terisi",
    note: "The scheduler's own sentence for the run.",
  },
  schedulerLastTick: { example: "2026-11-09T05:44:30.000Z" },

  /* Times stamped by the API */
  createdAt: { example: "2026-10-17T08:12:00.000Z" },
  updatedAt: { example: "2026-11-09T05:33:00.000Z" },
  availableAt: { example: "2026-11-09T05:26:00.000Z" },
  readAt: { example: "2026-11-09T05:40:00.000Z" },
  generatedAt: { example: "2026-11-09T05:26:00.000Z" },
  servedAt: { example: "2026-11-09T05:45:00.000Z" },
  lastSyncedAt: { example: "2026-11-09T05:20:00.000Z" },
  ftwSyncedAt: { example: "2026-11-09T05:20:00.000Z" },
  fingerSyncedAt: { example: "2026-11-09T05:25:00.000Z" },
  at: { example: ISO },

  /* Files and builds */
  photoFile: { example: "506264337.jpg" },
  photoFileName: { example: "506264337.jpg" },
  "photo.url": { example: "/v1/integrations/employees/506264337/photo" },
  photoUrl: { example: "/v1/id-card/506264337/photo?v=506264337.jpg" },
  "photo.version": { example: "3f9a1c0b2d4e5f61" },
  downloadUrl: { example: "https://universe.example.id/download/universe.apk" },
  uploadedByName: { example: "Admin MINING OPERATION" },
  message: { example: "Akses ditolak" },
  reason: { example: "Hydraulic bocor, menunggu mekanik" },

  /* Numbers */
  minimumBuild: { example: 12 },
  latestBuild: { example: 14 },
  sleepMinutes: { example: 405 },
  total: { example: 1520 },
  page: { example: 1 },
  pageSize: { example: 50 },
  limit: { example: 100 },
  unread: { example: 2 },
  rotateSeconds: { example: 15 },
  dayCount: { example: 30 },
};

const valuesLine = (values: readonly unknown[]) =>
  `Values: ${values.map((v) => `\`${String(v)}\``).join(", ")}.`;

/** By type, for what needs no curated value: counts and flags. */
function byType(schema: Json): unknown {
  switch (schema.type) {
    case "integer":
      return 12;
    case "number":
      return 1.5;
    case "boolean":
      return true;
    default:
      return undefined;
  }
}

const describe = (schema: Json, ...lines: (string | undefined)[]) => {
  const said = [schema.description, ...lines].filter(Boolean).join(" ");
  return said ? { description: said } : {};
};

/**
 * A copy of the schema with an example on every field it can reach, and the
 * values of every closed set described. `parent` is the property this
 * schema is the value of.
 */
export function withExamples(node: unknown, parent = "", name = ""): unknown {
  if (Array.isArray(node))
    return node.map((n) => withExamples(n, parent, name));
  if (!node || typeof node !== "object") return node;
  const schema = node as Json;

  if (schema.type === "object" || schema.properties) {
    const properties = schema.properties as Record<string, unknown> | undefined;
    return {
      ...schema,
      ...(properties
        ? {
            properties: Object.fromEntries(
              Object.entries(properties).map(([key, value]) => [
                key,
                withExamples(value, name, key),
              ])
            ),
          }
        : {}),
      ...(schema.additionalProperties &&
      typeof schema.additionalProperties === "object"
        ? {
            additionalProperties: withExamples(
              schema.additionalProperties,
              name,
              "*"
            ),
          }
        : {}),
    };
  }
  if (schema.type === "array")
    return { ...schema, items: withExamples(schema.items, parent, name) };
  for (const combinator of ["anyOf", "oneOf", "allOf"])
    if (Array.isArray(schema[combinator]))
      return {
        ...schema,
        [combinator]: (schema[combinator] as unknown[]).map((n) =>
          withExamples(n, parent, name)
        ),
      };

  if (Array.isArray(schema.enum)) {
    const values = schema.enum as unknown[];
    const doc = FIELDS[`${parent}.${name}`] ?? FIELDS[name];
    return {
      ...schema,
      ...describe(
        schema,
        valuesLine(values),
        "An app should expect values added later."
      ),
      example: values.includes(doc?.example) ? doc!.example : values[0],
    };
  }

  const doc = FIELDS[`${parent}.${name}`] ?? FIELDS[name];
  const example = schema.example ?? doc?.example ?? byType(schema);
  return {
    ...schema,
    ...describe(
      schema,
      doc?.values ? valuesLine(doc.values) : undefined,
      doc?.note
    ),
    ...(example === undefined ? {} : { example }),
  };
}

/** The leaves of a schema that still have no example, as `parent.name`. */
export function missingExamples(
  node: unknown,
  parent = "",
  name = ""
): string[] {
  if (Array.isArray(node))
    return node.flatMap((n) => missingExamples(n, parent, name));
  if (!node || typeof node !== "object") return [];
  const schema = node as Json;
  if (schema.properties)
    return Object.entries(schema.properties as Record<string, unknown>).flatMap(
      ([key, value]) => missingExamples(value, name, key)
    );
  if (schema.type === "array")
    return missingExamples(schema.items, parent, name);
  for (const combinator of ["anyOf", "oneOf", "allOf"])
    if (Array.isArray(schema[combinator]))
      return (schema[combinator] as unknown[]).flatMap((n) =>
        missingExamples(n, parent, name)
      );
  if (schema.type === "object") return [];
  const example = schema.example;
  return example === undefined || example === "" ? [`${parent}.${name}`] : [];
}
