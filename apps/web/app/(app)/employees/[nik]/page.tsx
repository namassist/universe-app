import { EmployeeDetail } from "@/components/menus/employees-detail";

export const metadata = { title: "Detail Karyawan" };

export default async function Page({
  params,
}: {
  params: Promise<{ nik: string }>;
}) {
  const { nik } = await params;
  return <EmployeeDetail nik={nik} />;
}
