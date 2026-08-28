"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, LogIn } from "lucide-react";

import { api, errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { sessionKey } from "@/lib/queries/session";
import { Button, Spinner } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { LogoBadge } from "@/components/ui/logo";

/**
 * `?next=` is attacker-supplied — the proxy only ever writes a real pathname
 * there, but nothing stops a link from carrying anything else, and this runs
 * the moment a person has just typed their password.
 *
 * A leading slash alone is not enough to prove a destination is ours:
 * `//evil.com` starts with one and browsers read it as protocol-relative, so
 * it navigates off-site. `/\evil.com` is normalized the same way. Demand a
 * single slash followed by something that is not another separator.
 */
function safeNext(next: string | null): string | null {
  if (!next || !next.startsWith("/")) return null;
  if (next[1] === "/" || next[1] === "\\") return null;
  return next;
}

/**
 * One identifier field, not two. An account is credentialed by email *or* NIK,
 * and asking the operator to pick which kind they hold is a question the server
 * can answer for itself — it resolves against email first, then NIK.
 */
export function LoginForm() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();

  const [identifier, setIdentifier] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPw, setShowPw] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!identifier.trim() || !password) {
      setError(t.authLoginErr);
      return;
    }
    setBusy(true);
    setError(null);

    const { data, error: failure } = await api.v1.auth.login.post({
      identifier: identifier.trim(),
      password,
    });

    if (failure || !data) {
      setBusy(false);
      setError(errorMessage(failure, t.authLoginErr));
      return;
    }

    // The layout reads the session server-side on the next navigation; drop the
    // cached copy so a stale anonymous result cannot win the race.
    await queryClient.invalidateQueries({ queryKey: sessionKey });

    if (data.principal.mustChangePassword) {
      router.replace("/change-password");
      return;
    }
    router.replace(safeNext(params.get("next")) ?? "/dashboard");
  }

  return (
    <div className="w-[min(420px,100%)] rounded-panel p-8 glass-panel">
      <div className="flex flex-col items-center gap-4 text-center">
        <LogoBadge className="size-20" logoClassName="size-11" />
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {t.loginWelcome}
          </h1>
          <p className="mt-1 text-sm text-(--text-secondary)">
            {t.loginWelcomeSub}
          </p>
        </div>
      </div>

      <form onSubmit={submit} noValidate className="mt-7 flex flex-col gap-4">
        <Field
          label={t.authIdentLabel}
          htmlFor="identifier"
          required
          helper={t.authIdentHelp}
        >
          <Input
            id="identifier"
            name="identifier"
            autoComplete="username"
            autoFocus
            placeholder={t.authIdentPh}
            value={identifier}
            onChange={(e) => {
              setIdentifier(e.target.value);
              setError(null);
            }}
          />
        </Field>

        <Field label={t.pwLabel} htmlFor="password" required>
          <div className="relative">
            <Input
              id="password"
              name="password"
              type={showPw ? "text" : "password"}
              autoComplete="current-password"
              className="pr-11"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(null);
              }}
            />
            <button
              type="button"
              aria-label={t.pwToggle}
              onClick={() => setShowPw((v) => !v)}
              className="absolute inset-y-0 right-0 grid w-11 cursor-pointer place-items-center text-(--text-tertiary) hover:text-(--text-primary) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--color-primary)"
            >
              {showPw ? (
                <EyeOff className="size-4" />
              ) : (
                <Eye className="size-4" />
              )}
            </button>
          </div>
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
          {busy ? <Spinner /> : <LogIn />}
          {busy ? t.loginChecking : t.loginBtn}
        </Button>
      </form>

      <p className="mt-6 text-center text-[11px] text-(--text-tertiary)">
        {t.loginCopy}
      </p>
    </div>
  );
}
