"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import { NAV, type NavEntry } from "@/lib/nav";
import { openDisplay } from "@/lib/open-display";
import { cn } from "@/lib/utils";
import { useRole } from "@/components/providers/role-context";
import { SearchInput } from "@/components/ui/search-input";

import { useShell } from "./shell-context";

const navBtnClass =
  "relative flex h-11 w-full flex-none cursor-pointer items-center gap-3 rounded-control border border-transparent px-3 text-left text-sm font-medium text-(--text-secondary) transition-colors duration-100 hover:bg-(--fill-hover) hover:text-(--text-primary) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--color-primary)";

const activeClass =
  "border-[rgba(0,212,255,.5)] bg-(image:--gradient-nav-active) font-semibold text-(--text-primary) shadow-[0_0_10px_rgba(0,212,255,.4)]";

/**
 * Which nav group (if any) owns the current path, for auto-expand.
 *
 * The slug is the first segment now that routes are no longer prefixed with a
 * role — reading segment 2 would look at the *sub*-page (`/employees/new`) and
 * never match a group.
 */
function groupOfPath(pathname: string): string | null {
  const slug = pathname.split("/")[1];
  if (!slug) return null;
  for (const e of NAV) {
    if (e.kind === "group" && e.children.some((c) => c.slug === slug))
      return e.key;
  }
  return null;
}

