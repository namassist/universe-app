import { MenuPage } from "@/components/menus/registry";

export const metadata = { title: "Timeline" };

export default function Page() {
  return <MenuPage slug="timeline" mode="manage" />;
}
