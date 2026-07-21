import { MenuPage } from "@/components/menus/registry";

export const metadata = { title: "Dashboard" };

export default function Page() {
  return <MenuPage slug="dashboard" mode="manage" />;
}
