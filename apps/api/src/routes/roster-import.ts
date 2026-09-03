/**
 * The roster import: a new parser behind an unchanged contract (design D7).
 *
 * The three importers that came before it — catalogues, units, employees — all
 * read a sheet of *named* columns of known width, which is what
 * `validateWorkbook` in `master-import.ts` is built around. A roster sheet is
 * `no | nik | nama | departemen | posisi | 01 Aug 26 | … `: five fixed columns
 * and then as many day columns as the chosen month has days. The width is
 * decided at upload time, so none of that machinery applies and the parsing is
 * written here instead.
 *
 * What does not change is the shape that comes out. `MasterImportPreview`,
 * `ImportErrorRow`, and `MasterImportResult` are used as they stand, because
 * the web app renders all four importers through one results table and a fourth
 * wire shape would be a fourth table to keep aligned.
 *
 * Three decisions worth knowing before reading:
 *
 * - **The department and the month are stated, never inferred** (D6). Not from
 *   the file name, which survives one "Copy of", and not from a header cell,
 *   which is the first thing forgotten when last month's file is reused. A
 *   scoped caller does not get to state the department either — it is resolved
 *   from its own record.
 * - **The preview does not return the whole grid** (D8). A month for a big
 *   department is 62,000 cells; the counts and every remark come back in full,
 *   the accepted rows come back a page at a time, and the file is held briefly
 *   so the later pages have something to read.
 * - **Nothing here writes an employment status** (D19). A shifted column would
 *   otherwise terminate everyone below it. Where the file and the register
 *   disagree, the preview says so and a person decides.
 */

import ExcelJS from "exceljs";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Elysia, t } from "elysia";
import {
  isRosterCode,
  ROSTER_CODE_KIND,
  ROSTER_IMPORT_FIXED_COLUMNS,
  type EmployeeStatus,
  type ImportErrorRow,
  type MasterImportPreview,
  type MasterImportPreviewRow,
  type RosterCode,
  type SessionPrincipal,
} from "@universe/contracts";

import { requireAuth } from "../auth/macro";
import { departmentIdOfNik } from "../auth/scope";
import { db, schema } from "../db";
import { redis } from "../redis";
import { deleteImport, importPath, writeImport } from "../storage";
import { missingColumnsFailure, type ParseFailure } from "./import-columns";
import { dayHeader, monthDays, monthToFirstDay } from "./roster-month";
import {
  ErrorSchema,
  RosterImportPreviewSchema,
  RosterImportResultSchema,
  RosterImportRowsSchema,
} from "./schemas";

/**
 * Eight megabytes rather than the two the other importers allow.
 *
 * Two thousand people times thirty-one days is 62,000 cells, an order of
 * magnitude past anything a catalogue sheet holds, and a limit that refuses a
 * legitimate department's roster is a limit that stops the product working.
 */
export const MAX_ROSTER_IMPORT_BYTES = 8 * 1024 * 1024;

/** How long an uploaded file stays readable for the pages after the first. */
export const PREVIEW_TTL_SECONDS = 30 * 60;

const HEADER_ROW = 1;

/* ------------------------------------------------------------------- cells */

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return "";
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string")
      return value.text.trim();
    if ("result" in value) return String(value.result ?? "").trim();
    if ("richText" in value)
      return value.richText
        .map((r) => r.text)
        .join("")
        .trim();
    return "";
  }
  return String(value).trim();
}

const danger = (
  row: number,
  nik: string,
  name: string,
  issue: string
): ImportErrorRow => ({
  row: String(row),
  nik: nik || "—",
  emp: name || "—",
  issue,
  badgeVariant: "danger",
  badge: "Error",
});

/**
 * A remark that does not block the commit.
 *
 * Same shape and same table as the errors, distinguished by `badgeVariant` —
 * an operator scanning the bottom of the screen should find one list of
 * everything worth looking at, not two to reconcile.
 */
const remark = (
  row: number,
  nik: string,
  name: string,
  issue: string,
  badge: string
): ImportErrorRow => ({
  row: String(row),
  nik: nik || "—",
  emp: name || "—",
  issue,
  badgeVariant: "warning",
  badge,
});

/* ------------------------------------------------------------------ parsing */

export type RosterSheetRow = {
  /** 1-based spreadsheet row, as the operator sees it. */
  row: number;
  nik: string;
  name: string;
  /** One cell per day column, in order, exactly as typed. */
  cells: string[];
};

