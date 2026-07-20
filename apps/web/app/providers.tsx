"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";

import { getQueryClient } from "@/lib/query-client";

/**
 * Client boundary that hands every component below it the same QueryClient.
 * Mounted once in the root layout. `getQueryClient()` returns the browser
 * singleton here, so navigations keep the cache warm.
 *
 * The devtools render nothing in production builds.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient();

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
