import { describe, expect, test } from "bun:test";

import { applySuggestion, suggestionOption } from "./um-user-suggest";

const budi = {
  nik: "503220421",
  name: "Budi Santoso",
  email: "budi@ungguldinamika.co.id",
  hasAccount: false,
};

describe("applySuggestion", () => {
  test("fills NIK, name and email from the employee", () => {
    expect(applySuggestion({ nik: "5032", name: "", email: "" }, budi)).toEqual(
      {
        nik: "503220421",
        name: "Budi Santoso",
        email: "budi@ungguldinamika.co.id",
      }
    );
  });

  test("replaces what was typed, the email included", () => {
    expect(
      applySuggestion(
        { nik: "1", name: "Lain", email: "lain@ungguldinamika.co.id" },
        budi
      ).email
    ).toBe("budi@ungguldinamika.co.id");
  });

  test("keeps the typed email when the employee has none", () => {
    expect(
      applySuggestion(
        { nik: "5032", name: "", email: "budi@contoh.id" },
        { ...budi, email: null }
      )
    ).toEqual({
      nik: "503220421",
      name: "Budi Santoso",
      email: "budi@contoh.id",
    });
  });
});

describe("suggestionOption", () => {
  test("shows the name, the email beneath and the NIK aside", () => {
    expect(suggestionOption(budi, "Sudah punya akun")).toMatchObject({
      value: "503220421",
      label: "Budi Santoso",
      sub: "503220421",
      detail: "budi@ungguldinamika.co.id",
      tag: undefined,
    });
  });

  test("marks an employee who already has an account", () => {
    const option = suggestionOption(
      { ...budi, email: null, hasAccount: true },
      "Sudah punya akun"
    );
    expect(option.tag).toBe("Sudah punya akun");
    expect(option.detail).toBeUndefined();
  });
});
