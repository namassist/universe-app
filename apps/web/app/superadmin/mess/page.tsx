import { MenuPage } from "@/components/menus/registry";

export const metadata = { title: "Mess" };

export default function Page() {
  return <MenuPage slug="mess" mode="manage" />;
}
