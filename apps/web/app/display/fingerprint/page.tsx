import { Suspense } from "react";
import type { Metadata } from "next";

import PageClient from "./page-client";

export const metadata: Metadata = {
  title: "Monitoring Fingerprint",
  description:
    "Layar TV monitoring mesin fingerprint — 1920×1080, status online/offline.",
};

export default function Page() {
  return (
    <Suspense>
      <PageClient />
    </Suspense>
  );
}
