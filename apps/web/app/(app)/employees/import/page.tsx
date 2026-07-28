import { MasterImport } from "@/components/menus/master-import";

export const metadata = { title: "Import Karyawan" };

export default function Page() {
  return <MasterImport target="employees" />;
}
