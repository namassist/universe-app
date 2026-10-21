"use client";

import * as React from "react";

import { en } from "./en";
import { id, type Dict } from "./id";

export type { Dict };
export { fmt } from "./fmt";
export { menuLabel, menuLabelKey } from "./menu-labels";
export {
  reportDescription,
  reportLabel,
  runTextKindLabel,
  shiftKindLabel,
  soundOffsetText,
  timelineActionText,
} from "./contract-labels";

export type Lang = "id" | "en";

const dicts: Record<Lang, Dict> = { id, en };

type I18nContextValue = {
  lang: Lang;
  t: Dict;
  setLang: (lang: Lang) => void;
};

const I18nContext = React.createContext<I18nContextValue>({
  lang: "id",
  t: id,
  setLang: () => {},
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = React.useState<Lang>("id");

  React.useEffect(() => {
    const id = setTimeout(() => {
      try {
        const saved = localStorage.getItem("universe-lang") as Lang | null;
        if (saved === "en" || saved === "id") setLangState(saved);
      } catch {}
    }, 0);
    return () => clearTimeout(id);
  }, []);

  const setLang = React.useCallback((next: Lang) => {
    setLangState(next);
    document.documentElement.lang = next;
    try {
      localStorage.setItem("universe-lang", next);
    } catch {}
  }, []);

  const value = React.useMemo(
    () => ({ lang, t: dicts[lang], setLang }),
    [lang, setLang]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * One language for a subtree, whatever the reader picked elsewhere.
 *
 * For screens whose language is a decision rather than a preference — the
 * kiosk walls read in Indonesian on every TV and in every preview (owner,
 * 2026-09-19) — while their words still come from the dictionary.
 */
const noop = () => {};

export function FixedLanguage({
  lang,
  children,
}: {
  lang: Lang;
  children: React.ReactNode;
}) {
  const value = React.useMemo(
    () => ({ lang, t: dicts[lang], setLang: noop }),
    [lang]
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return React.useContext(I18nContext);
}