export type RosterSheet = {
  /** The day headers as they appeared — quoted back in a width complaint. */
  dayHeaders: string[];
  rows: RosterSheetRow[];
};

/**
 * Read the sheet, or refuse the file as a whole.
 *
 * The width check is a *file* failure, not a row failure, and it happens before
 * a single row is examined (D7): a thirty-one-column sheet uploaded for June is
 * one mistake, and reporting it as two thousand bad rows would bury it.
 */
export function readRosterSheet(
  workbook: ExcelJS.Workbook,
  expectedDays: number
): RosterSheet | ParseFailure {
  const ws = workbook.worksheets[0];
  if (!ws)
    return { code: "empty_file", message: "File tidak berisi sheet apa pun" };

  const headers = (ws.getRow(HEADER_ROW).values as ExcelJS.CellValue[])
    .slice(1)
    .map((v) => cellText(v).toLowerCase());
  // Trailing blanks are what an editor leaves behind after a column is cleared;
  // interior ones are a real gap and are kept so the width check catches them.
  while (headers.length && headers[headers.length - 1] === "") headers.pop();

  const fixed = [...ROSTER_IMPORT_FIXED_COLUMNS];
  const missing = fixed.filter((c, i) => headers[i] !== c);
  if (missing.length) return missingColumnsFailure(missing, fixed);

  const dayHeaders = headers.slice(fixed.length);
  if (dayHeaders.length !== expectedDays)
    return {
      code: "day_column_mismatch",
      message: `Bulan yang dipilih punya ${expectedDays} hari, file ini punya ${dayHeaders.length} kolom hari — pastikan bulannya benar atau pakai template bulan itu`,
    };

  // Positions inside the fixed block, resolved from the constant rather than
  // written as literals: the block grew from two columns to five once the
  // template matched the sheet planners already circulate, and a hard-coded 0
  // and 1 would have kept reading the line number and the NIK.
  const NIK_AT = fixed.indexOf("nik");
  const NAME_AT = fixed.indexOf("nama");

  const rows: RosterSheetRow[] = [];
  for (let n = HEADER_ROW + 1; n <= ws.rowCount; n++) {
    const excelRow = ws.getRow(n);
    const cellAt = (i: number) => cellText(excelRow.getCell(i + 1).value);
    const nik = cellAt(NIK_AT);
    const name = cellAt(NAME_AT);
    const cells = dayHeaders.map((_, i) => cellAt(fixed.length + i));
    // A wholly blank line is filler an editor left behind, not a row somebody
    // meant to write.
    if (!nik && !name && cells.every((c) => c === "")) continue;
    rows.push({ row: n, nik, name, cells });
  }

  return { dayHeaders, rows };
}

export async function readRosterWorkbook(
  bytes: ArrayBuffer
): Promise<ExcelJS.Workbook | ParseFailure> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(bytes);
  } catch {
    return {
      code: "unreadable_file",
      message: "File tidak bisa dibaca sebagai spreadsheet .xlsx",
    };
  }
  return wb;
}

/* --------------------------------------------------------------- the context */

export type RosterEmployee = {
  id: string;
  nik: string;
  name: string;
  departmentId: string;
  departmentName: string;
  status: EmployeeStatus;
};

/** An approved revision on the document a re-upload would replace (design D9). */
export type ApprovedRevision = {
  employeeId: string;
  nik: string;
  employeeName: string;
  date: string;
  fromCode: RosterCode;
  toCode: RosterCode;
  revisionCode: string;
};

export type RosterContext = {
  departmentId: string;
  departmentName: string;
  /** Every employee in the register, keyed on NIK — the file may name anyone. */
  byNik: Map<string, RosterEmployee>;
  /** The active document being replaced, if this month already has one. */
  activeDocumentId: string | null;
  /** `employeeId|date` → the code in force, from that active document. */
  inForce: Map<string, RosterCode>;
  approvedRevisions: ApprovedRevision[];
};

const emp = schema.employees;
const dpt = schema.departments;
const pos = schema.positions;
const doc = schema.rosterDocuments;
const day = schema.rosterDays;
const rev = schema.rosterRevisions;
const item = schema.rosterRevisionItems;

const cellKey = (employeeId: string, date: string) => `${employeeId}|${date}`;

/**
 * Everything the validation compares the file against, in four queries.
 *
 * Deliberately unscoped on the employee register: the file is keyed on NIK, and
 * a NIK belonging to another department has to *resolve* in order to be
 * reported as belonging to another department. Refusing to look would report it
 * as an unknown NIK instead, which sends the operator hunting for a typo that
 * is not there.
 */
