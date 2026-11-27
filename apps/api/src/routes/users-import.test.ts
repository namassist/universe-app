/**
 * The account import's `role` column names one role or several, comma
 * separated. The first is the account's default; together they are its whole
 * role set. Pure parsing — no database — so it runs anywhere.
 *
 *   bun test src/routes/users-import.test.ts
 */

import { describe, expect, test } from "bun:test";
import ExcelJS from "exceljs";

import { validateWorkbook, type ExistingAccount } from "./users-import";

const ROLES = new Map([
  ["superadmin", { id: "r-super", name: "Superadmin" }],
  ["pengawas lapangan", { id: "r-pengawas", name: "Pengawas Lapangan" }],
  ["user", { id: "r-user", name: "User" }],
]);
const NIK = "503220421";

async function workbook(role: string): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Akun");
  ws.addRow(["nik", "nama", "email", "role"]);
  ws.addRow([NIK, "Budi Santoso", "", role]);
  const buffer = await wb.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

async function preview(role: string, existing?: ExistingAccount) {
  const result = await validateWorkbook(
    await workbook(role),
    "akun.xlsx",
    ROLES,
    new Map(existing ? [[NIK, existing]] : []),
    new Map(),
    new Set([NIK])
  );
  if ("code" in result) throw new Error(result.message);
  return result;
}

const existing = (roleIds: string[], roleNames: string[]): ExistingAccount => ({
  id: "u-1",
  nik: NIK,
  name: "Budi Santoso",
  email: null,
  roleId: roleIds[0]!,
  roleName: roleNames[0]!,
  roleIds,
  roleNames,
});

describe("the role column", () => {
  test("takes one role, as before", async () => {
    const { rows, errors } = await preview("User");
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ role: "User", roles: ["User"] });
  });

  test("takes several, comma separated, in the order written", async () => {
    const { rows, errors } = await preview(" pengawas lapangan ,Superadmin");
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({
      role: "Pengawas Lapangan, Superadmin",
      roles: ["Pengawas Lapangan", "Superadmin"],
    });
  });

  test("names the role it does not know", async () => {
    const { rows, errors } = await preview("Superadmin, Mandor");
    expect(rows).toEqual([]);
    expect(errors[0]!.issue).toBe('Role "Mandor" tidak terdaftar');
  });

  test("counts a role written twice once", async () => {
    const { rows } = await preview("Superadmin, superadmin");
    expect(rows[0]!.roles).toEqual(["Superadmin"]);
  });

  test("is an error when empty", async () => {
    const { errors } = await preview("");
    expect(errors[0]!.issue).toBe('Role "—" tidak terdaftar');
  });
});

describe("an existing account", () => {
  test("with the same set and default is unchanged, whatever the extras' order", async () => {
    const same = await preview(
      "Superadmin, User, Pengawas Lapangan",
      existing(
        ["r-super", "r-pengawas", "r-user"],
        ["Superadmin", "Pengawas Lapangan", "User"]
      )
    );
    expect(same.rows[0]!.changes).toEqual([]);
  });

  test("names the change when the set differs", async () => {
    const { rows } = await preview(
      "Superadmin, Pengawas Lapangan",
      existing(["r-super"], ["Superadmin"])
    );
    expect(rows[0]!.changes).toEqual([
      {
        field: "role",
        from: "Superadmin",
        to: "Superadmin, Pengawas Lapangan",
      },
    ]);
  });

  test("names the change when only the default moves", async () => {
    const { rows } = await preview(
      "Pengawas Lapangan, Superadmin",
      existing(["r-super", "r-pengawas"], ["Superadmin", "Pengawas Lapangan"])
    );
    expect(rows[0]!.changes).toEqual([
      {
        field: "role",
        from: "Superadmin, Pengawas Lapangan",
        to: "Pengawas Lapangan, Superadmin",
      },
    ]);
  });
});
