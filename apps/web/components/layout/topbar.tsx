"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { ChevronRight, Globe, Menu, Moon, Sun } from "lucide-react";

import { MENU_LABELS, type MenuSlug } from "@/lib/access";
import { useI18n, type Lang } from "@/lib/i18n";
import { NAV } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { useRole } from "@/components/providers/role-context";
import {
  useTheme,
  type ThemePref,
} from "@/components/providers/theme-provider";
import {
  DropMenu,
  DropMenuRadio,
  DropMenuWrap,
} from "@/components/ui/drop-menu";

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
  const { t } = useI18n();
  const { lang, setLang } = useI18n();
  const { pref, resolved, setTheme } = useTheme();
  const { roleLabel } = useRole();
  const { setSideOpen } = useShell();
  const [openDrop, setOpenDrop] = React.useState<string | null>(null);

  const toggle = (key: string) => setOpenDrop((v) => (v === key ? null : key));
  const close = () => setOpenDrop(null);

  const slug = pathname.split("/")[2] as MenuSlug | undefined;
  const cur = slug ? (MENU_LABELS[slug] ?? "") : "";
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
        {/* language */}
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

        {/* theme */}
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

        {/* static role label (no auth in the static preview) */}
        <span className="ml-1 inline-flex h-9 items-center gap-2 rounded-control border border-(--glass-1-border) bg-(--fill-subtle) px-3 text-xs font-semibold text-(--text-secondary)">
          <span className="text-(--text-tertiary)">Role:</span>
          {roleLabel}
        </span>
      </div>
    </header>
  );
}
