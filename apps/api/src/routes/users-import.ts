/**
 * Bulk account provisioning by spreadsheet (design D11).
 *
 * Parsing is server-side — the browser is never the validator. The file is
 * capped, unknown columns are rejected rather than ignored, and nothing is
 * written before an explicit commit, so a malformed or hostile file fails
 * validation instead of reaching the database.
 */

import ExcelJS from "exceljs";
import {
  ACCOUNT_IMPORT_COLUMNS,
  type AccountImportChange,
  type AccountImportError,
  type AccountImportPreview,
  type AccountImportPreviewRow,
} from "@universe/contracts";

import {
  missingColumnsFailure,
  unknownColumnsFailure,
  type ParseFailure,
} from "./import-columns";

/** Generous for hundreds of rows, small enough that a hostile file fails fast. */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

const HEADER_ROW = 1;

export type ExistingAccount = {
  id: string;
  nik: string;
  name: string;
  email: string | null;
  roleId: string;
  roleName: string;
};

function danger(
  row: number,
  nik: string,
  emp: string,
  issue: string
): AccountImportError {
  return {
    row: String(row),
    nik,
    emp,
    issue,
    badgeVariant: "danger",
    badge: "Error",
  };
}

/** The template a caller downloads before filling it in. */
export async function buildTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Akun");
  ws.columns = ACCOUNT_IMPORT_COLUMNS.map((key) => ({
    header: key,
    key,
    width: key === "email" ? 32 : 22,
  }));
  ws.getRow(HEADER_ROW).font = { bold: true };
  // One example row, so the expected shape is obvious without a manual. There
  // is deliberately no password column: the initial password is configuration.
  ws.addRow({
    nik: "503220421",
    nama: "Budi Santoso",
    email: "budi.santoso@unggul.co.id",
    role: "User",
  });
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
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

/**
 * Validate an uploaded workbook against the existing accounts and roles, and
 * return the preview. Nothing here touches the database.
 */
export async function validateWorkbook(
  bytes: ArrayBuffer,
  fileName: string,
  roleByName: Map<string, { id: string; name: string }>,
  existingByNik: Map<string, ExistingAccount>,
  /** Keyed lowercase — an operator varying the case means the same mailbox. */
  existingByEmail: Map<string, ExistingAccount>
): Promise<AccountImportPreview | ParseFailure> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(bytes);
  } catch {
    return {
      code: "unreadable_file",
      message: "File tidak bisa dibaca sebagai spreadsheet .xlsx",
    };
  }

  const ws = wb.worksheets[0];
  if (!ws)
    return { code: "empty_file", message: "File tidak berisi sheet apa pun" };

  const headers = (ws.getRow(HEADER_ROW).values as ExcelJS.CellValue[])
    .slice(1)
    .map((v) => cellText(v).toLowerCase())
    .filter((h) => h.length > 0);

  const unknown = headers.filter(
    (h) => !(ACCOUNT_IMPORT_COLUMNS as readonly string[]).includes(h)
  );
  if (unknown.length)
    return unknownColumnsFailure(unknown, ACCOUNT_IMPORT_COLUMNS);

  const missing = ACCOUNT_IMPORT_COLUMNS.filter(
    (c) => c !== "email" && !headers.includes(c)
  );
  if (missing.length)
    return missingColumnsFailure([...missing], ACCOUNT_IMPORT_COLUMNS);

  const index = (name: string) => headers.indexOf(name) + 1;
  const col = {
    nik: index("nik"),
    nama: index("nama"),
    email: index("email"),
    role: index("role"),
  };

  const rows: AccountImportPreviewRow[] = [];
  const errors: AccountImportError[] = [];
  const seenNik = new Map<string, number>();
  const seenEmail = new Map<string, number>();

  for (let n = HEADER_ROW + 1; n <= ws.rowCount; n++) {
    const raw = ws.getRow(n);
    const nik = cellText(raw.getCell(col.nik).value);
    const nama = cellText(raw.getCell(col.nama).value);
    const email = col.email > 0 ? cellText(raw.getCell(col.email).value) : "";
    const roleName = cellText(raw.getCell(col.role).value);

    if (!nik && !nama && !email && !roleName) continue; // blank filler row

    if (!nik) {
      errors.push(danger(n, "—", nama || "—", "NIK kosong"));
      continue;
    }
    if (!nama) {
      errors.push(danger(n, nik, "—", "Nama kosong"));
      continue;
    }

    const firstSeen = seenNik.get(nik);
    if (firstSeen !== undefined) {
      errors.push(
        danger(
          n,
          nik,
          nama,
          `NIK ganda dalam file ini — sudah ada di baris ${firstSeen}`
        )
      );
      continue;
    }

    const role = roleByName.get(roleName.toLowerCase());
    if (!role) {
      errors.push(
        danger(n, nik, nama, `Role "${roleName || "—"}" tidak terdaftar`)
      );
      continue;
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push(danger(n, nik, nama, `Email "${email}" tidak valid`));
      continue;
    }

    // Email is unique in the database just as NIK is, so it needs the same two
    // checks — against the rest of this file, and against the accounts already
    // stored. Without them the row passes validation and then dies on the
    // unique index halfway through the commit.
    const emailKey = email.toLowerCase();
    if (email) {
      const firstSeen = seenEmail.get(emailKey);
      if (firstSeen !== undefined) {
        errors.push(
          danger(
            n,
            nik,
            nama,
            `Email "${email}" ganda dalam file ini — sudah ada di baris ${firstSeen}`
          )
        );
        continue;
      }
      const owner = existingByEmail.get(emailKey);
      if (owner && owner.nik !== nik) {
        errors.push(
          danger(
            n,
            nik,
            nama,
            `Email "${email}" sudah dipakai akun NIK ${owner.nik}`
          )
        );
        continue;
      }
    }

    seenNik.set(nik, n);
    if (email) seenEmail.set(emailKey, n);

    // A NIK matching no employee is accepted for now: employee master data is
    // provisioned by the change that follows this one, and the same validation
    // the roster upload already specifies applies here once it exists.
    const existing = existingByNik.get(nik);
    if (!existing) {
      rows.push({
        row: n,
        kind: "new",
        nik,
        nama,
        email: email || null,
        role: role.name,
        changes: [],
      });
      continue;
    }

    // Separating new from updated, and naming what each update would change, is
    // what stops a hand-edited role being silently overwritten by a re-upload.
    const changes: AccountImportChange[] = [];
    if (existing.name !== nama)
      changes.push({ field: "nama", from: existing.name, to: nama });
    if ((existing.email ?? "") !== email)
      changes.push({
        field: "email",
        from: existing.email,
        to: email || null,
      });
    if (existing.roleId !== role.id)
      changes.push({ field: "role", from: existing.roleName, to: role.name });

    rows.push({
      row: n,
      kind: "updated",
      nik,
      nama,
      email: email || null,
      role: role.name,
      changes,
    });
  }

  return {
    fileName,
    newCount: rows.filter((r) => r.kind === "new").length,
    updatedCount: rows.filter((r) => r.kind === "updated").length,
    errorCount: errors.length,
    rows,
    errors,
  };
}
