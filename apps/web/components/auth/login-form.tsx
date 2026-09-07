"use client";

import * as React from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  BarChart2,
  CircleAlert,
  Clock,
  Eye,
  EyeOff,
  IdCard,
  Lock,
  Truck,
} from "lucide-react";

import { api, errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { sessionKey } from "@/lib/queries/session";
import { cn } from "@/lib/utils";
import { APP_VERSION } from "@/lib/version";
import { Spinner } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UniverseLogo } from "@/components/ui/logo";
import { LogoBadge3D } from "@/components/ui/logo-3d";

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
 * Darkens the photo from the bottom up so the hero type keeps its contrast.
 *
 * Only the bottom: the asset already carries its own dark band across the top,
 * which is what the brand sits on, and tinting there again just muddies it.
 */
const VIGNETTE =
  "linear-gradient(to bottom, transparent 0%, transparent 45%, rgba(1,19,46,.62) 72%, rgba(1,19,46,.93) 100%)";

/**
 * One card, two columns: the photo and the brand on the left, the form on the
 * right. The card is a fixed 1200x760 and `zoom` shrinks it to fit a 1080p
 * screen without scrolling — scoped to `lg` because below that the card is
 * fluid and already fits, and zooming a fluid card only shrinks its type.
 *
 * Below `lg` the photo column drops out entirely rather than stacking —
 * on a phone it would push the form below the fold, and the form is the only
 * part of this screen anybody came for.
 *
 * One identifier field, not two. An account is credentialed by email *or* NIK,
 * and asking the operator to pick which kind they hold is a question the server
 * can answer for itself — it resolves against email first, then NIK. This is
 * where the design this borrows from differs: it filters the field down to
 * digits as you type, which would eat an email address here.
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

  const features = [
    { icon: Clock, label: t.loginFeat1 },
    { icon: Truck, label: t.loginFeat2 },
    { icon: BarChart2, label: t.loginFeat3 },
  ];

  return (
    <div className="relative flex h-190 w-full max-w-300 overflow-hidden rounded-panel glass-card max-lg:h-auto max-lg:max-w-130 lg:zoom-[0.8]">
      {/* ── left: photo, brand, hero. Always dark — it sits on a photograph, so
             it cannot follow the viewer's theme without losing its contrast. ── */}
      <div
        data-theme="dark"
        className="relative w-1/2 flex-none overflow-hidden text-(--text-primary) max-lg:hidden"
      >
        <Image
          src="/login-bg.avif"
          alt=""
          fill
          priority
          sizes="50vw"
          className="object-cover"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ backgroundImage: VIGNETTE }}
        />

        <div className="relative z-10 flex h-full flex-col justify-between px-15 py-12.5">
          <div className="flex items-center gap-3">
            <UniverseLogo priority className="size-11.5" />
            <div className="leading-tight">
              <p className="text-[28px] font-bold tracking-(--tracking-brand)">
                UNIVERSE
              </p>
              <p className="text-sm font-medium text-(--text-secondary)">
                Fleet Automation System
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-5">
            <div>
              <h1 className="text-[40px] leading-tight font-bold">
                {t.loginHero1}
              </h1>
              <h1 className="bg-(image:--gradient-cta) bg-clip-text text-[40px] leading-tight font-bold text-transparent">
                {t.loginHero2}
              </h1>
            </div>
            <p className="max-w-104.5 text-sm leading-relaxed text-(--text-secondary)">
              {t.loginHeroDesc}
            </p>
            <div className="flex gap-3">
              {features.map((f) => (
                <div
                  key={f.label}
                  className="flex w-30 items-center gap-3 rounded-xl bg-[rgba(255,255,255,.08)] px-3 py-2.5"
                >
                  <div className="grid size-7.5 flex-none place-items-center rounded-lg border border-(--badge-info-border) bg-(--badge-info-fill)">
                    <f.icon
                      className="size-5 text-primary-bright"
                      strokeWidth={1.5}
                    />
                  </div>
                  <span className="text-[10px] leading-snug font-medium">
                    {f.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── right: the form, inside the same card ── */}
      <div className="flex min-w-0 flex-1 flex-col items-center justify-between px-12 py-10 max-lg:gap-8 max-lg:px-8">
        <div className="flex flex-col items-center gap-5 text-center">
          <LogoBadge3D className="size-24" logoClassName="size-11" />
          <div className="flex flex-col items-center gap-1">
            <h2 className="text-[32px] font-bold tracking-(--tracking-brand)">
              {t.loginWelcome}{" "}
              <span role="img" aria-label="wave">
                👋
              </span>
            </h2>
            <p className="text-sm text-(--text-secondary)">
              {t.loginWelcomeSub}
            </p>
          </div>
        </div>

        <div className="w-full max-w-114.5">
          {/* Kept mounted and hidden rather than conditionally rendered: a live
              region a screen reader only meets after the error has arrived is
              one it may never announce. */}
          <div
            role="alert"
            className={cn(
              "mb-5 items-start gap-2 rounded-control border border-(--badge-danger-border) bg-(--badge-danger-fill) px-4 py-3 text-sm leading-normal text-danger-text",
              error ? "flex" : "hidden"
            )}
          >
            <CircleAlert className="mt-0.5 size-4 flex-none" />
            <span>{error}</span>
          </div>

          <form onSubmit={submit} noValidate className="flex flex-col gap-8">
            <div className="flex flex-col gap-2">
              <label htmlFor="identifier" className="text-sm font-medium">
                {t.authIdentLabel}
              </label>
              <div className="relative">
                <IdCard className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-(--text-tertiary)" />
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
                  className="h-13 pl-12"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="password" className="text-sm font-medium">
                {t.pwLabel}
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-(--text-tertiary)" />
                <Input
                  id="password"
                  name="password"
                  type={showPw ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError(null);
                  }}
                  className="h-13 pr-13 pl-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  aria-pressed={showPw}
                  aria-label={t.pwToggle}
                  className="absolute top-1/2 right-2.5 grid size-8 -translate-y-1/2 cursor-pointer place-items-center rounded-lg text-(--text-tertiary) hover:bg-(--fill-hover) hover:text-(--text-primary) focus-visible:outline-2 focus-visible:outline-primary"
                >
                  {showPw ? (
                    <EyeOff className="size-4.25" />
                  ) : (
                    <Eye className="size-4.25" />
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={busy}
              className="mt-3 inline-flex h-13 w-full cursor-pointer items-center justify-center gap-2 rounded-control bg-(image:--gradient-cta) text-base font-bold text-on-cta shadow-(--glow-cta) transition-[box-shadow,background-color,transform] duration-150 hover:-translate-y-px hover:bg-(image:--gradient-cta-hover) hover:shadow-[0_10px_28px_rgba(0,212,255,.5)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:translate-y-0 disabled:cursor-progress"
            >
              {busy ? (
                <Spinner className="size-4 border-[rgba(1,4,22,.3)] border-t-on-cta" />
              ) : null}
              {busy ? t.loginChecking : t.loginBtn}
            </button>
          </form>
        </div>

        <p className="flex items-center justify-center gap-2 text-center text-[12px] text-(--text-tertiary)">
          <span>{t.loginCopy}</span>
          <span aria-hidden>·</span>
          {/* Monospaced so two builds can be told apart at a glance when
              somebody reads it back over the radio. */}
          <span className="font-mono">{APP_VERSION}</span>
        </p>
      </div>
    </div>
  );
}
