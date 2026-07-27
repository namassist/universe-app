"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Truck } from "lucide-react";

import type { MasterKind } from "@universe/contracts";

import { api, errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { masterQueryOptions, type MasterRecord } from "@/lib/queries/master";
import { unitKey, unitQueryOptions } from "@/lib/queries/units";
import { Button } from "@/components/ui/button";
import { Checkbox, ToggleRow } from "@/components/ui/checkbox";
import { Field, FormGrid } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageTitle, Panel, SectionTitle } from "@/components/ui/panel";
import { Select } from "@/components/ui/select";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { useToast } from "@/components/ui/toast";

/**
 * Add and edit a unit.
 *
 * Every catalogue dropdown reads its own `masterQueryOptions(kind)` with
 * `activeOnly`, so a retired class stops being offered here while the units
 * already pointing at it keep resolving it — that is the whole meaning of the
 * active flag (design: deactivating hides from selection, never invalidates a
 * reference).
 *
 * What is submitted is catalogue **ids**, never names. A name would put the
 * truth back in whatever string this form happened to send, which is exactly
 * what D2 removed.
 */

const CATALOGUE_FIELDS = [
  { key: "classId", kind: "kelas-unit", label: "Kelas Unit", required: true },
  { key: "typeId", kind: "jenis-unit", label: "Jenis Unit", required: true },
  { key: "modelId", kind: "model-unit", label: "Model", required: true },
  { key: "brandId", kind: "merk-unit", label: "Merk", required: true },
  {
    key: "simperCodeId",
    // The qualification catalogue, not the permit-type one (design D4): this is
    // what the allocation engine matches a spare's skills against.
    kind: "kode-simper",
    label: "Kode SIMPER",
    required: false,
  },
  {
    key: "departmentId",
    kind: "departemen",
    label: "Departemen",
    // Optional: a unit no department owns is a company-wide asset. Leaving it
    // blank says so, and is not an unfinished record.
    required: false,
  },
] as const satisfies readonly {
  key: string;
  kind: MasterKind;
  label: string;
  required: boolean;
}[];

type CatalogueKey = (typeof CATALOGUE_FIELDS)[number]["key"];

