import { Suspense } from "react";

import { FitToWorkHistory } from "@/components/menus/fit-to-work-history";

export const metadata = { title: "Riwayat Fit To Work" };

export default function Page() {
  return (
    <Suspense>
      <FitToWorkHistory />
    </Suspense>
  );
}
