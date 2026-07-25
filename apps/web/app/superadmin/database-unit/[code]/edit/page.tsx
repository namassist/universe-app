import { UnitForm } from "@/components/menus/unit-form";

export const metadata = { title: "Edit Unit" };

export default async function Page({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <UnitForm code={decodeURIComponent(code)} />;
}
