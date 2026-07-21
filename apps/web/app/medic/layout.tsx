import { RoleShell } from "@/components/layout/role-shell";
import { RoleProvider } from "@/components/providers/role-context";

export default function MedicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RoleProvider role="medic">
      <RoleShell>{children}</RoleShell>
    </RoleProvider>
  );
}
