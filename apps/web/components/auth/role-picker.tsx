"use client";

import * as React from "react";
import { ChevronRight, ShieldCheck } from "lucide-react";

import type { RoleOption } from "@universe/contracts";

import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/button";

/**
 * The login's second step, for an account holding several roles: which one
 * this session acts as. Shown only after the password was right, so it never
 * tells a stranger what an account holds.
 *
 * One button per role rather than a select and a confirm: the choice *is* the
 * action, and on a site tablet a tap is cheaper than two.
 */
export function RolePicker({
  roles,
  defaultRoleId,
  pendingRoleId,
  onPick,
  onOther,
}: {
  roles: RoleOption[];
  defaultRoleId: string;
  /** The role being switched to; every button waits while it is set. */
  pendingRoleId: string | null;
  onPick: (roleId: string) => void;
  onOther: () => void;
}) {
  const { t } = useI18n();
  const busy = pendingRoleId !== null;
  const titleId = React.useId();
  const titleRef = React.useRef<HTMLHeadingElement>(null);
  /* The form that had focus is gone; say where the person now is. */
  React.useEffect(() => titleRef.current?.focus(), []);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h3
          id={titleId}
          ref={titleRef}
          tabIndex={-1}
          className="text-lg font-semibold outline-none"
        >
          {t.authPickT}
        </h3>
        <p className="text-sm leading-relaxed text-(--text-secondary)">
          {t.authPickB}
        </p>
      </div>

      <ul
        aria-labelledby={titleId}
        aria-busy={busy}
        className="flex flex-col gap-3"
      >
        {roles.map((role) => (
          <li key={role.id}>
            <button
              type="button"
              disabled={busy}
              onClick={() => onPick(role.id)}
              className={cn(
                "flex h-15 w-full cursor-pointer items-center gap-4 rounded-control border border-(--glass-1-border) bg-(--fill-subtle) px-4 text-left transition-[border-color,background-color,transform] duration-150",
                "hover:-translate-y-px hover:border-[rgba(0,212,255,.4)] hover:bg-[rgba(0,212,255,.08)]",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                "disabled:translate-y-0 disabled:cursor-progress disabled:opacity-60"
              )}
            >
              <span className="grid size-9 flex-none place-items-center rounded-lg border border-(--badge-info-border) bg-(--badge-info-fill)">
                <ShieldCheck
                  className="size-5 text-primary-bright"
                  strokeWidth={1.5}
                />
              </span>
              <span className="min-w-0 flex-1">
                <b className="block truncate text-sm font-semibold">
                  {role.name}
                </b>
                <span className="font-mono text-[11px] text-(--text-tertiary)">
                  {role.scope}
                </span>
              </span>
              {role.id === defaultRoleId ? (
                <Badge variant="info">{t.authPickDefault}</Badge>
              ) : null}
              {pendingRoleId === role.id ? (
                <Spinner className="size-4" />
              ) : (
                <ChevronRight className="size-4 flex-none text-(--text-tertiary)" />
              )}
            </button>
          </li>
        ))}
      </ul>

      <button
        type="button"
        disabled={busy}
        onClick={onOther}
        className="cursor-pointer self-center text-[13px] font-medium text-primary-bright hover:underline disabled:cursor-progress"
      >
        {t.authPickOther}
      </button>
    </div>
  );
}
