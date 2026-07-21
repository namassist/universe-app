"use client";

import * as React from "react";

type ShellContextValue = {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  sideOpen: boolean;
  setSideOpen: (v: boolean) => void;
};

const ShellContext = React.createContext<ShellContextValue>({
  collapsed: false,
  setCollapsed: () => {},
  sideOpen: false,
  setSideOpen: () => {},
});

export function ShellProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = React.useState(false);
  const [sideOpen, setSideOpen] = React.useState(false);
  const value = React.useMemo(
    () => ({ collapsed, setCollapsed, sideOpen, setSideOpen }),
    [collapsed, sideOpen]
  );
  return (
    <ShellContext.Provider value={value}>{children}</ShellContext.Provider>
  );
}

export function useShell() {
  return React.useContext(ShellContext);
}