export async function rosterContext(
  departmentId: string,
  monthFirstDay: string
): Promise<RosterContext> {
  const [department] = await db
    .select({ id: dpt.id, name: dpt.name })
    .from(dpt)
    .where(eq(dpt.id, departmentId))
    .limit(1);

  const employees = await db
    .select({
      id: emp.id,
      nik: emp.nik,
      name: emp.name,
      departmentId: emp.departmentId,
      departmentName: dpt.name,
      status: emp.status,
    })
    .from(emp)
    .innerJoin(dpt, eq(dpt.id, emp.departmentId));

  const [active] = await db
    .select({ id: doc.id })
    .from(doc)
    .where(
      and(
        eq(doc.departmentId, departmentId),
        eq(doc.month, monthFirstDay),
        eq(doc.status, "aktif")
      )
    )
    .limit(1);

  const inForce = new Map<string, RosterCode>();
  let approvedRevisions: ApprovedRevision[] = [];

  if (active) {
    const days = await db
      .select({
        employeeId: day.employeeId,
        date: day.date,
        code: day.code,
      })
      .from(day)
      .where(eq(day.documentId, active.id));
    for (const row of days)
      inForce.set(cellKey(row.employeeId, row.date), row.code as RosterCode);

    approvedRevisions = (
      await db
        .select({
          employeeId: item.employeeId,
          nik: emp.nik,
          employeeName: emp.name,
          date: item.date,
          fromCode: item.fromCode,
          toCode: item.toCode,
          revisionCode: rev.code,
        })
        .from(item)
        .innerJoin(rev, eq(rev.id, item.revisionId))
        .innerJoin(emp, eq(emp.id, item.employeeId))
        .where(and(eq(rev.documentId, active.id), eq(item.status, "approved")))
    ).map((r) => ({
      ...r,
      fromCode: r.fromCode as RosterCode,
      toCode: r.toCode as RosterCode,
    }));
  }

  return {
    departmentId,
    departmentName: department?.name ?? "",
    byNik: new Map(employees.map((e) => [e.nik.trim().toLowerCase(), e])),
    activeDocumentId: active?.id ?? null,
    inForce,
    approvedRevisions,
  };
}

/* ------------------------------------------------------------------ validate */

/** A row that will be written, with the employee it resolved to. */
export type AcceptedRosterRow = {
  row: number;
  employeeId: string;
  nik: string;
  name: string;
  /** One code per day of the month, aligned to `monthDays()`. */
  codes: RosterCode[];
};

export type RosterValidation = {
  preview: MasterImportPreview;
  accepted: AcceptedRosterRow[];
};

/**
 * Compare the sheet against the register and the roster in force.
 *
 * Touches no database — everything it needs arrived in `RosterContext` — which
 * is what lets the commit re-run exactly this pass and write from `accepted`
 * rather than reconstructing values out of a preview a client handed back.
 *
 * `new` / `updated` / `unchanged` are stated against the *active* document, not
 * against the new one: every row of a fresh document is technically new, and
 * saying so would report a routine correction as two thousand new records and
 * hide the four days that actually changed.
 */
