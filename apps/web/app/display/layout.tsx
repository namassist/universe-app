import { FixedLanguage } from "@/lib/i18n";

/**
 * The kiosk walls read in Indonesian (owner, 2026-09-19) — on the TV and in
 * the preview an English-reading admin opens from the Display menu alike — so
 * the language switch stops at their door. Their words still live in the
 * dictionary.
 */
export default function DisplayLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <FixedLanguage lang="id">{children}</FixedLanguage>;
}
