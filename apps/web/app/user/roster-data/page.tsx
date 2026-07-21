import { MenuPage } from "@/components/menus/registry";

export const metadata = { title: "Data Roster" };

export default function Page() {
  return <MenuPage slug="roster-data" mode="view" />;
}
