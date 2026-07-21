import type { ComponentType } from "react";

import type { AccessMode, MenuSlug } from "@/lib/access";

import { DashboardMenu } from "./dashboard";
import { MenuPlaceholder } from "./placeholder";
import { RosterDataMenu } from "./roster-data";

type MenuComponent = ComponentType<{ mode: AccessMode }>;

/**
 * slug → faithful static page. Filled in incrementally; any slug not present
 * falls back to <MenuPlaceholder>. Each role's `page.tsx` renders <MenuPage>.
 */
const REGISTRY: Partial<Record<MenuSlug, MenuComponent>> = {
  dashboard: DashboardMenu,
  "roster-data": RosterDataMenu,
};

export function MenuPage({ slug, mode }: { slug: MenuSlug; mode: AccessMode }) {
  const Comp = REGISTRY[slug];
  if (Comp) return <Comp mode={mode} />;
  return <MenuPlaceholder slug={slug} mode={mode} />;
}
