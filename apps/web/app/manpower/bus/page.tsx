import { MenuPage } from "@/components/menus/registry";

export const metadata = { title: "Bus" };

export default function Page() {
  return <MenuPage slug="bus" mode="manage" />;
}
