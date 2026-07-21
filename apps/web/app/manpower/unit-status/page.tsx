import { MenuPage } from "@/components/menus/registry";

export const metadata = { title: "Status Unit" };

export default function Page() {
  return <MenuPage slug="unit-status" mode="manage" />;
}
