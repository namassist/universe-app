# Employee email, and suggestions in the user form

Branch `feat/employee-email-suggestions`, from `development`.

## Goal

An employee record can carry an **email** (optional). In **Tambah User** and
**Edit User**, typing into **NIK** or **Email** shows matching employees; picking
one fills NIK, Nama and Email in one go, so an admin creates an account for a
person who is already in the register without retyping them.

## Decisions

- `employees.email` is a nullable `text`, trimmed and lowercased on write, and
  must be a company address: **`…@ungguldinamika.co.id`** (owner,
  2026-11-27). Anything else is 422 `validation_failed` on field `email`; the import fails
  the row. One constant, `EMPLOYEE_EMAIL_DOMAIN` in contracts, read by the API
  and the web form. The rule is the employee register's only: an account's
  own email (`users.email`) is not restricted. **Not unique**: it is contact data
  on the register, not a credential — the account's email stays the unique one
  (`users_email_unique`). Two employees sharing an address show as two
  suggestions.
- The suggestions come from a **new endpoint under `/users`**, not from
  `GET /employees`: an account admin needs `users:manage`, not
  `employees:view`, and the suggestion carries only `nik`, `name`, `email` —
  nothing medical, no mess, no permit. Unscoped, like the rest of `/users`.
- Picking a suggestion fills all three fields; an employee without an email
  leaves what is already typed in Email. Typing stays free: a suggestion is a
  shortcut, never required (an account with no employee record, such as a
  Superadmin by email, is still possible).
- A suggestion whose NIK already has an account is marked **"Sudah punya
  akun"**, so the admin sees the duplicate before the 409 `nik_taken`.

## API (`apps/api`)

1. `schema.ts`: `employees.email text` (nullable) → `bun run db:generate`
   (migration 0066).
2. `employees.ts`: `email` on create/patch (`t.Optional(t.Nullable(t.String()))`,
   blank → null), in the employee query and `EmployeeSchema`; the list search
   `q` matches email too. The integrations' own `EmployeeSchema` is left as is.
3. Employee import (`master-import.ts`, `EMPLOYEE_IMPORT_COLUMNS` in
   contracts): optional column `email` after `nama`; a blank cell keeps the
   current value (same rule as `telepon`); a malformed one fails the row. Old
   files without the column still import (only `nik` is required). Export and
   template carry it.
4. New `GET /v1/users/employee-suggestions?q=` (`users:manage`):
   - `q` trimmed, 2–100 chars, else `[]`;
   - matches `nik ILIKE 'q%'` or `email ILIKE '%q%'` (`%`/`_` escaped);
   - at most 8, NIK prefix matches first, then by NIK;
   - answers `{ nik, name, email, hasAccount }[]`.
5. Tests first: employees email create/patch/blank/invalid, import column
   (new, update, blank keeps, invalid, old file), suggestions (NIK prefix,
   email substring, limit, `hasAccount`, short `q`, wildcard escaping, 403
   without `users:manage`).

## Web (`apps/web`)

1. Employee form + detail: an **Email** field (optional), beside Telepon.
2. `components/ui/async-select.tsx`: add `AsyncSuggest`, a text input that
   shows server suggestions as you type. It shares the option list and the
   keyboard handling (↑ ↓ Enter Esc) with `AsyncSelect`, so no new
   dropdown look and no new library.
3. `um-users.tsx`: NIK and Email use `AsyncSuggest`; pick → fill NIK/Nama/Email
   (pure `applySuggestion` in a `.ts` beside it, with a `bun test`); the
   "Sudah punya akun" mark.
4. `lib/queries/users.ts`: `loadEmployeeSuggestions(q)`.
5. i18n id/en: `efEmailHelp`, `efEmailErr`, `umSuggestHelp`,
   `umSuggestHasAccount` (the detail reuses `cmEmail`).

## Docs

`docs/prd.md` (_Accounts and roles_ → the account form suggests from the
employee register) and `apps/api/docs/schema.md`. Mobile is unaffected: `email` on an
employee is a new field, and the phone decodes with unknown keys ignored.

## Out of scope

Creating an account from the employee page; making the email unique;
sending anything to the address.
