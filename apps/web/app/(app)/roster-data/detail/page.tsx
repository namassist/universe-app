import { Suspense } from "react";

import { RosterDetail } from "@/components/menus/roster-detail";

export const metadata = { title: "Detail Roster" };

export default function Page() {
  return (
    <Suspense>
      <RosterDetail />
    </Suspense>
  );
}
