"use client";

import { type AccessMode, type MenuSlug } from "@/lib/access";
import { menuLabel, useI18n } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";

/**
 * Fallback rendered for any menu whose faithful static page has not been built
 * yet. Shows the menu name and the role's access mode.
 */
export function MenuPlaceholder({
  slug,
  mode,
}: {
  slug: MenuSlug;
  mode: AccessMode;
}) {
  const { t } = useI18n();
  return (
    <section className="rounded-panel p-6 shadow-(--shadow-panel) glass-panel">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-(--text-primary)">
          {menuLabel(t, slug)}
        </h1>
        <Badge variant={mode === "manage" ? "success" : "neutral"}>
          {mode === "manage" ? t.phReadWrite : t.phReadOnly}
        </Badge>
      </div>
      <p className="mt-2 text-sm text-(--text-secondary)">
        {t.phPage} <code>{slug}</code> {t.phSoon}
      </p>
    </section>
  );
}
