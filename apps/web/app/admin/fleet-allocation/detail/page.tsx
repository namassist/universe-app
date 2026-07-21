import { Suspense } from "react";

import { FleetAllocationDetail } from "@/components/menus/fleet-allocation/detail";

export const metadata = { title: "Detail ACTUAL" };

export default function Page() {
  return (
    <Suspense>
      <FleetAllocationDetail />
    </Suspense>
  );
}
