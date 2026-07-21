import { MenuPage } from "@/components/menus/registry";

export const metadata = { title: "Role" };

export default function Page() {
  return <MenuPage slug="roles" mode="manage" />;
}
