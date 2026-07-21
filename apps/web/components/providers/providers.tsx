"use client";

import { I18nProvider } from "@/lib/i18n";
import { ToastProvider } from "@/components/ui/toast";

import { ThemeProvider } from "./theme-provider";

/**
 * Global, data-free providers for the static app: theme (light/dark), i18n
 * (id/en), and toasts. There is deliberately no data/store provider — per-role
 * access is supplied by RoleProvider inside each `app/{role}/layout.tsx`.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <I18nProvider>
        <ToastProvider>{children}</ToastProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
