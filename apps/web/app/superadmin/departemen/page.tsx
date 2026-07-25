import { MenuPage } from "@/components/menus/registry";

export const metadata = { title: "Departemen" };

export default function Page() {
  return <MenuPage slug="departemen" mode="manage" />;
}
