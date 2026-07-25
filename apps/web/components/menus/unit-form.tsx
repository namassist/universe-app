"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Truck } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import {
  CLS_OPTS,
  DEPT_OPTS,
  EGI_OPTS,
  findUnit,
  MODEL_OPTS,
  PROD_OPTS,
  UNITS,
} from "@/lib/unit-data";
import { useRole } from "@/components/providers/role-context";
import { Button } from "@/components/ui/button";
import { Checkbox, ToggleRow } from "@/components/ui/checkbox";
import { Field, FormGrid } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageTitle, Panel, SectionTitle } from "@/components/ui/panel";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";

export function UnitForm({ code }: { code?: string }) {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const { role } = useRole();
  const router = useRouter();
  const listHref = `/${role}/database-unit`;

  const record = code ? findUnit(code) : undefined;

  const [fCode, setFCode] = React.useState(record?.code ?? "");
  const [fCls, setFCls] = React.useState(record?.cls ?? CLS_OPTS[0]!);
  const [fEgiType, setFEgiType] = React.useState(
    record?.egiType ?? EGI_OPTS[0]!
  );
  const [fEgi, setFEgi] = React.useState(record?.egi ?? MODEL_OPTS[0]!);
  const [fProd, setFProd] = React.useState(record?.product ?? PROD_OPTS[0]!);
  const [fSimper, setFSimper] = React.useState(record?.simper ?? "");
  const [fDept, setFDept] = React.useState(record?.departemen ?? DEPT_OPTS[0]!);
  const [fSerial, setFSerial] = React.useState(record?.serial ?? "");
  const [fEngine, setFEngine] = React.useState(record?.engineBrand ?? "");
  const [fDesc, setFDesc] = React.useState(record?.description ?? "");
  const [fFtw, setFFtw] = React.useState(record?.ftw ?? false);
  const [fActive, setFActive] = React.useState(record?.active ?? true);
  const [errCode, setErrCode] = React.useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const c = fCode.trim().toUpperCase();
    const dup = UNITS.some((u) => u.code === c && u.code !== record?.code);
    const bad = !c || dup;
    setErrCode(bad);
    if (bad) {
      pushToast("error", t.udbErrCode, c || "—");
      return;
    }
    /* static-only: tanpa penyimpanan — toast lalu kembali */
    if (record) {
      pushToast("success", t.udbEditToastT, `${c} — ${fEgi} · ${fProd}`);
    } else {
      pushToast("success", t.udbToastT, `${c} — ${fEgi} · ${fProd}`);
    }
    router.push(listHref);
  }

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
              <Field label="Kelas Unit" htmlFor="uf-cls" required>
                <Select
                  id="uf-cls"
                  value={fCls}
                  onChange={(e) => setFCls(e.target.value)}
                >
                  {CLS_OPTS.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Jenis Unit" htmlFor="uf-type" required>
                <Select
                  id="uf-type"
                  value={fEgiType}
                  onChange={(e) => setFEgiType(e.target.value)}
                >
                  {EGI_OPTS.map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Model" htmlFor="uf-egi" required>
                <Select
                  id="uf-egi"
                  value={fEgi}
                  onChange={(e) => setFEgi(e.target.value)}
                >
                  {MODEL_OPTS.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Merk" htmlFor="uf-prod" required>
                <Select
                  id="uf-prod"
                  value={fProd}
                  onChange={(e) => setFProd(e.target.value)}
                >
                  {PROD_OPTS.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Kode Simper" htmlFor="uf-simper">
                <Input
                  id="uf-simper"
                  value={fSimper}
                  onChange={(e) => setFSimper(e.target.value)}
                />
              </Field>
              <Field label="Departemen" htmlFor="uf-dept" required>
                <Select
                  id="uf-dept"
                  value={fDept}
                  onChange={(e) => setFDept(e.target.value)}
                >
                  {DEPT_OPTS.map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </Select>
              </Field>
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
            <Button type="submit">{record ? t.udbSaveEdit : t.udbAddDo}</Button>
          </div>
        </div>
      </form>
    </div>
  );
}
