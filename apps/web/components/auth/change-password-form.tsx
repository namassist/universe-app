"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";

import { api, errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { sessionKey } from "@/lib/queries/session";
import { Button, Spinner } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { LogoBadge } from "@/components/ui/logo";
import { useToast } from "@/components/ui/toast";

/**
 * The forced password change. An imported or reset account authenticates but
 * is refused by every other route until it lands here, so this page has to be
 * reachable with a session that is otherwise good for nothing.
 *
 * The API enforces the policy — a minimum length, and a new password that is
 * not the configured default. This form only relays it; the confirmation field
 * is the one check that belongs here, since it is about typing, not policy.
 */
export function ChangePasswordForm() {
  const { t } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { pushToast } = useToast();

  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [mismatch, setMismatch] = React.useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (next !== confirm) {
      setMismatch(true);
      return;
    }
    setBusy(true);
    setError(null);

    const { error: failure } = await api.v1.auth["change-password"].post({
      currentPassword: current,
      newPassword: next,
    });

    if (failure) {
      setBusy(false);
      setError(errorMessage(failure, t.loginErr));
      return;
    }

    await queryClient.invalidateQueries({ queryKey: sessionKey });
    pushToast("success", t.cpDone, t.pfPwSavedD);
    router.replace("/dashboard");
  }

  async function signOut() {
    await api.v1.auth.logout.post();
    await queryClient.invalidateQueries({ queryKey: sessionKey });
    router.replace("/login");
  }

  return (
    <div className="w-[min(420px,100%)] rounded-panel p-8 glass-panel">
      <div className="flex flex-col items-center gap-4 text-center">
        <LogoBadge className="size-20" logoClassName="size-11" />
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t.cpTitle}</h1>
          <p className="mt-1 text-sm text-(--text-secondary)">{t.cpSub}</p>
        </div>
      </div>

      <form onSubmit={submit} noValidate className="mt-7 flex flex-col gap-4">
        <Field label={t.cpCurrent} htmlFor="cp-current" required>
          <Input
            id="cp-current"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => {
              setCurrent(e.target.value);
              setError(null);
            }}
          />
        </Field>

        <Field label={t.cpNew} htmlFor="cp-new" required>
          <Input
            id="cp-new"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => {
              setNext(e.target.value);
              setMismatch(false);
              setError(null);
            }}
          />
        </Field>

        <Field
          label={t.cpConfirm}
          htmlFor="cp-confirm"
          required
          error={mismatch}
          errorMessage={t.cpMismatch}
        >
          <Input
            id="cp-confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              setMismatch(false);
            }}
          />
        </Field>

        {error ? (
          <p
            role="alert"
            className="rounded-control border border-(--badge-danger-border) bg-(--badge-danger-fill) px-3 py-2.5 text-xs leading-normal text-(--color-danger-text)"
          >
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={busy} className="mt-1 w-full">
          {busy ? <Spinner /> : <KeyRound />}
          {busy ? t.cpSaving : t.cpSubmit}
        </Button>
      </form>

      <button
        type="button"
        onClick={signOut}
        className="mt-5 w-full cursor-pointer text-center text-xs text-(--text-tertiary) hover:text-(--text-primary)"
      >
        {t.cpBackToLogin}
      </button>
    </div>
  );
}
