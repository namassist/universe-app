import { MenuPage } from "@/components/menus/registry";

export const metadata = { title: "Product / Merek" };

export default function Page() {
  return <MenuPage slug="merk-unit" mode="manage" />;
}
