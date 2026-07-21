"use client";

import { ShellProvider } from "./shell-context";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

/**
 * The authenticated app shell (blob glow + sidebar + topbar + content), minus
 * the reference's session gate/route-guard — role is fixed per route. Wrap in a
 * RoleProvider (done by each `app/{role}/layout.tsx`).
 */
export function RoleShell({ children }: { children: React.ReactNode }) {
  return (
    <ShellProvider>
      <div className="pointer-events-none fixed -top-30 -right-25 z-0 size-130 rounded-full bg-(--blob-cyan) blur-[130px]" />
      <div className="pointer-events-none fixed -bottom-35 -left-20 z-0 size-120 rounded-full bg-(--blob-blue) blur-[130px]" />
      <div className="p-6 max-xl:p-4">
        <div className="relative z-1 mx-auto flex min-h-[calc(100vh-48px)] max-w-[1840px] items-stretch gap-6 max-xl:block max-xl:min-h-[calc(100vh-32px)]">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col gap-6">
            <Topbar />
            <div className="flex max-w-360 flex-1 flex-col gap-6">
              {children}
            </div>
          </div>
        </div>
      </div>
    </ShellProvider>
  );
}
