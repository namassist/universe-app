import { MenuPage } from "@/components/menus/registry";

export const metadata = { title: "Approval Revisi" };

export default function Page() {
  return <MenuPage slug="roster-approval" mode="manage" />;
}
