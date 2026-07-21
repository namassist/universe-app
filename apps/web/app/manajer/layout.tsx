import { RoleShell } from "@/components/layout/role-shell";
import { RoleProvider } from "@/components/providers/role-context";

export default function ManajerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RoleProvider role="manajer">
      <RoleShell>{children}</RoleShell>
    </RoleProvider>
  );
}
