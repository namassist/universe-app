"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { NAV, type NavEntry } from "@/lib/nav";
import { openDisplay } from "@/lib/open-display";
import { cn } from "@/lib/utils";
import { useRole } from "@/components/providers/role-context";

import { useShell } from "./shell-context";

const navBtnClass =
  "relative flex h-11 w-full flex-none cursor-pointer items-center gap-3 rounded-control border border-transparent px-3 text-left text-sm font-medium text-(--text-secondary) transition-colors duration-100 hover:bg-(--fill-hover) hover:text-(--text-primary) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--color-primary)";

const activeClass =
  "border-[rgba(0,212,255,.5)] bg-(image:--gradient-nav-active) font-semibold text-(--text-primary) shadow-[0_0_10px_rgba(0,212,255,.4)]";

/** Which nav group (if any) owns the current path, for auto-expand. */
function groupOfPath(pathname: string): string | null {
  const slug = pathname.split("/")[2];
  if (!slug) return null;
  for (const e of NAV) {
    if (e.kind === "group" && e.children.some((c) => c.slug === slug))
      return e.key;
  }
  return null;
}

export function Sidebar() {
  const pathname = usePathname();
  const { role, access } = useRole();
  const { collapsed, setCollapsed, sideOpen, setSideOpen } = useShell();
  const settingEntry = NAV.find(
    (e) => e.kind === "item" && e.slug === "setting"
  );

  const base = `/${role}`;
  const currentGroup = groupOfPath(pathname);
  const [openGroup, setOpenGroup] = React.useState<string | null>(currentGroup);

  React.useEffect(() => {
    if (!currentGroup) return;
    const id = setTimeout(() => setOpenGroup(currentGroup), 0);
    return () => clearTimeout(id);
  }, [currentGroup]);

  // close off-canvas on navigation
  React.useEffect(() => {
    setSideOpen(false);
  }, [pathname, setSideOpen]);

  const hrefOf = (slug: string) => `${base}/${slug}`;
  /* startsWith: sub-halaman (detail/edit/upload) tetap menyalakan induknya */
  const isActive = (slug: string) => pathname.startsWith(hrefOf(slug));

  function renderTop(entry: NavEntry) {
    if (entry.kind === "item") {
      if (!access(entry.slug)) return null;
      const Icon = entry.icon;
      return (
        <Link
          key={entry.slug}
          href={hrefOf(entry.slug)}
          className={cn(
            navBtnClass,
            isActive(entry.slug) && activeClass,
            collapsed && "justify-center px-0 max-xl:justify-start max-xl:px-3"
          )}
          title={collapsed ? entry.label : undefined}
        >
          <Icon className="size-4.5 flex-none" strokeWidth={1.8} />
          <span
            className={cn(
              "flex-1 truncate",
              collapsed && "hidden max-xl:block"
            )}
          >
            {entry.label}
          </span>
        </Link>
      );
    }

    const kids = entry.children.filter((c) => access(c.slug));
    if (!kids.length) return null;
    const Icon = entry.icon;
    const expanded = openGroup === entry.key;
    return (
      <React.Fragment key={entry.key}>
        <button
          aria-expanded={expanded}
          onClick={() => setOpenGroup(expanded ? null : entry.key)}
          className={cn(
            navBtnClass,
            collapsed && "justify-center px-0 max-xl:justify-start max-xl:px-3"
          )}
          title={collapsed ? entry.label : undefined}
        >
          <Icon className="size-4.5 flex-none" strokeWidth={1.8} />
          <span
            className={cn(
              "flex-1 truncate",
              collapsed && "hidden max-xl:block"
            )}
          >
            {entry.label}
          </span>
          <ChevronRight
            className={cn(
              "size-3.5 flex-none text-(--text-tertiary) transition-transform duration-200",
              expanded && "rotate-90",
              collapsed && "hidden max-xl:block"
            )}
            strokeWidth={2}
          />
        </button>
        <div
          className={cn(
            "flex-none overflow-hidden transition-[max-height] duration-250 ease-in-out",
            expanded ? "max-h-[760px] py-2 pb-3" : "max-h-0",
            collapsed && "hidden max-xl:block"
          )}
        >
          {kids.map((c) => {
            const kidClass = cn(
              "relative ml-7.5 flex h-10 w-[calc(100%-30px)] items-center gap-2 rounded-control border border-transparent px-3 text-left text-[13px] text-(--text-secondary) no-underline transition-colors duration-100 hover:bg-(--fill-hover) hover:text-(--text-primary) hover:no-underline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--color-primary) [&+a]:mt-2 [&+button]:mt-2"
            );
            /* kiosk screen: button opens a fullscreen new tab, no in-shell route */
            if (c.displayUrl) {
              return (
                <button
                  key={c.slug}
                  onClick={() => openDisplay(c.displayUrl!)}
                  className={cn(kidClass, "cursor-pointer")}
                >
                  {c.label}
                </button>
              );
            }
            return (
              <Link
                key={c.slug}
                href={hrefOf(c.slug)}
                className={cn(kidClass, isActive(c.slug) && activeClass)}
              >
                {c.label}
              </Link>
            );
          })}
        </div>
      </React.Fragment>
    );
  }

  return (
    <>
      <div
        onClick={() => setSideOpen(false)}
        className={cn(
          "fixed inset-0 z-110 hidden bg-(--scrim) backdrop-blur-[4px]",
          sideOpen && "max-xl:block"
        )}
      />
      <aside
        aria-label="Navigasi utama"
        className={cn(
          "sticky top-6 z-30 flex h-[calc(100vh-48px)] flex-none flex-col self-start rounded-panel px-3 py-5 shadow-[var(--shadow-panel),inset_0_1px_40px_var(--inset-glow)] glass-panel transition-[width] duration-250",
          collapsed ? "w-18 px-2 py-4" : "w-70",
          "max-xl:fixed max-xl:top-0 max-xl:bottom-0 max-xl:left-0 max-xl:z-120 max-xl:h-auto max-xl:w-[min(300px,84vw)] max-xl:rounded-l-none max-xl:bg-(--overlay-fill) max-xl:px-3 max-xl:py-5 max-xl:shadow-(--shadow-modal) max-xl:transition-transform",
          sideOpen ? "max-xl:translate-x-0" : "max-xl:-translate-x-[105%]"
        )}
      >
        <div
          className={cn(
            "flex items-center gap-3 px-2 pt-1 pb-6",
            collapsed && "justify-center px-0 max-xl:justify-start max-xl:px-2"
          )}
        >
          <Image
            src="/logoV1.svg"
            alt="UNIVERSE"
            width={40}
            height={40}
            className="size-10 flex-none"
          />
          <div className={cn(collapsed && "hidden max-xl:block")}>
            <b className="block text-base">UNIVERSE</b>
            <span className="text-xs text-(--text-tertiary)">
              Fleet Automation
            </span>
          </div>
          <button
            onClick={() => setCollapsed(true)}
            aria-label="Ciutkan sidebar"
            title="Ciutkan sidebar"
            className={cn(
              "ml-auto grid size-7 flex-none cursor-pointer place-items-center rounded-lg border border-(--glass-1-border) bg-(--fill-subtle) hover:border-[rgba(0,212,255,.4)] hover:bg-[rgba(0,212,255,.14)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-primary) max-xl:hidden",
              collapsed && "hidden"
            )}
          >
            <ChevronLeft className="size-3.5 text-(--text-secondary)" />
          </button>
        </div>
        <button
          onClick={() => setCollapsed(false)}
          aria-label="Perluas sidebar"
          title="Perluas sidebar"
          className={cn(
            "mx-auto mb-3 grid size-7 flex-none cursor-pointer place-items-center rounded-lg border border-(--glass-1-border) bg-(--fill-subtle) hover:border-[rgba(0,212,255,.4)] hover:bg-[rgba(0,212,255,.14)] max-xl:hidden",
            !collapsed && "hidden"
          )}
        >
          <ChevronRight className="size-3.5 text-(--text-secondary)" />
        </button>
        <nav className="scrollbar-none flex min-h-0 flex-1 flex-col gap-0.5 overflow-x-hidden overflow-y-auto">
          {NAV.filter((e) => !(e.kind === "item" && e.slug === "setting")).map(
            renderTop
          )}
        </nav>
        {/* Setting selalu terlihat di dasar sidebar — di luar area scroll */}
        {settingEntry && access("setting") ? (
          <>
            <div className="mx-2 my-4 border-t border-(--divider)" />
            {renderTop(settingEntry)}
          </>
        ) : null}
      </aside>
    </>
  );
}
