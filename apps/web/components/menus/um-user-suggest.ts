/**
 * What picking a suggested employee does to the account form.
 *
 * Pure, so it is tested without a component: a pick fills NIK, Nama and Email
 * together; an employee with no email on record leaves the email typed so far.
 */

import type { AsyncOption } from "@/components/ui/async-select";

export type SuggestedEmployee = {
  nik: string;
  name: string;
  email: string | null;
  hasAccount: boolean;
};

export type IdentityFields = { nik: string; name: string; email: string };

export function applySuggestion(
  fields: IdentityFields,
  picked: SuggestedEmployee
): IdentityFields {
  return {
    nik: picked.nik,
    name: picked.name,
    email: picked.email ?? fields.email,
  };
}

/** One row of the list: the name, its email beneath, the NIK at the right. */
export function suggestionOption(
  employee: SuggestedEmployee,
  hasAccountLabel: string
): AsyncOption<SuggestedEmployee> {
  return {
    value: employee.nik,
    label: employee.name,
    sub: employee.nik,
    detail: employee.email ?? undefined,
    tag: employee.hasAccount ? hasAccountLabel : undefined,
    row: employee,
  };
}
