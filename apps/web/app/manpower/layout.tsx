import { RoleShell } from "@/components/layout/role-shell";
import { RoleProvider } from "@/components/providers/role-context";

export default function ManpowerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RoleProvider role="manpower">
      <RoleShell>{children}</RoleShell>
    </RoleProvider>
  );
}
