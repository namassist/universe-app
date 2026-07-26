"use client";

import { QueryClientProvider } from "@tanstack/react-query";

import { I18nProvider } from "@/lib/i18n";
import { getQueryClient } from "@/lib/query-client";
import { ToastProvider } from "@/components/ui/toast";

import { ThemeProvider } from "./theme-provider";

/**
 * Global providers: theme (light/dark), i18n (id/en), toasts, and the
 * TanStack Query cache. Identity is deliberately not here — it is supplied by
 * `RoleProvider` inside `app/(app)/layout.tsx`, which has already resolved the
 * session server-side, so the shell never renders against a guessed role.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <I18nProvider>
          <ToastProvider>{children}</ToastProvider>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
