import { MenuPage } from "@/components/menus/registry";

export const metadata = { title: "Jenis Unit" };

export default function Page() {
  return <MenuPage slug="jenis-unit" mode="manage" />;
}
