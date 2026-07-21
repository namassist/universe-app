"use client";

import * as React from "react";

export type ThemePref = "system" | "light" | "dark";
export type ThemeResolved = "light" | "dark";

type ThemeContextValue = {
  pref: ThemePref;
  resolved: ThemeResolved;
  setTheme: (pref: ThemePref) => void;
};

const ThemeContext = React.createContext<ThemeContextValue>({
  pref: "system",
  resolved: "dark",
  setTheme: () => {},
});

const KEY = "universe-theme";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [pref, setPref] = React.useState<ThemePref>("system");
  const [resolved, setResolved] = React.useState<ThemeResolved>("dark");

  const apply = React.useCallback((p: ThemePref) => {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const t: ThemeResolved =
      p === "system" ? (mq.matches ? "light" : "dark") : p;
    document.documentElement.setAttribute("data-theme", t);
    setResolved(t);
  }, []);

  React.useEffect(() => {
    const id = setTimeout(() => {
      let saved: ThemePref = "system";
      try {
        saved = (localStorage.getItem(KEY) as ThemePref) || "system";
      } catch {}
      setPref(saved);
      apply(saved);
    }, 0);
    return () => clearTimeout(id);
  }, [apply]);

  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => apply(pref);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref, apply]);

  const setTheme = React.useCallback(
    (p: ThemePref) => {
      setPref(p);
      try {
        localStorage.setItem(KEY, p);
      } catch {}
      apply(p);
    },
    [apply]
  );

  const value = React.useMemo(
    () => ({ pref, resolved, setTheme }),
    [pref, resolved, setTheme]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  return React.useContext(ThemeContext);
}
