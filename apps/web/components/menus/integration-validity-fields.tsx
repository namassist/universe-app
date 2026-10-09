"use client";

import { Checkbox, ToggleRow } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

import type { ValidityInput } from "./integration-validity";

/**
 * A token's dates — "Berlaku dari" / "Berlaku sampai" date pickers and a
 * "Tanpa batas" box — shared by the add, change-dates and rotate dialogs of
 * the Integrasi API menu. Both ends are inclusive site dates; the problem, if
 * any, is worked out by the caller (`validityProblem`) and shown here.
 */
function ValidityFields({
  idPrefix,
  value,
  problem,
  onChange,
}: {
  idPrefix: string;
  value: ValidityInput;
  problem: string | null;
  onChange: (next: ValidityInput) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Berlaku dari" htmlFor={`${idPrefix}-from`} required>
          <Input
            id={`${idPrefix}-from`}
            type="date"
            value={value.validFrom}
            onChange={(e) => onChange({ ...value, validFrom: e.target.value })}
          />
        </Field>
        <Field
          label="Berlaku sampai"
          htmlFor={`${idPrefix}-until`}
          error={problem !== null}
          errorMessage={problem}
        >
          <Input
            id={`${idPrefix}-until`}
            type="date"
            value={value.noEnd ? "" : value.validUntil}
            min={value.validFrom || undefined}
            disabled={value.noEnd}
            onChange={(e) => onChange({ ...value, validUntil: e.target.value })}
          />
        </Field>
      </div>
      <ToggleRow>
        <Checkbox
          checked={value.noEnd}
          onChange={(e) => onChange({ ...value, noEnd: e.target.checked })}
        />
        Tanpa batas
      </ToggleRow>
    </div>
  );
}

export { ValidityFields };