export function Sidebar() {
  const pathname = usePathname();
  const { t } = useI18n();
  const { access } = useRole();
  const { collapsed, setCollapsed, sideOpen, setSideOpen } = useShell();
  const settingEntry = NAV.find(
    (e) => e.kind === "item" && e.slug === "setting"
  );
  /* The tree is twenty-odd menus deep once Master is open, and the group a
     menu lives in is not always the one somebody expects it in. Searching
     asks the only question they actually have — "where is X" — so a match
     inside a collapsed group is shown without their having to open it. */
  const [menuQ, setMenuQ] = React.useState("");
  const menuNeedle = menuQ.trim().toLowerCase();
  const searching = menuNeedle.length > 0;
  const hits = (label: string) => label.toLowerCase().includes(menuNeedle);
  /* Taking a result ends the search: the tree the next click reads should be
     the whole tree, not the last query's remains. */
  const clearSearch = () => setMenuQ("");

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

  /* One page set serves every role, so a menu is reachable at its own slug and
     permission alone decides whether it is shown. */
  const hrefOf = (slug: string) => `/${slug}`;
  /* startsWith: sub-halaman (detail/edit/upload) tetap menyalakan induknya */
  const isActive = (slug: string) => pathname.startsWith(hrefOf(slug));

  function renderTop(entry: NavEntry) {
    if (entry.kind === "item") {
      if (!access(entry.slug)) return null;
      if (searching && !hits(entry.label)) return null;
      const Icon = entry.icon;
      return (
        <Link
          key={entry.slug}
          href={hrefOf(entry.slug)}
          onClick={clearSearch}
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

    const visible = entry.children.filter((c) => access(c.slug));
    /* A group whose own name matches keeps all of its menus — someone typing
       "master" is asking for the section, not for a menu called Master. */
    const kids =
      searching && !hits(entry.label)
        ? visible.filter((c) => hits(c.label))
        : visible;
    if (!kids.length) return null;
    /* Only sections a *visible* child opens: one whose every menu this role
       cannot see leaves no orphaned label behind. */
    const headings = kids.filter(
      (c, i) => c.section && c.section !== kids[i - 1]?.section
    ).length;
    const Icon = entry.icon;
    /* While searching the group stands open: its matching menus are the whole
       reason it is still on screen. */
    const expanded = searching || openGroup === entry.key;
    return (
      <React.Fragment key={entry.key}>
        <button
          aria-expanded={expanded}
          onClick={() =>
            setOpenGroup(openGroup === entry.key ? null : entry.key)
          }
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
            expanded ? "py-2 pb-3" : "",
            collapsed && "hidden max-xl:block"
          )}
          /*
           * Computed, not a fixed cap: the box is `overflow-hidden`, so a
           * group taller than its max-height loses its last entries silently —
           * they render in the DOM and are simply never seen. A hardcoded
           * 760px fitted the Master group until it grew past sixteen items.
           * Each child is h-10 (40px) with mt-2 (8px) between, plus the
           * wrapper's py-2/pb-3, plus ~40px for every section heading;
           * overshooting is free, clipping is not.
           */
          style={{
            maxHeight: expanded ? kids.length * 48 + headings * 40 + 24 : 0,
          }}
        >
          {kids.map((c, i) => {
            const heading =
              c.section && c.section !== kids[i - 1]?.section
                ? c.section
                : null;
            const kidClass = cn(
              "relative ml-7.5 flex h-10 w-[calc(100%-30px)] items-center gap-2 rounded-control border border-transparent px-3 text-left text-[13px] text-(--text-secondary) no-underline transition-colors duration-100 hover:bg-(--fill-hover) hover:text-(--text-primary) hover:no-underline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--color-primary) [&+a]:mt-2 [&+button]:mt-2"
            );
            /* kiosk screen: button opens a fullscreen new tab, no in-shell route */
            const body = c.displayUrl ? (
              <button
                onClick={() => {
                  clearSearch();
                  openDisplay(c.displayUrl!);
                }}
                className={cn(kidClass, "cursor-pointer")}
              >
                {c.label}
              </button>
            ) : (
              <Link
                href={hrefOf(c.slug)}
                onClick={clearSearch}
                className={cn(kidClass, isActive(c.slug) && activeClass)}
              >
                {c.label}
              </Link>
            );
            return (
              <React.Fragment key={c.slug}>
                {heading ? (
                  /* A label with a rule running to the edge, not floating grey
                     text at the same indent as the menus: at that indent and
                     weight a heading reads as one more (dimmer) row, which is
                     the opposite of what a divider is for. The rule is what
                     makes the break unmistakable at a glance. */
                  <div className="mt-4 mb-2 ml-7.5 flex items-center gap-2.5 pr-3 first:mt-0.5">
                    <span className="text-[10px] font-bold tracking-[0.14em] whitespace-nowrap text-(--text-secondary) uppercase">
                      {heading}
                    </span>
                    <span className="h-px flex-1 bg-(--divider)" />
                  </div>
                ) : null}
                {body}
              </React.Fragment>
            );
          })}
        </div>
      </React.Fragment>
    );
  }

  const topRendered = NAV.filter(
    (e) => !(e.kind === "item" && e.slug === "setting")
  ).map(renderTop);
  /* Rendered up front so the divider above it can be dropped when a search
     leaves nothing behind it. */
  const settingNode =
    settingEntry && access("setting") ? renderTop(settingEntry) : null;

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
        {/* Above the tree rather than in the header: it acts on what is
            below it, and the header is about the product. Hidden while the
            rail is collapsed — there is no room for a field, and the icons it
            would filter carry no visible label to match. */}
        <div className={cn("mb-2 px-0.5", collapsed && "hidden max-xl:block")}>
          <SearchInput
            className="h-9 w-full"
            inputClassName="text-[13px]"
            placeholder={t.navSearch}
            aria-label={t.navSearch}
            value={menuQ}
            onChange={(e) => setMenuQ(e.target.value)}
            onClear={() => setMenuQ("")}
            clearLabel={t.clearSearch}
          />
        </div>
        <nav className="scrollbar-none flex min-h-0 flex-1 flex-col gap-0.5 overflow-x-hidden overflow-y-auto">
          {searching &&
          topRendered.every((node) => node === null) &&
          !settingNode ? (
            <p className="px-3 py-2 text-[13px] text-(--text-tertiary)">
              {t.navNoMatch}
            </p>
          ) : (
            topRendered
          )}
        </nav>
        {/* Setting selalu terlihat di dasar sidebar — di luar area scroll */}
        {settingNode ? (
          <>
            <div className="mx-2 my-4 border-t border-(--divider)" />
            {settingNode}
          </>
        ) : null}
      </aside>
    </>
  );
}
