import { MenuPage } from "@/components/menus/registry";

export const metadata = { title: "Sound" };

export default function Page() {
  return <MenuPage slug="sound" mode="manage" />;
}
