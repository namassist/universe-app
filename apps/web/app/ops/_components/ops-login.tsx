"use client";

import * as React from "react";
import {
  CircleAlert,
  Clock3,
  Eye,
  EyeOff,
  Lock,
  ServerCog,
} from "lucide-react";

import { api, errorMessage } from "@/lib/api";
import { Button, Spinner } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel } from "@/components/ui/panel";

/**
 * The Operations Center's door: one shared password, no account.
 *
 * The API decides everything here — a wrong password, a lockout after five
 * tries, an Operations Center switched off — and this form only repeats its
 * words, so the two can never disagree about why the page did not open.
 */
export function OpsLogin({
  onOpened,
  notice,
}: {
  onOpened: () => void;
  /** Why the form is back, e.g. a session that ran out under an open page. */
  notice?: string;
}) {
  const noticeId = React.useId();
  const [password, setPassword] = React.useState("");
  const [show, setShow] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!password) {
      setError("Masukkan password.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error: failure } = await api.v1.ops.session.post({ password });
    setBusy(false);
    if (failure) {
      setError(errorMessage(failure, "Password tidak bisa diperiksa."));
      return;
    }
    setPassword("");
    onOpened();
  }

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <Panel className="w-full max-w-105">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-icon border border-[rgba(0,212,255,.4)] bg-[rgba(0,212,255,.14)] text-primary-bright [&_svg]:size-5">
            <ServerCog />
          </div>
          <div className="leading-tight">
            <h1 className="text-xl font-semibold">Operations Center</h1>
            <p className="text-sm text-(--text-secondary)">
              UNIVERSE · monitoring aplikasi & muster
            </p>
          </div>
        </div>

        {notice ? (
          <p
            id={noticeId}
            className="mb-5 flex items-center gap-2 rounded-control border border-(--badge-warning-border) bg-(--badge-warning-fill) px-3 py-2.5 text-sm text-(--badge-warning-text)"
          >
            <Clock3 className="size-4 shrink-0" />
            {notice}
          </p>
        ) : null}

        <form onSubmit={submit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-2 text-sm font-medium">
            Password
            <span className="relative">
              <Lock className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-(--text-tertiary)" />
              <Input
                type={show ? "text" : "password"}
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="pr-11 pl-10"
                aria-invalid={error ? true : undefined}
                aria-describedby={notice ? noticeId : undefined}
              />
              <button
                type="button"
                onClick={() => setShow((value) => !value)}
                aria-label={
                  show ? "Sembunyikan password" : "Tampilkan password"
                }
                className="absolute top-1/2 right-3 -translate-y-1/2 text-(--text-tertiary) hover:text-(--text-primary)"
              >
                {show ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </button>
            </span>
          </label>

          {error ? (
            <p
              role="alert"
              className="flex items-center gap-2 text-sm text-(--color-danger-text)"
            >
              <CircleAlert className="size-4 shrink-0" />
              {error}
            </p>
          ) : null}

          <Button type="submit" disabled={busy}>
            {busy ? <Spinner /> : null}
            Buka
          </Button>
        </form>
      </Panel>
    </main>
  );
}