export function validateRosterSheet(
  fileName: string,
  monthFirstDay: string,
  sheet: RosterSheet,
  context: RosterContext
): RosterValidation {
  const days = monthDays(monthFirstDay);

  const rows: MasterImportPreviewRow[] = [];
  const accepted: AcceptedRosterRow[] = [];
  const errors: ImportErrorRow[] = [];
  const warnings: ImportErrorRow[] = [];
  const seen = new Map<string, number>();
  let unchangedCount = 0;

  for (const sheetRow of sheet.rows) {
    const nik = sheetRow.nik.trim();
    const typedName = sheetRow.name.trim();

    if (!nik) {
      errors.push(danger(sheetRow.row, "", typedName, "NIK kosong"));
      continue;
    }

    const firstSeen = seen.get(nik.toLowerCase());
    if (firstSeen !== undefined) {
      errors.push(
        danger(
          sheetRow.row,
          nik,
          typedName,
          `NIK ganda dalam file ini — sudah ada di baris ${firstSeen}`
        )
      );
      continue;
    }
    seen.set(nik.toLowerCase(), sheetRow.row);

    const employee = context.byNik.get(nik.toLowerCase());
    if (!employee) {
      errors.push(
        danger(
          sheetRow.row,
          nik,
          typedName,
          "NIK tidak terdaftar di data karyawan"
        )
      );
      continue;
    }

    // The stated department is what makes this checkable at all (D6). Derived
    // from the file, the same mistake would produce a mixed document with
    // nothing identifiably wrong in it.
    if (employee.departmentId !== context.departmentId) {
      errors.push(
        danger(
          sheetRow.row,
          nik,
          employee.name,
          `Karyawan ini departemen ${employee.departmentName}, file ini untuk ${context.departmentName}`
        )
      );
      continue;
    }

    // Every day of the month must carry a code: a blank cell is not "no
    // information", it is a day the allocation engine cannot answer for.
    const codes: RosterCode[] = [];
    let cellIssue: string | null = null;
    for (let i = 0; i < days.length; i++) {
      const raw = (sheetRow.cells[i] ?? "").trim();
      const label = days[i]!.slice(8);
      if (!raw) {
        cellIssue = `Tanggal ${label} kosong — semua hari wajib berkode`;
        break;
      }
      const code = raw.toUpperCase();
      if (!isRosterCode(code)) {
        cellIssue = `Kode "${raw}" pada tanggal ${label} bukan kode roster yang dikenal`;
        break;
      }
      codes.push(code);
    }
    if (cellIssue) {
      errors.push(danger(sheetRow.row, nik, employee.name, cellIssue));
      continue;
    }

    /* ---------------------------------------------------- what would change */

    const changes = days.flatMap((date, i) => {
      const current = context.inForce.get(cellKey(employee.id, date));
      if (current === undefined || current === codes[i]) return [];
      return [{ field: date, from: current, to: codes[i]! }];
    });
    const known = days.some((date) =>
      context.inForce.has(cellKey(employee.id, date))
    );
    const kind = !known ? "new" : changes.length ? "updated" : "unchanged";
    if (kind === "unchanged") unchangedCount++;

    rows.push({
      row: sheetRow.row,
      kind,
      key: nik,
      label: employee.name,
      // The codes as typed, so the preview can be checked against the sheet
      // without opening it.
      data: sheetRow.cells.map((c) => c.trim()).join(" - "),
      changes,
    });

    /* --------------------------------------------------- non-blocking remarks */

    // Approved revisions this file would undo (D9). One row each, never a
    // count: "3 revisi akan hilang" is not something anyone can act on.
    for (const revision of context.approvedRevisions) {
      if (revision.employeeId !== employee.id) continue;
      const index = days.indexOf(revision.date);
      if (index < 0) continue;
      const cell = codes[index];
      if (cell === undefined || cell === revision.toCode) continue;
      warnings.push(
        remark(
          sheetRow.row,
          nik,
          employee.name,
          `Revisi ${revision.revisionCode} yang sudah disetujui (${revision.date}: ${revision.fromCode} → ${revision.toCode}) akan dikembalikan ke ${cell} oleh file ini`,
          "Revisi tertimpa"
        )
      );
    }

    // Where the roster and the register disagree about employment (D19).
    // Reported once per employee per direction, naming the first date: a
    // termination code repeated to the end of the month is one fact, and
    // twenty rows of it would drown the revision warnings above.
    const endedAt = days.find(
      (_, i) => ROSTER_CODE_KIND[codes[i]!] === "ended"
    );
    if (endedAt && employee.status === "aktif")
      warnings.push(
        remark(
          sheetRow.row,
          nik,
          employee.name,
          `Roster menyebut berhenti (${codes[days.indexOf(endedAt)]} pada ${endedAt}) tapi status karyawan masih aktif — status tidak diubah oleh import, perbaiki di layar Karyawan bila perlu`,
          "Status berbeda"
        )
      );

    const shiftAt = days.find((_, i) => {
      const k = ROSTER_CODE_KIND[codes[i]!];
      return k === "day" || k === "night";
    });
    /* Not `=== "nonaktif"`: `standby` is rostered-but-unallocatable too, and
       this warning exists to catch exactly that mismatch. Written positively
       so a status added later warns by default rather than passing silently. */
    if (shiftAt && employee.status !== "aktif")
      warnings.push(
        remark(
          sheetRow.row,
          nik,
          employee.name,
          `Masih dirosterkan shift (${codes[days.indexOf(shiftAt)]} pada ${shiftAt}) tapi status karyawan ${employee.status} — status tidak diubah oleh import, perbaiki di layar Karyawan bila perlu`,
          "Status berbeda"
        )
      );

    accepted.push({
      row: sheetRow.row,
      employeeId: employee.id,
      nik,
      name: employee.name,
      codes,
    });
  }

  return {
    preview: {
      fileName,
      newCount: rows.filter((r) => r.kind === "new").length,
      updatedCount: rows.filter((r) => r.kind === "updated").length,
      unchangedCount,
      errorCount: errors.length,
      rows,
      errors,
      warnings,
      // The roster references one catalogue — departemen — and states it rather
      // than reading it from the file, so there is never anything to create.
      newMasters: [],
    },
    accepted,
  };
}

