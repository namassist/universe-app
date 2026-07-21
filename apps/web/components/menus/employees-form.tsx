"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Briefcase,
  Camera,
  House,
  IdCard,
  Plus,
  Trash2,
  TriangleAlert,
  Upload,
} from "lucide-react";

import {
  findEmployee,
  MESS_OPTS,
  SIMPER_MASTER,
  type Komp,
} from "@/lib/employees-data";
import { useI18n } from "@/lib/i18n";
import { useRole } from "@/components/providers/role-context";
import { initialsOf } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
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
  equip: string;
  join: string;
  exp: string;
  license: string;
  mcu: string;
  medis: string;
  mess: string;
  kamar: string;
};

const EMPTY: Fields = {
  nama: "",
  nik: "",
  company: "PT Unggul Dinamika Utama",
  dept: "Operation",
  pos: "",
  equip: "",
  join: "",
  exp: "",
  license: "",
  mcu: "Fit",
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
          equip: record.equip ?? "",
          join: record.join ?? "",
          exp: record.exp ?? "",
          license: record.license ?? "",
          mcu: record.mcu ?? "Fit",
          medis: record.medis ?? "",
          mess: record.mess ?? "",
          kamar: record.kamar ?? "",
        }
      : EMPTY
  );
  const [kompRows, setKompRows] = React.useState<Komp[]>(() =>
    (record?.komp ?? []).map((k) => ({ ...k }))
  );

  const [dzLabel, setDzLabel] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const [errors, setErrors] = React.useState<{
    nama?: boolean;
    nik?: boolean;
    exp?: boolean;
  }>({});
  const [dirtyDlg, setDirtyDlg] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  function up<K extends keyof Fields>(key: K, value: Fields[K]) {
    setF((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  function kompChange(i: number, key: "jenis" | "exp", value: string) {
    setKompRows((rows) =>
      rows.map((r, idx) =>
        idx === i
          ? {
              ...r,
              [key]: value,
              ...(key === "jenis" ? { egis: SIMPER_MASTER[value] ?? [] } : {}),
            }
          : r
      )
    );
    setDirty(true);
  }
  function kompAdd() {
    setKompRows((rows) => [...rows, { jenis: "", exp: "" }]);
    setDirty(true);
  }
  function kompDel(i: number) {
    setKompRows((rows) => rows.filter((_, idx) => idx !== i));
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
      exp: !!(f.exp && f.join && f.exp <= f.join),
    };
    setErrors(errs);
    if (errs.nama || errs.nik || errs.exp) {
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
                  <option>Operation</option>
                  <option>SDI</option>
                  <option>HRGA</option>
                  <option>Plant</option>
                </Select>
              </Field>
              <Field label={t.thPos} htmlFor="ef-pos" required>
                <Input
                  id="ef-pos"
                  value={f.pos}
                  onChange={(e) => up("pos", e.target.value)}
                />
              </Field>
              <Field label="Equipment type" htmlFor="ef-equip">
                <Input
                  id="ef-equip"
                  value={f.equip}
                  onChange={(e) => up("equip", e.target.value)}
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
              <Field
                label={t.kExp}
                htmlFor="ef-exp"
                helper={t.helpExp}
                error={errors.exp}
                errorMessage={t.errExp}
              >
                <Input
                  id="ef-exp"
                  type="date"
                  className="font-mono"
                  value={f.exp}
                  onChange={(e) => up("exp", e.target.value)}
                />
              </Field>
            </FormGrid>
          </Panel>

          <Panel>
            <SectionTitle>
              <IdCard />
              SIMPER &amp; {t.secMedical}
            </SectionTitle>
            <FormGrid>
              <Field
                label={t.efKompT}
                helper={t.efKompHelp}
                className="col-span-full"
              >
                <div className="flex flex-col gap-3">
                  {kompRows.map((k, i) => (
                    <div
                      key={i}
                      className="grid grid-cols-[220px_1fr_170px_40px] items-center gap-3"
                    >
                      <Select
                        value={k.jenis}
                        onChange={(e) => kompChange(i, "jenis", e.target.value)}
                        aria-label="SIMPER"
                      >
                        <option value="">—</option>
                        {Object.keys(SIMPER_MASTER).map((j) => (
                          <option key={j} value={j}>
                            {j}
                          </option>
                        ))}
                      </Select>
                      <div className="flex min-h-9 flex-wrap items-center gap-1.5">
                        {(k.egis ?? []).length ? (
                          (k.egis ?? []).map((c) => (
                            <Badge key={c} variant="info">
                              {c}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-xs text-(--text-tertiary)">
                            {t.efKompDerived}
                          </span>
                        )}
                      </div>
                      <Input
                        type="date"
                        className="font-mono"
                        value={k.exp}
                        onChange={(e) => kompChange(i, "exp", e.target.value)}
                        aria-label={t.kValidity}
                      />
                      <IconButton
                        type="button"
                        danger
                        onClick={() => kompDel(i)}
                        aria-label={t.empDel}
                      >
                        <Trash2 />
                      </IconButton>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="secondary"
                    className="self-start"
                    onClick={kompAdd}
                  >
                    <Plus />
                    {t.efKompAdd}
                  </Button>
                </div>
              </Field>
              <Field label="License type" htmlFor="ef-lisensi">
                <Input
                  id="ef-lisensi"
                  value={f.license}
                  onChange={(e) => up("license", e.target.value)}
                />
              </Field>
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
