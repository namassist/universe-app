import { RoleShell } from "@/components/layout/role-shell";
import { RoleProvider } from "@/components/providers/role-context";

export default function UserLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RoleProvider role="user">
      <RoleShell>{children}</RoleShell>
    </RoleProvider>
  );
}