/* ------------------------------------------------------------------ template */

/** One line of a roster sheet: the person, then their month if it has one. */
export type RosterSheetPerson = {
  nik: string;
  name: string;
  department: string;
  position: string;
  /** One entry per day of the month, aligned to `monthDays()`. */
  codes?: (RosterCode | null)[];
};

/**
 * The department's roster sheet — blank for a template, filled for an export.
 *
 * One builder for both, because the two have to stay identical: a downloaded
 * document is meant to be correctable and re-importable, and a template that
 * differs from an export by one column would be a file that round-trips until
 * the day somebody tries it.
 *
 * The shape is the planner's own workbook rather than a minimal one. `no`,
 * `departemen`, and `posisi` are read by nobody on the way back in — the
 * department comes from the caller's scope (D6) and the position from the
 * employee register — but the sheet is printed, circulated, and signed, and a
 * file that drops the columns a supervisor uses to find their people is a file
 * they will keep maintaining separately.
 *
 * The NIK is written as text rather than a number on purpose: Excel drops a
 * leading zero from anything it reads as numeric, and a NIK it has quietly
 * turned into 50122197 from 050122197 comes back as an unknown employee.
 */
export async function rosterSheetWorkbook(
  monthFirstDay: string,
  people: RosterSheetPerson[]
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("roster");
  const days = monthDays(monthFirstDay);
  ws.columns = [
    { header: "NO", key: "no", width: 5 },
    { header: "NIK", key: "nik", width: 15 },
    { header: "NAMA", key: "nama", width: 30 },
    { header: "DEPARTEMEN", key: "departemen", width: 40 },
    { header: "POSISI", key: "posisi", width: 60 },
    ...days.map((date) => ({ header: dayHeader(date), key: date, width: 12 })),
  ];
  ws.getRow(HEADER_ROW).font = { bold: true };

  people.forEach((person, i) => {
    const row = ws.addRow({
      no: i + 1,
      nik: person.nik,
      nama: person.name,
      departemen: person.department,
      posisi: person.position,
      ...Object.fromEntries(
        days.map((date, d) => [date, person.codes?.[d] ?? ""])
      ),
    });
    row.getCell("nik").numFmt = "@";
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * The department's people, ready to be handed out as a template.
 *
 * Pre-filled rather than blank, which reverses the earlier decision that a
 * template carrying a NIK is a template that fails validation: these NIKs come
 * from the register, so they resolve by construction. What the operator is left
 * to do is the only part a machine cannot do — type the codes.
 *
 * Only `aktif` employees. Somebody who has left has no shifts to plan, and
 * listing them invites a row of `OFF` that the importer would then have to
 * remark on (D19). Ordered by position and then name, matching the sheet this
 * template was modelled on, which groups a supervisor's crew together rather
 * than scattering it through a NIK ordering nobody reads by.
 */
export async function rosterTemplateRows(
  departmentId: string
): Promise<RosterSheetPerson[]> {
  return db
    .select({
      nik: emp.nik,
      name: emp.name,
      department: dpt.name,
      position: pos.name,
    })
    .from(emp)
    .innerJoin(dpt, eq(dpt.id, emp.departmentId))
    .innerJoin(pos, eq(pos.id, emp.positionId))
    .where(and(eq(emp.departmentId, departmentId), eq(emp.status, "aktif")))
    .orderBy(asc(pos.name), asc(emp.name));
}

/**
 * A document's grid as a spreadsheet.
 *
 * Generated from the stored days rather than served from the uploaded file,
 * because the uploaded file is not kept — `IMPORT_DIR` holds a copy for half an
 * hour and no longer (D8). Generating it is the better answer anyway: an
 * approved revision has changed days since the upload, so the original file is
 * no longer what the document *says*. It shares `rosterSheetWorkbook` with the
 * template for the reason given there: a downloaded document is meant to be
 * corrected and uploaded back.
 */
export const rosterWorkbook = rosterSheetWorkbook;

/* -------------------------------------------------------------------- commit */

export type RosterCommit = {
  documentId: string;
  archivedDocumentId: string | null;
  rejectedRevisions: number;
  employeeCount: number;
  dayCount: number;
};

/** Postgres caps a statement's parameters; 62,000 rows go in in slices. */
const INSERT_CHUNK = 2000;

/**
 * Archive, auto-reject, create, insert — one transaction (D5, D12).
 *
 * The order matters: the previous document has to leave `aktif` before the new
 * one arrives, or the partial unique index refuses the insert. And its pending
 * entries are rejected in the same transaction rather than left hanging,
 * because an approval queue full of decisions that cannot change anything is
 * worse than no queue at all — an approver clicks "setuju" and nothing happens.
 */
export async function commitRoster(
  input: {
    departmentId: string;
    monthFirstDay: string;
    fileName: string;
    uploadedBy: string;
  },
  accepted: AcceptedRosterRow[],
  days: string[]
): Promise<RosterCommit> {
  return db.transaction(async (tx) => {
    const [previous] = await tx
      .select({ id: doc.id })
      .from(doc)
      .where(
        and(
          eq(doc.departmentId, input.departmentId),
          eq(doc.month, input.monthFirstDay),
          eq(doc.status, "aktif")
        )
      )
      .limit(1);

    let rejectedRevisions = 0;
    if (previous) {
      await tx
        .update(doc)
        .set({ status: "arsip" })
        .where(eq(doc.id, previous.id));

      const revisions = await tx
        .select({ id: rev.id })
        .from(rev)
        .where(eq(rev.documentId, previous.id));
      if (revisions.length) {
        const rejected = await tx
          .update(item)
          .set({
            status: "rejected",
            decidedAt: new Date(),
            decisionNote:
              "Ditolak otomatis: roster bulan ini diunggah ulang, dokumen yang direvisi sudah diarsipkan",
          })
          .where(
            and(
              inArray(
                item.revisionId,
                revisions.map((r) => r.id)
              ),
              eq(item.status, "pending")
            )
          )
          .returning({ id: item.id });
        rejectedRevisions = rejected.length;
      }
    }

    const [created] = await tx
      .insert(doc)
      .values({
        departmentId: input.departmentId,
        month: input.monthFirstDay,
        fileName: input.fileName,
        uploadedBy: input.uploadedBy,
        status: "aktif",
      })
      .returning({ id: doc.id });

    const values = accepted.flatMap((row) =>
      days.map((date, i) => ({
        documentId: created!.id,
        employeeId: row.employeeId,
        date,
        code: row.codes[i]!,
      }))
    );
    for (let i = 0; i < values.length; i += INSERT_CHUNK)
      await tx.insert(day).values(values.slice(i, i + INSERT_CHUNK));

    return {
      documentId: created!.id,
      archivedDocumentId: previous?.id ?? null,
      rejectedRevisions,
      employeeCount: accepted.length,
      dayCount: values.length,
    };
  });
}

/* -------------------------------------------------------------- the routes */

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 200;

const invalidMonth = {
  code: "invalid_month",
  message: "Bulan harus dalam bentuk YYYY-MM",
};

/**
 * Whose department this upload is for (design D6, D13).
 *
 * A caller whose scope reaches one department does not get to state another —
 * the value in the body is not corrected, it is never read. Only an `all`-scoped
 * caller names one, because only that caller has more than one to choose from.
 */
async function resolveDepartment(
  principal: SessionPrincipal,
  stated: string | undefined
): Promise<{ id: string } | ParseFailure> {
  if (principal.kind !== "user")
    return { code: "forbidden", message: "Akses ditolak" };

  if (principal.scope === "all") {
    if (!stated)
      return {
        code: "validation_failed",
        message: "Departemen wajib dipilih",
      };
    const [row] = await db
      .select({ id: dpt.id })
      .from(dpt)
      .where(eq(dpt.id, stated))
      .limit(1);
    if (!row)
      return {
        code: "validation_failed",
        message: "Departemen yang dipilih tidak ada di master",
      };
    return { id: row.id };
  }

  if (!principal.nik)
    return {
      code: "forbidden",
      message: "Akun ini tidak punya NIK, departemennya tidak bisa ditentukan",
    };
  const own = await departmentIdOfNik(principal.nik);
  if (!own)
    return {
      code: "forbidden",
      message: "NIK akun ini tidak ada di data karyawan",
    };
  return { id: own };
}

/** Parse and validate one upload, from bytes to preview. Writes nothing. */
async function validateUpload(
  fileName: string,
  bytes: ArrayBuffer,
  departmentId: string,
  monthFirstDay: string
): Promise<RosterValidation | ParseFailure> {
  const workbook = await readRosterWorkbook(bytes);
  if ("code" in workbook) return workbook;
  const sheet = readRosterSheet(workbook, monthDays(monthFirstDay).length);
  if ("code" in sheet) return sheet;
  const context = await rosterContext(departmentId, monthFirstDay);
  return validateRosterSheet(fileName, monthFirstDay, sheet, context);
}

/** What a staged preview remembers between requests. */
type StagedPreview = {
  fileName: string;
  departmentId: string;
  monthFirstDay: string;
  /** The account that staged it — a token is a handle to one caller's file. */
  userId: string;
};

const stagedKey = (token: string) => `roster:import:${token}`;

const page = <T>(items: T[], pageNumber: number, size: number): T[] =>
  items.slice((pageNumber - 1) * size, pageNumber * size);

export const rosterImportRoutes = new Elysia({
  prefix: "/roster",
  tags: ["roster"],
})
  .use(requireAuth)

  /**
   * The template, which is a department's sheet and not a blank form.
   *
   * It therefore needs the same two things the upload does, and resolves them
   * the same way: the month is stated, and the department comes from the
   * caller's own record unless the caller is `all`-scoped and names one (D6).
   * Sharing `resolveDepartment` with the preview and the commit is the point —
   * a template listing one department's people that the upload then attributes
   * to another would be worse than no template.
   */
  .get(
    "/import/template",
    async ({ query, principal, set, status }) => {
      const first = monthToFirstDay(query.month);
      if (!first) return status(422, invalidMonth);

      const department = await resolveDepartment(principal, query.departmentId);
      if ("code" in department)
        return department.code === "forbidden"
          ? status(403, department)
          : status(422, department);

      const people = await rosterTemplateRows(department.id);
      set.headers["content-type"] =
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      set.headers["content-disposition"] =
        `attachment; filename="template_roster_${query.month}.xlsx"`;
      return new Response(
        new Uint8Array(await rosterSheetWorkbook(first, people))
      );
    },
    {
      auth: { menu: "roster-data", mode: "manage" },
      query: t.Object({
        month: t.String(),
        // Read only for an `all`-scoped caller; `resolveDepartment` ignores it
        // for everyone else rather than correcting it.
        departmentId: t.Optional(t.String()),
      }),
      // Described by hand: the body is a binary workbook, and a TypeBox
      // `response` schema would try to validate it as an object.
      detail: {
        summary: "Download a roster template for one department and month",
        responses: {
          200: {
            description:
              "An .xlsx carrying the department's active employees, one column per day of that month",
            content: {
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
                { schema: { type: "string", format: "binary" } },
            },
          },
          401: { description: "No session" },
          403: { description: "Lacks manage on roster-data, or has no NIK" },
          422: { description: "Month is not YYYY-MM, or no department chosen" },
        },
      },
    }
  )

  .post(
    "/import/preview",
    async ({ body, principal, status }) => {
      const first = monthToFirstDay(body.month);
      if (!first) return status(422, invalidMonth);

      const department = await resolveDepartment(principal, body.departmentId);
      if ("code" in department)
        return department.code === "forbidden"
          ? status(403, department)
          : status(422, department);

      const bytes = await body.file.arrayBuffer();
      const result = await validateUpload(
        body.file.name,
        bytes,
        department.id,
        first
      );
      if ("code" in result) return status(422, result);

      // Staged so the pages after this one have something to read (D8). A
      // failure here is not the preview's failure: the counts and remarks are
      // already correct, and the commit re-parses the file the client sends —
      // so a null token costs paging, never correctness.
      let token: string | null = crypto.randomUUID();
      try {
        await writeImport(`${token}.xlsx`, bytes);
        await redis.set(
          stagedKey(token),
          JSON.stringify({
            fileName: body.file.name,
            departmentId: department.id,
            monthFirstDay: first,
            userId: principal.id,
          } satisfies StagedPreview),
          "EX",
          PREVIEW_TTL_SECONDS
        );
      } catch (error) {
        console.error("[roster] preview staging failed", error);
        token = null;
      }

      const size = DEFAULT_PAGE_SIZE;
      return {
        ...result.preview,
        rows: page(result.preview.rows, 1, size),
        token,
        rowTotal: result.preview.rows.length,
        page: 1,
        pageSize: size,
      };
    },
    {
      auth: { menu: "roster-data", mode: "manage" },
      body: t.Object({
        file: t.File({ maxSize: MAX_ROSTER_IMPORT_BYTES }),
        /** `YYYY-MM`. Stated, never read from the file (design D6). */
        month: t.String(),
        /** Ignored for any caller whose scope already names a department. */
        departmentId: t.Optional(t.String()),
      }),
      response: {
        200: RosterImportPreviewSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "Preview a roster import — writes nothing" },
    }
  )

  .get(
    "/import/preview/:token/rows",
    async ({ params, query, principal, status }) => {
      const raw = await redis.get(stagedKey(params.token));
      if (!raw)
        return status(404, {
          code: "preview_expired",
          message: "Pratinjau sudah kedaluwarsa — unggah ulang filenya",
        });
      const staged = JSON.parse(raw) as StagedPreview;
      // The token is a handle to one caller's file, not a capability anyone
      // holding the string may spend.
      if (staged.userId !== principal.id)
        return status(403, { code: "forbidden", message: "Akses ditolak" });

      const file = Bun.file(importPath(`${params.token}.xlsx`));
      if (!(await file.exists()))
        return status(404, {
          code: "preview_expired",
          message: "Pratinjau sudah kedaluwarsa — unggah ulang filenya",
        });

      const result = await validateUpload(
        staged.fileName,
        await file.arrayBuffer(),
        staged.departmentId,
        staged.monthFirstDay
      );
      // A staged file that no longer parses is a staged file that was corrupted
      // on disk; the answer is the same as an expired one.
      if ("code" in result) return status(404, result);

      const pageNumber = Math.max(1, query.page ?? 1);
      const size = Math.min(
        MAX_PAGE_SIZE,
        Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE)
      );
      return {
        rows: page(result.preview.rows, pageNumber, size),
        rowTotal: result.preview.rows.length,
        page: pageNumber,
        pageSize: size,
      };
    },
    {
      auth: { menu: "roster-data", mode: "manage" },
      params: t.Object({ token: t.String({ format: "uuid" }) }),
      query: t.Object({
        page: t.Optional(t.Integer({ minimum: 1 })),
        pageSize: t.Optional(t.Integer({ minimum: 1, maximum: MAX_PAGE_SIZE })),
      }),
      response: {
        200: RosterImportRowsSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
      },
      detail: { summary: "Another page of a staged roster preview" },
    }
  )

  .post(
    "/import",
    async ({ body, principal, status }) => {
      const first = monthToFirstDay(body.month);
      if (!first) return status(422, invalidMonth);

      const department = await resolveDepartment(principal, body.departmentId);
      if ("code" in department)
        return department.code === "forbidden"
          ? status(403, department)
          : status(422, department);

      // Re-parsed rather than trusting the preview the client saw — the same
      // rule the other three importers follow, and the reason a lost staged
      // file can never make a commit wrong.
      const result = await validateUpload(
        body.file.name,
        await body.file.arrayBuffer(),
        department.id,
        first
      );
      if ("code" in result) return status(422, result);
      if (result.preview.errorCount > 0)
        return status(422, {
          code: "validation_failed",
          message: `${result.preview.errorCount} baris masih bermasalah`,
        });
      if (!result.accepted.length)
        return status(422, {
          code: "validation_failed",
          message: "File tidak berisi satu baris pun yang bisa diimpor",
        });

      const committed = await commitRoster(
        {
          departmentId: department.id,
          monthFirstDay: first,
          fileName: body.file.name,
          uploadedBy: principal.id,
        },
        result.accepted,
        monthDays(first)
      );

      // The staged copy has done its job; leaving it would keep a workforce's
      // roster on disk for half an hour for nothing.
      if (body.token) {
        await redis.del(stagedKey(body.token));
        await deleteImport(`${body.token}.xlsx`);
      }

      return {
        created: committed.dayCount,
        updated: 0,
        mastersCreated: 0,
        documentId: committed.documentId,
        archivedDocumentId: committed.archivedDocumentId,
        rejectedRevisions: committed.rejectedRevisions,
        employeeCount: committed.employeeCount,
      };
    },
    {
      auth: { menu: "roster-data", mode: "manage" },
      body: t.Object({
        file: t.File({ maxSize: MAX_ROSTER_IMPORT_BYTES }),
        month: t.String(),
        departmentId: t.Optional(t.String()),
        /** The preview this commit follows, so its staged copy can be cleared. */
        token: t.Optional(t.String()),
      }),
      response: {
        200: RosterImportResultSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        422: ErrorSchema,
      },
      detail: {
        summary:
          "Commit a roster import — archives the month's previous document",
      },
    }
  );
