import { redirect } from "next/navigation";

import { serverApi } from "@/lib/api";
import { RoleShell } from "@/components/layout/role-shell";
import { RoleProvider } from "@/components/providers/role-context";

/**
 * The authenticated shell. One layout now serves every role — the six per-role
 * layouts collapsed here, because a runtime-created role cannot have a layout
 * written for it ahead of time.
 *
 * This is the first of two real checks (design D10). It resolves the session
 * server-side so the shell never renders against a guessed identity; the
 * second is the macro on every API route, which re-checks independently. A
 * caller who defeats the proxy reaches a shell with no data.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const api = await serverApi();
  const { data, error } = await api.v1.auth.session.get();

  if (error || !data) redirect("/login");

  // A provisioned account authenticates but is refused everywhere else until
  // it sets its own password, so the shell would otherwise render entirely
  // empty and every panel would show a permission error.
  if (data.principal.kind === "user" && data.principal.mustChangePassword)
    redirect("/change-password");

  // Devices belong on /display/*, never in the admin shell.
  if (data.principal.kind === "device") redirect("/login");

  return (
    <RoleProvider principal={data.principal} permissions={data.permissions}>
      <RoleShell>{children}</RoleShell>
    </RoleProvider>
  );
}
