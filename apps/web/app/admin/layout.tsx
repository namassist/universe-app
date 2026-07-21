import { RoleShell } from "@/components/layout/role-shell";
import { RoleProvider } from "@/components/providers/role-context";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RoleProvider role="admin">
      <RoleShell>{children}</RoleShell>
    </RoleProvider>
  );
}
