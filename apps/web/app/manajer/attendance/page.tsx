import { MenuPage } from "@/components/menus/registry";

export const metadata = { title: "Attendance" };

export default function Page() {
  return <MenuPage slug="attendance" mode="view" />;
}
