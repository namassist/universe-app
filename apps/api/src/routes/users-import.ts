/**
 * Bulk account provisioning by spreadsheet (design D11).
 *
 * Parsing is server-side — the browser is never the validator. The file is
 * capped, unknown columns are rejected rather than ignored, and nothing is
 * written before an explicit commit, so a malformed or hostile file fails
 * validation instead of reaching the database.
 *
 * Every NIK is checked against the employee register. That check used to be
 * absent for want of a table to check against; it is a blocking per-row error
 * now, which means a spreadsheet that imported cleanly before this change can
 * fail today. That is the intent — the accounts it would have created are the
 * ones that resolve to no departemen and see nothing.
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
  cellText,
  MAX_IMPORT_BYTES,
  missingColumnsFailure,
  unknownColumnsFailure,
  type ParseFailure,
} from "./import-columns";

export { MAX_IMPORT_BYTES };

const HEADER_ROW = 1;

export type ExistingAccount = {
  id: string;
  nik: string;
  name: string;
  email: string | null;
  roleId: string;
  roleName: string;
  /** Every role the account holds, the default first — ids and names alike. */
  roleIds: string[];
  roleNames: string[];
};

/** Separates the roles in one `role` cell: `Superadmin, Pengawas Lapangan`. */
const ROLE_SEPARATOR = ",";
/** The same bound the account routes put on `roleIds`. */
const MAX_ROLES_IN_CELL = 20;

/**
 * The roles a cell names, in the order written, each once. The first is the
 * account's default. Or the issue that fails the row.
 */
function rolesInCell(
  cell: string,
  roleByName: Map<string, { id: string; name: string }>
): { id: string; name: string }[] | { issue: string } {
  const names = cell
    .split(ROLE_SEPARATOR)
    .map((n) => n.trim())
    .filter((n) => n.length > 0);
  if (!names.length) return { issue: 'Role "—" tidak terdaftar' };
  if (names.length > MAX_ROLES_IN_CELL)
    return { issue: `Lebih dari ${MAX_ROLES_IN_CELL} role dalam satu baris` };
  const roles: { id: string; name: string }[] = [];
  for (const name of names) {
    const role = roleByName.get(name.toLowerCase());
    if (!role) return { issue: `Role "${name}" tidak terdaftar` };
    if (!roles.some((r) => r.id === role.id)) roles.push(role);
  }
  return roles;
}

/** Same default, same set — the extras' order is not a change. */
function sameRoles(existing: ExistingAccount, roleIds: string[]): boolean {
  if (existing.roleId !== roleIds[0]) return false;
  const held = new Set(existing.roleIds);
  return (
    held.size === new Set(roleIds).size && roleIds.every((id) => held.has(id))
  );
}

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
  existingByEmail: Map<string, ExistingAccount>,
  /** Every NIK the employee register carries. See the per-row check below. */
  employeeNiks: Set<string>
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

    const roles = rolesInCell(roleName, roleByName);
    if ("issue" in roles) {
      errors.push(danger(n, nik, nama, roles.issue));
      continue;
    }
    const roleNames = roles.map((r) => r.name);
    const role = roleNames.join(", ");

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

    // A NIK matching no employee fails its row, by the same rule the single
    // account route enforces: an account whose NIK resolves to no employee has
    // no departemen, so a `dept`- or `self`-scoped one is born blind. Applying
    // the rule in both places is the point — if the import were the laxer of
    // the two, operators would simply route around the form.
    if (!employeeNiks.has(nik)) {
      errors.push(danger(n, nik, nama, "NIK tidak terdaftar di data karyawan"));
      continue;
    }

    seenNik.set(nik, n);
    if (email) seenEmail.set(emailKey, n);

    const existing = existingByNik.get(nik);
    if (!existing) {
      rows.push({
        row: n,
        kind: "new",
        nik,
        nama,
        email: email || null,
        role,
        roles: roleNames,
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
    if (
      !sameRoles(
        existing,
        roles.map((r) => r.id)
      )
    )
      changes.push({
        field: "role",
        from: existing.roleNames.join(", "),
        to: role,
      });

    rows.push({
      row: n,
      kind: "updated",
      nik,
      nama,
      email: email || null,
      role,
      roles: roleNames,
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
