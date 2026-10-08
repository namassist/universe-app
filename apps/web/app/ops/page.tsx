import { Suspense } from "react";
import type { Metadata } from "next";

import PageClient from "./page-client";

export const metadata: Metadata = {
  title: "Operations Center",
  description:
    "Kesehatan aplikasi dan muster hari ini — dibuka dengan password Operations Center.",
};

export default function Page() {
  return (
    <Suspense>
      <PageClient />
    </Suspense>
  );
}
