import { EmployeeForm } from "@/components/menus/employees-form";

export const metadata = { title: "Edit Karyawan" };

export default async function Page({
  params,
}: {
  params: Promise<{ nik: string }>;
}) {
  const { nik } = await params;
  return <EmployeeForm nik={nik} />;
}