export function UnitForm({ code }: { code?: string }) {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const router = useRouter();
  const listHref = `/database-unit`;

  const unitQ = useQuery({
    ...unitQueryOptions(code ?? ""),
    enabled: Boolean(code),
  });
  const record = unitQ.data;

  // Active-only: this is a selection list, not a management screen.
  const classes = useQuery(masterQueryOptions("kelas-unit", true));
  const types = useQuery(masterQueryOptions("jenis-unit", true));
  const models = useQuery(masterQueryOptions("model-unit", true));
  const brands = useQuery(masterQueryOptions("merk-unit", true));
  const simperCodes = useQuery(masterQueryOptions("kode-simper", true));
  const departments = useQuery(masterQueryOptions("departemen", true));

  const options: Record<CatalogueKey, MasterRecord[]> = {
    classId: classes.data ?? [],
    typeId: types.data ?? [],
    modelId: models.data ?? [],
    brandId: brands.data ?? [],
    simperCodeId: simperCodes.data ?? [],
    departmentId: departments.data ?? [],
  };

  const [fCode, setFCode] = React.useState("");
  const [refs, setRefs] = React.useState<Record<CatalogueKey, string>>({
    classId: "",
    typeId: "",
    modelId: "",
    brandId: "",
    simperCodeId: "",
    departmentId: "",
  });
  const [fSerial, setFSerial] = React.useState("");
  const [fEngine, setFEngine] = React.useState("");
  const [fDesc, setFDesc] = React.useState("");
  const [fFtw, setFFtw] = React.useState(false);
  const [fActive, setFActive] = React.useState(true);
  const [errCode, setErrCode] = React.useState(false);

  // Seeded once the record arrives, adjusted during render rather than in an
  // effect — React's documented shape for "reset state when the input changes".
  // An effect would render one frame of an empty form over a loaded record.
  const [seededFor, setSeededFor] = React.useState<string | null>(null);
  if (record && seededFor !== record.id) {
    setSeededFor(record.id);
    setFCode(record.code);
    setRefs({
      classId: record.classId,
      typeId: record.typeId,
      modelId: record.modelId,
      brandId: record.brandId,
      simperCodeId: record.simperCodeId ?? "",
      departmentId: record.departmentId ?? "",
    });
    setFSerial(record.serial);
    setFEngine(record.engineBrand);
    setFDesc(record.description);
    setFFtw(record.ftw);
    setFActive(record.active);
  }

  /**
   * A required dropdown shows its first option rather than a blank.
   *
   * Derived at render rather than written into state: the catalogues arrive
   * asynchronously, and storing a default the moment they land would mean the
   * form's value depends on which query resolved first. Reading through here
   * keeps "nothing chosen yet" meaning the first option, whenever that becomes
   * knowable.
   */
  const valueOf = (field: (typeof CATALOGUE_FIELDS)[number]): string => {
    const chosen = refs[field.key];
    if (chosen) return chosen;
    return field.required ? (options[field.key][0]?.id ?? "") : "";
  };

  /** What the dropdowns show and what submitting sends — the same values. */
  const resolved = Object.fromEntries(
    CATALOGUE_FIELDS.map((f) => [f.key, valueOf(f)])
  ) as Record<CatalogueKey, string>;

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        code: fCode.trim().toUpperCase(),
        classId: resolved.classId,
        typeId: resolved.typeId,
        modelId: resolved.modelId,
        brandId: resolved.brandId,
        // Empty is a real state for both — no qualification requirement, no
        // owning department — and both are sent as null rather than omitted, so
        // an edit can clear what an earlier one set.
        simperCodeId: resolved.simperCodeId || null,
        departmentId: resolved.departmentId || null,
        serial: fSerial,
        engineBrand: fEngine,
        description: fDesc,
        ftw: fFtw,
        active: fActive,
      };
      const result = record
        ? await api.v1.units({ code: record.code }).patch(body)
        : await api.v1.units.post(body);
      if (result.error) throw result.error;
      return result.data;
    },
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ["units"] });
      if (data)
        await queryClient.invalidateQueries({ queryKey: unitKey(data.code) });
      pushToast(
        "success",
        record ? t.udbEditToastT : t.udbToastT,
        data ? `${data.code} — ${data.modelName} · ${data.brandName}` : ""
      );
      router.push(listHref);
    },
    // 409 on a duplicate code, 422 naming the catalogue field that did not
    // resolve — the API's message either way, because a generic one would leave
    // the operator guessing which of six dropdowns is wrong.
    onError: (error) =>
      pushToast("error", t.udbErrCode, errorMessage(error, t.loginErr)),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const c = fCode.trim();
    setErrCode(!c);
    if (!c) return;
    save.mutate();
  }

  if (code && unitQ.isPending)
    return (
      <div className="flex flex-col gap-6">
        <PageTitle title={t.udbEditT} sub={t.udbEditB} />
        <Panel>
          <TableSkeleton rows={6} />
        </Panel>
      </div>
    );

  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        title={record ? `${t.udbEditT} — ${record.code}` : t.udbAdd}
        sub={record ? t.udbEditB : t.udbAddB}
      />

      <form onSubmit={submit} noValidate>
        <div className="flex flex-col gap-6">
          <Panel>
            <SectionTitle>
              <Truck />
              {t.navUnitDb}
            </SectionTitle>
            <FormGrid>
              <Field
                label={t.thUnitCode}
                htmlFor="uf-code"
                required
                error={errCode}
                errorMessage={t.udbErrCode}
              >
                <Input
                  id="uf-code"
                  className="font-mono"
                  value={fCode}
                  onChange={(e) => setFCode(e.target.value)}
                />
              </Field>

              {CATALOGUE_FIELDS.map((field) => (
                <Field
                  key={field.key}
                  label={field.label}
                  htmlFor={`uf-${field.key}`}
                  required={field.required}
                >
                  <Select
                    id={`uf-${field.key}`}
                    value={resolved[field.key]}
                    onChange={(e) =>
                      setRefs((prev) => ({
                        ...prev,
                        [field.key]: e.target.value,
                      }))
                    }
                  >
                    {/* An optional reference needs its blank to say what blank
                        means. "—" reads as "not filled in yet" on a department
                        that is deliberately empty. */}
                    {field.required ? null : (
                      <option value="">
                        {field.key === "departmentId"
                          ? `— ${t.udbGlobal}`
                          : "—"}
                      </option>
                    )}
                    {options[field.key].map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              ))}

              <Field label="Machine S/N" htmlFor="uf-serial">
                <Input
                  id="uf-serial"
                  className="font-mono"
                  value={fSerial}
                  onChange={(e) => setFSerial(e.target.value)}
                />
              </Field>
              <Field label="Engine Brand" htmlFor="uf-engine">
                <Input
                  id="uf-engine"
                  value={fEngine}
                  onChange={(e) => setFEngine(e.target.value)}
                />
              </Field>
              <Field label="Description" htmlFor="uf-desc">
                <Input
                  id="uf-desc"
                  value={fDesc}
                  onChange={(e) => setFDesc(e.target.value)}
                />
              </Field>
            </FormGrid>
            <ToggleRow className="mt-4" htmlFor="uf-ftw">
              <Checkbox
                id="uf-ftw"
                checked={fFtw}
                onChange={(e) => setFFtw(e.target.checked)}
              />
              FTW
            </ToggleRow>
            <ToggleRow className="mt-2" htmlFor="uf-active">
              <Checkbox
                id="uf-active"
                checked={fActive}
                onChange={(e) => setFActive(e.target.checked)}
              />
              {t.stAktif}
            </ToggleRow>
          </Panel>

          <div className="sticky bottom-4 z-20 flex items-center justify-end gap-3 rounded-panel px-6 py-4 glass-panel">
            <Button type="button" variant="ghost" onClick={() => router.back()}>
              {t.btnCancel}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {record ? t.udbSaveEdit : t.udbAddDo}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
