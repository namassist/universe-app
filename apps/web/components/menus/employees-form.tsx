"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Briefcase,
  Camera,
  Heart,
  House,
  IdCard,
  TriangleAlert,
  Upload,
} from "lucide-react";

import { DEPARTEMEN_NAMES } from "@/lib/departemen-data";
import { findEmployee, MESS_OPTS, SIMPER_TYPES } from "@/lib/employees-data";
import { useI18n } from "@/lib/i18n";
import { SIMPER_CODES } from "@/lib/unit-data";
import { useRole } from "@/components/providers/role-context";
import { initialsOf } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogIcon,
  DialogTitle,
} from "@/components/ui/dialog";
import { Dropzone } from "@/components/ui/dropzone";
import { Field, FormGrid } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { PageTitle, Panel, SectionTitle } from "@/components/ui/panel";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";

type Fields = {
  nama: string;
  nik: string;
  company: string;
  dept: string;
  pos: string;
  join: string;
  license: string;
  simperKat: string;
  simperNomor: string;
  simperExp: string;
  mcu: string;
  mcuExp: string;
  blood: string;
  medis: string;
  mess: string;
  kamar: string;
};

const EMPTY: Fields = {
  nama: "",
  nik: "",
  company: "PT Unggul Dinamika Utama",
  dept: "Mining Operation",
  pos: "",
  join: "",
  license: "",
  simperKat: "",
  simperNomor: "",
  simperExp: "",
  mcu: "Fit",
  mcuExp: "",
  blood: "",
  medis: "",
  mess: "",
  kamar: "",
};

/**
 * Add/edit employee form — static design port. Edit mode prefills from the
 * sample data; submit shows a toast and navigates (nothing is persisted).
 */
