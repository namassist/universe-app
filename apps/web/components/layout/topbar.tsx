"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  ChevronDown,
  ChevronRight,
  Globe,
  LogOut,
  Menu,
  Moon,
  Settings,
  Sun,
  User,
} from "lucide-react";

import { MENU_LABELS, type MenuSlug } from "@/lib/access";
import { useI18n, type Lang } from "@/lib/i18n";
import { NAV } from "@/lib/nav";
import { notifStore, notifToneDot, useNotifs } from "@/lib/notifications-data";
import { ROLE_ACCOUNTS } from "@/lib/um-data";
import { cn } from "@/lib/utils";
import { useRole } from "@/components/providers/role-context";
import {
  useTheme,
  type ThemePref,
} from "@/components/providers/theme-provider";
import { Avatar, initialsOf } from "@/components/ui/avatar";
import {
  DropMenu,
  DropMenuHeading,
  DropMenuItem,
  DropMenuRadio,
  DropMenuWrap,
} from "@/components/ui/drop-menu";
import { useToast } from "@/components/ui/toast";

import { useShell } from "./shell-context";

const hbtnClass =
  "relative inline-flex h-9 min-w-9 cursor-pointer items-center justify-center gap-1.5 rounded-control border border-(--glass-1-border) bg-(--fill-subtle) px-2 text-xs font-bold text-(--text-secondary) hover:border-[rgba(0,212,255,.4)] hover:bg-[rgba(0,212,255,.14)] hover:text-(--text-primary) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-primary) [&_svg]:size-4";

function groupLabelOf(slug: string): string | null {
  for (const e of NAV) {
    if (e.kind === "group" && e.children.some((c) => c.slug === slug))
      return e.label;
  }
  return null;
}

