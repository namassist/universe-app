"use client";

import * as React from "react";
import { Eye, EyeOff, KeyRound } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import { ROLE_ACCOUNTS } from "@/lib/um-data";
import { useRole } from "@/components/providers/role-context";
import { Avatar, initialsOf } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Field, FormGrid } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageTitle, Panel, SectionTitle } from "@/components/ui/panel";
import { useToast } from "@/components/ui/toast";

/* input password dengan toggle lihat/sembunyikan */
function PwInput({
  id,
  value,
  onChange,
  autoComplete,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
}) {
  const [show, setShow] = React.useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? "text" : "password"}
        autoComplete={autoComplete}
        placeholder="••••••••"
        className="pr-13"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <IconButton
        type="button"
        aria-label={show ? "Sembunyikan" : "Lihat"}
        className="absolute top-1/2 right-1.5 -translate-y-1/2"
        onClick={() => setShow((v) => !v)}
      >
        {show ? <EyeOff /> : <Eye />}
      </IconButton>
    </div>
  );
}

/** Profil akun sesi — identitas dari akun contoh role; simpan = toast. */
export function ProfilePage() {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const { role, roleLabel } = useRole();
  const account = ROLE_ACCOUNTS[role];

  const [name, setName] = React.useState(account.name);
  const [email, setEmail] = React.useState(account.email);
  const [pwCur, setPwCur] = React.useState("");
  const [pwNew, setPwNew] = React.useState("");
  const [pwConf, setPwConf] = React.useState("");
  const [err, setErr] = React.useState<{
    name?: boolean;
    email?: boolean;
    cur?: boolean;
    nw?: boolean;
    conf?: boolean;
  }>({});

  function save() {
    const wantPw = Boolean(pwCur || pwNew || pwConf);
    const e = {
      name: !name.trim(),
      email: !/^\S+@\S+\.\S+$/.test(email.trim()),
      cur: wantPw && !pwCur,
      nw: wantPw && pwNew.length < 8,
      conf: wantPw && pwConf !== pwNew,
    };
    setErr(e);
    if (Object.values(e).some(Boolean)) return;
    if (wantPw) {
      setPwCur("");
      setPwNew("");
      setPwConf("");
      pushToast("success", t.pfPwSavedT, t.pfPwSavedD);
    } else {
      pushToast("success", t.pfSavedT, t.pfSavedD);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={t.profile} sub={t.pfSub} />

      <Panel className="max-w-[760px]">
        {/* identitas akun — NIK & role read-only */}
        <div className="mb-5 flex items-center gap-4">
          <Avatar className="size-14 text-lg">{initialsOf(name)}</Avatar>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <b className="truncate text-lg font-semibold">{name}</b>
              <Badge variant="info">{roleLabel}</Badge>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 font-mono text-[13px] text-(--text-tertiary)">
              <span>{email}</span>
              <span>NIK {account.nik ?? "—"}</span>
            </div>
          </div>
        </div>

        <FormGrid>
          <Field
            label={t.pfName}
            htmlFor="pf-name"
            required
            error={err.name}
            errorMessage={t.errNama}
          >
            <Input
              id="pf-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field
            label={t.pfEmail}
            htmlFor="pf-email"
            required
            error={err.email}
            errorMessage={t.pfErrEmail}
          >
            <Input
              id="pf-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
        </FormGrid>

        <div className="my-5 border-t border-(--divider)" />

        {/* --- ubah password --- */}
        <SectionTitle className="mb-1">
          <KeyRound />
          {t.pfPwT}
        </SectionTitle>
        <p className="mb-4 text-sm text-(--text-secondary)">{t.pfPwOpt}</p>
        <div className="grid grid-cols-3 gap-x-6 gap-y-5 max-md:grid-cols-1">
          <Field
            label={t.pfPwCur}
            htmlFor="pf-pw-cur"
            error={err.cur}
            errorMessage={t.pfPwErrCur}
          >
            <PwInput
              id="pf-pw-cur"
              autoComplete="current-password"
              value={pwCur}
              onChange={setPwCur}
            />
          </Field>
          <Field
            label={t.pfPwNew}
            htmlFor="pf-pw-new"
            helper={t.pfPwHelp}
            error={err.nw}
            errorMessage={t.pfPwErrLen}
          >
            <PwInput
              id="pf-pw-new"
              autoComplete="new-password"
              value={pwNew}
              onChange={setPwNew}
            />
          </Field>
          <Field
            label={t.pfPwConf}
            htmlFor="pf-pw-conf"
            error={err.conf}
            errorMessage={t.pfPwErrConf}
          >
            <PwInput
              id="pf-pw-conf"
              autoComplete="new-password"
              value={pwConf}
              onChange={setPwConf}
            />
          </Field>
        </div>
        <div className="mt-5 flex justify-end">
          <Button onClick={save}>{t.pfSave}</Button>
        </div>
      </Panel>
    </div>
  );
}