export function EmployeeForm({ nik }: { nik?: string }) {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const { role } = useRole();
  const router = useRouter();
  const listHref = `/${role}/employees`;

  const record = nik ? findEmployee(nik) : undefined;
  const [f, setF] = React.useState<Fields>(() =>
    record
      ? {
          nama: record.name,
          nik: record.nik,
          company: record.company,
          dept: record.dept,
          pos: record.pos,
          join: record.join ?? "",
          license: record.license ?? "",
          simperKat: record.simper?.kategori ?? "",
          simperNomor: record.simper?.nomor ?? "",
          simperExp: record.simper?.exp ?? "",
          mcu: record.mcu ?? "Fit",
          mcuExp: record.mcuExp ?? "",
          blood: record.blood ?? "",
          medis: record.medis ?? "",
          mess: record.mess ?? "",
          kamar: record.kamar ?? "",
        }
      : EMPTY
  );
  const [skills, setSkills] = React.useState<string[]>(
    () => record?.simper?.skills ?? []
  );

  const [dzLabel, setDzLabel] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const [errors, setErrors] = React.useState<{
    nama?: boolean;
    nik?: boolean;
  }>({});
  const [dirtyDlg, setDirtyDlg] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  function up<K extends keyof Fields>(key: K, value: Fields[K]) {
    setF((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  function toggleSkill(code: string) {
    setSkills((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
    setDirty(true);
  }

  function filePicked(name: string) {
    setDzLabel(`${name} ${t.efDzReady}`);
    setDirty(true);
  }

  function cancel() {
    if (dirty) setDirtyDlg(true);
    else router.back();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs = {
      nama: !f.nama.trim(),
      nik: !f.nik.trim(),
    };
    setErrors(errs);
    if (errs.nama || errs.nik) {
      pushToast("error", t.toastFormErrT, t.toastFormErrD);
      return;
    }
    const name = f.nama.trim();
    /* static-only: tanpa penyimpanan — toast lalu kembali */
    if (nik) {
      pushToast("success", t.toastSaveT, `${name} ${t.toastSaveD}`);
      router.push(`${listHref}/${nik}`);
    } else {
      pushToast("success", t.toastAddT, `${name} — NIK ${f.nik.trim()}`);
      router.push(listHref);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        title={nik ? `${t.efTitleEdit} — ${record?.name ?? nik}` : t.efTitleAdd}
        sub={t.efSubAdd}
      />

      <form onSubmit={submit} noValidate>
        <div className="flex flex-col gap-6">
          <Panel>
            <SectionTitle>
              <Camera />
              {t.secPhoto}
            </SectionTitle>
            <div className="flex items-start gap-5">
              <div className="grid size-24 flex-none place-items-center rounded-card bg-(image:--gradient-cta) text-[28px] font-bold text-(--color-on-cta) shadow-[0_0_0_3px_var(--ring-avatar),0_0_24px_rgba(0,212,255,.3)]">
                {initialsOf(f.nama || record?.name || "")}
              </div>
              <Dropzone
                className="flex-1"
                icon={<Upload />}
                title={dzLabel ?? t.efDzTitle}
                hint={t.efDzHint}
                aria-label={t.efDzTitle}
                onPick={() => fileRef.current?.click()}
                onDropFile={filePicked}
                dragging={dragging}
                onDragChange={setDragging}
              />
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png"
                className="hidden"
                onChange={(e) => {
                  const name = e.target.files?.[0]?.name;
                  if (name) filePicked(name);
                }}
              />
            </div>
          </Panel>

          <Panel>
            <SectionTitle>
              <Briefcase />
              {t.secEmployment}
            </SectionTitle>
            <FormGrid>
              <Field
                label={t.kFullName}
                htmlFor="ef-nama"
                required
                error={errors.nama}
                errorMessage={t.errNama}
              >
                <Input
                  id="ef-nama"
                  value={f.nama}
                  onChange={(e) => up("nama", e.target.value)}
                />
              </Field>
              <Field
                label="NIK"
                htmlFor="ef-nik"
                required
                helper={t.helpNik}
                error={errors.nik}
                errorMessage={t.errNik}
              >
                <Input
                  id="ef-nik"
                  className="font-mono"
                  value={f.nik}
                  disabled={!!nik}
                  onChange={(e) => up("nik", e.target.value)}
                />
              </Field>
              <Field label={t.kCompany} htmlFor="ef-comp">
                <Select
                  id="ef-comp"
                  value={f.company}
                  onChange={(e) => up("company", e.target.value)}
                >
                  <option>PT Unggul Dinamika Utama</option>
                  <option>PT Unggul Mitra Energi</option>
                </Select>
              </Field>
              <Field label={t.thDept} htmlFor="ef-dept" required>
                <Select
                  id="ef-dept"
                  value={f.dept}
                  onChange={(e) => up("dept", e.target.value)}
                >
                  {DEPARTEMEN_NAMES.map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t.thPos} htmlFor="ef-pos" required>
                <Input
                  id="ef-pos"
                  value={f.pos}
                  onChange={(e) => up("pos", e.target.value)}
                />
              </Field>
              <Field label={t.kJoin} htmlFor="ef-join" required>
                <Input
                  id="ef-join"
                  type="date"
                  className="font-mono"
                  value={f.join}
                  onChange={(e) => up("join", e.target.value)}
                />
              </Field>
            </FormGrid>
          </Panel>

          <Panel>
            <SectionTitle>
              <IdCard />
              SIMPER &amp; {t.kLicense}
            </SectionTitle>
            <FormGrid>
              <Field label="Kategori SIMPER" htmlFor="ef-simkat">
                <Select
                  id="ef-simkat"
                  value={f.simperKat}
                  onChange={(e) => up("simperKat", e.target.value)}
                >
                  <option value="">—</option>
                  {SIMPER_TYPES.map((s) => (
                    <option key={s.kode} value={s.kode}>
                      {s.kode} — {s.nama}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Nomor SIMPER" htmlFor="ef-simno">
                <Input
                  id="ef-simno"
                  className="font-mono"
                  value={f.simperNomor}
                  onChange={(e) => up("simperNomor", e.target.value)}
                />
              </Field>
              <Field label={t.kValidity} htmlFor="ef-simexp">
                <Input
                  id="ef-simexp"
                  type="date"
                  className="font-mono"
                  value={f.simperExp}
                  onChange={(e) => up("simperExp", e.target.value)}
                />
              </Field>
              <Field
                label="Skill (unit)"
                helper="Kode simper unit yang dikuasai operator"
                className="col-span-full"
              >
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-control border border-(--glass-1-border) bg-(--fill-subtle) p-3 sm:grid-cols-3">
                  {SIMPER_CODES.map((code) => (
                    <label
                      key={code}
                      className="flex cursor-pointer items-center gap-2 text-sm"
                    >
                      <Checkbox
                        checked={skills.includes(code)}
                        onChange={() => toggleSkill(code)}
                      />
                      {code}
                    </label>
                  ))}
                </div>
              </Field>
              <Field label="License type" htmlFor="ef-lisensi">
                <Input
                  id="ef-lisensi"
                  value={f.license}
                  onChange={(e) => up("license", e.target.value)}
                />
              </Field>
            </FormGrid>
          </Panel>

          <Panel>
            <SectionTitle>
              <Heart />
              {t.secMedical}
            </SectionTitle>
            <FormGrid>
              <Field label={t.kMcu} htmlFor="ef-mcu">
                <Select
                  id="ef-mcu"
                  value={f.mcu}
                  onChange={(e) => up("mcu", e.target.value)}
                >
                  <option>Fit</option>
                  <option>Fit dengan catatan</option>
                  <option>Unfit sementara</option>
                </Select>
              </Field>
              <Field label="MCU berlaku s/d" htmlFor="ef-mcuexp">
                <Input
                  id="ef-mcuexp"
                  type="date"
                  className="font-mono"
                  value={f.mcuExp}
                  onChange={(e) => up("mcuExp", e.target.value)}
                />
              </Field>
              <Field label={t.kBlood} htmlFor="ef-blood">
                <Select
                  id="ef-blood"
                  value={f.blood}
                  onChange={(e) => up("blood", e.target.value)}
                >
                  <option value="">—</option>
                  <option>A</option>
                  <option>B</option>
                  <option>AB</option>
                  <option>O</option>
                </Select>
              </Field>
              <Field
                label={t.kMedHistory}
                htmlFor="ef-medis"
                helper={t.helpMedis}
                className="col-span-full"
              >
                <Textarea
                  id="ef-medis"
                  placeholder={t.phMedis}
                  value={f.medis}
                  onChange={(e) => up("medis", e.target.value)}
                />
              </Field>
            </FormGrid>
          </Panel>

          <Panel>
            <SectionTitle>
              <House />
              Mess
            </SectionTitle>
            <FormGrid>
              <Field label="Mess" htmlFor="ef-mess">
                <Select
                  id="ef-mess"
                  value={f.mess}
                  onChange={(e) => up("mess", e.target.value)}
                >
                  <option value="">{t.optNoMess}</option>
                  {MESS_OPTS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t.kRoom} htmlFor="ef-kamar">
                <Input
                  id="ef-kamar"
                  className="font-mono"
                  value={f.kamar}
                  onChange={(e) => up("kamar", e.target.value)}
                />
              </Field>
            </FormGrid>
          </Panel>

          <div className="sticky bottom-4 z-20 flex items-center justify-end gap-3 rounded-panel px-6 py-4 glass-panel">
            {dirty ? (
              <span className="mr-auto inline-flex items-center gap-1.5 text-xs text-(--text-tertiary)">
                <span className="size-[7px] rounded-full bg-(--color-warning)" />
                {t.efUnsaved}
              </span>
            ) : null}
            <Button type="button" variant="ghost" onClick={cancel}>
              {t.btnCancel}
            </Button>
            <Button type="submit">{nik ? t.efSaveEdit : t.efSaveAdd}</Button>
          </div>
        </div>
      </form>

      <Dialog
        open={dirtyDlg}
        onClose={() => setDirtyDlg(false)}
        labelledBy="dirty-t"
      >
        <DialogIcon variant="warning">
          <TriangleAlert />
        </DialogIcon>
        <DialogTitle id="dirty-t">{t.dirtyTitle}</DialogTitle>
        <DialogBody>{t.dirtyBody}</DialogBody>
        <DialogActions>
          <Button variant="ghost" onClick={() => setDirtyDlg(false)}>
            {t.dirtyStay}
          </Button>
          <Button variant="destructive" onClick={() => router.back()}>
            {t.dirtyLeave}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