export function Topbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { t, lang, setLang } = useI18n();
  const { pref, resolved, setTheme } = useTheme();
  const { role, roleLabel, access } = useRole();
  const { setSideOpen } = useShell();
  const { pushToast } = useToast();
  const notifs = useNotifs();
  const [openDrop, setOpenDrop] = React.useState<string | null>(null);
  const unread = notifs.filter((n) => !n.read).length;

  const account = ROLE_ACCOUNTS[role];
  const userShort = account.name.trim().split(/\s+/).slice(0, 2).join(" ");

  const toggle = (key: string) => setOpenDrop((v) => (v === key ? null : key));
  const close = () => setOpenDrop(null);

  /* breadcrumb: parent grup (bila ada) + halaman aktif */
  const slug = pathname.split("/")[2] as MenuSlug | undefined;
  let cur = slug ? (MENU_LABELS[slug] ?? "") : "";
  const sub = pathname.split("/")[3];
  if (slug === "employees" && sub === "new") cur = t.efTitleAdd;
  else if (slug === "employees" && sub) cur = t.navEmployees;
  else if (slug === "roster-data" && sub === "upload") cur = t.navR1;
  else if (slug === "roster-data" && sub === "detail") cur = t.rdDetailTitle;
  else if (slug === "roster-revision" && sub === "new") cur = t.revNewTitle;
  else if (slug === "fit-to-work" && sub === "history") cur = t.ftwHistPage;
  else if (slug === "fleet-allocation" && sub === "detail") cur = "ACTUAL";
  else if ((slug as string) === "profile") cur = t.profile;
  else if ((slug as string) === "notifications") cur = t.notifTitle;
  const group = slug ? groupLabelOf(slug) : null;

  return (
    <header className="sticky top-6 z-40 flex h-16 flex-none items-center gap-4 rounded-panel px-6 glass-panel max-xl:top-4">
      <button
        onClick={() => setSideOpen(true)}
        aria-label="Buka menu navigasi"
        className={cn(hbtnClass, "hidden max-xl:inline-flex")}
      >
        <Menu />
      </button>
      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 items-center gap-2 text-sm"
      >
        {group ? (
          <>
            <span className="whitespace-nowrap text-(--text-tertiary)">
              {group}
            </span>
            <ChevronRight className="size-3.5 flex-none text-(--text-disabled)" />
          </>
        ) : null}
        <span className="font-semibold whitespace-nowrap">{cur}</span>
      </nav>

      <div className="ml-auto flex items-center gap-2">
        {/* bahasa */}
        <DropMenuWrap open={openDrop === "lang"} onClose={close}>
          <button
            onClick={() => toggle("lang")}
            aria-expanded={openDrop === "lang"}
            aria-haspopup="menu"
            aria-label="Ganti bahasa"
            className={hbtnClass}
          >
            <Globe />
            <span>{lang.toUpperCase()}</span>
          </button>
          <DropMenu open={openDrop === "lang"} className="w-[190px]">
            {(
              [
                ["id", "Bahasa Indonesia"],
                ["en", "English"],
              ] as [Lang, string][]
            ).map(([code, label]) => (
              <DropMenuRadio
                key={code}
                checked={lang === code}
                onClick={() => {
                  setLang(code);
                  close();
                }}
              >
                {label}
              </DropMenuRadio>
            ))}
          </DropMenu>
        </DropMenuWrap>

        {/* tema */}
        <DropMenuWrap open={openDrop === "theme"} onClose={close}>
          <button
            onClick={() => toggle("theme")}
            aria-expanded={openDrop === "theme"}
            aria-haspopup="menu"
            aria-label="Tema aplikasi"
            className={hbtnClass}
          >
            {resolved === "dark" ? <Moon /> : <Sun />}
          </button>
          <DropMenu open={openDrop === "theme"} className="w-[190px]">
            {(
              [
                ["system", t.themeSystem],
                ["light", t.themeLight],
                ["dark", t.themeDark],
              ] as [ThemePref, string][]
            ).map(([value, label]) => (
              <DropMenuRadio
                key={value}
                checked={pref === value}
                onClick={() => {
                  setTheme(value);
                  close();
                }}
              >
                {label}
              </DropMenuRadio>
            ))}
          </DropMenu>
        </DropMenuWrap>

        {/* notifikasi */}
        <DropMenuWrap open={openDrop === "notif"} onClose={close}>
          <button
            onClick={() => toggle("notif")}
            aria-expanded={openDrop === "notif"}
            aria-haspopup="menu"
            aria-label={t.notifTitle}
            className={hbtnClass}
          >
            <Bell />
            {unread > 0 ? (
              <span className="absolute top-[5px] right-[5px] grid h-[15px] min-w-[15px] place-items-center rounded-lg bg-(--color-danger) px-1 text-[9px] font-bold text-white shadow-[0_0_0_2px_var(--scrim)]">
                {unread}
              </span>
            ) : null}
          </button>
          <DropMenu open={openDrop === "notif"} className="w-[340px]">
            <div className="flex items-center justify-between pr-2">
              <DropMenuHeading>{t.notifTitle}</DropMenuHeading>
              {unread > 0 ? (
                <span className="rounded-chip border border-[rgba(0,212,255,.4)] bg-[rgba(0,212,255,.12)] px-2 py-0.5 text-[11px] font-semibold text-primary-bright">
                  {unread} {t.ntfFUnread.toLowerCase()}
                </span>
              ) : null}
            </div>
            {notifs.slice(0, 5).map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => notifStore.read(n.id)}
                className="flex w-full cursor-pointer gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] leading-normal hover:bg-(--fill-hover)"
              >
                <span
                  className={cn(
                    "mt-1.5 size-[7px] flex-none rounded-full",
                    n.read ? "bg-(--text-disabled)" : notifToneDot[n.tone]
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block",
                      n.read
                        ? "text-(--text-secondary)"
                        : "font-semibold text-(--text-primary)"
                    )}
                  >
                    {lang === "id" ? n.textId : n.textEn}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-(--text-tertiary)">
                    {lang === "id" ? n.timeId : n.timeEn}
                  </span>
                </span>
              </button>
            ))}
            <div className="mt-1 flex items-center justify-between gap-1 border-t border-(--divider) pt-1.5">
              <button
                onClick={() => notifStore.readAll()}
                disabled={unread === 0}
                className="flex h-9 cursor-pointer items-center rounded-lg px-3 text-[13px] font-medium whitespace-nowrap text-(--text-secondary) hover:bg-(--fill-hover) hover:text-(--text-primary) disabled:cursor-default disabled:text-(--text-disabled)"
              >
                {t.markRead}
              </button>
              <button
                onClick={() => {
                  close();
                  router.push(`/${role}/notifications`);
                }}
                className="flex h-9 cursor-pointer items-center rounded-lg px-3 text-[13px] font-medium whitespace-nowrap text-(--color-primary-bright) hover:bg-(--fill-hover)"
              >
                {t.ntfViewAll}
              </button>
            </div>
          </DropMenu>
        </DropMenuWrap>

        {/* menu user */}
        <DropMenuWrap open={openDrop === "user"} onClose={close}>
          <button
            onClick={() => toggle("user")}
            aria-expanded={openDrop === "user"}
            aria-haspopup="menu"
            className="flex h-11 cursor-pointer items-center gap-3 rounded-full border border-transparent pr-2 pl-1 text-(--text-primary) hover:border-(--glass-1-border) hover:bg-(--fill-hover) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-primary)"
          >
            <Avatar>{initialsOf(account.name)}</Avatar>
            <span className="max-md:hidden">
              <b className="block text-left text-[13px] leading-tight font-semibold">
                {userShort}
              </b>
              <span className="text-[11px] text-(--text-tertiary)">
                {roleLabel}
              </span>
            </span>
            <ChevronDown className="size-3.5 text-(--text-tertiary) max-md:hidden" />
          </button>
          <DropMenu open={openDrop === "user"} className="w-56">
            <div className="mb-2 border-b border-(--divider) px-3 pt-2 pb-3">
              <b className="block text-[13px]">{account.name}</b>
              <span className="font-mono text-[11px] text-(--text-tertiary)">
                {account.email}
              </span>
            </div>
            <DropMenuItem
              onClick={() => {
                close();
                router.push(`/${role}/profile`);
              }}
            >
              <User />
              {t.profile}
            </DropMenuItem>
            {access("setting") ? (
              <DropMenuItem
                onClick={() => {
                  close();
                  router.push(`/${role}/setting`);
                }}
              >
                <Settings />
                {t.navSettings}
              </DropMenuItem>
            ) : null}
            <DropMenuItem
              className="text-(--color-danger-text) hover:bg-(--badge-danger-fill) hover:text-(--color-danger-text)"
              onClick={() => {
                close();
                pushToast("info", t.logout, account.email);
                router.push("/");
              }}
            >
              <LogOut />
              {t.logout}
            </DropMenuItem>
          </DropMenu>
        </DropMenuWrap>
      </div>
    </header>
  );
}
