import { MenuPage } from "@/components/menus/registry";

export const metadata = { title: "Setting" };

export default function Page() {
  return <MenuPage slug="setting" mode="manage" />;
}
