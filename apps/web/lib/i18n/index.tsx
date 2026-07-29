"use client";

import * as React from "react";

import { en } from "./en";
import { id, type Dict } from "./id";

export type { Dict };

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

export function useI18n() {
  return React.useContext(I18nContext);
}
