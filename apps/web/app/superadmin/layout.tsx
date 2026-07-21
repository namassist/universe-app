import { RoleShell } from "@/components/layout/role-shell";
import { RoleProvider } from "@/components/providers/role-context";

export default function SuperadminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RoleProvider role="superadmin">
      <RoleShell>{children}</RoleShell>
    </RoleProvider>
  );
}
