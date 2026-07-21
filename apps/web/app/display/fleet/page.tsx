import { Suspense } from "react";
import type { Metadata } from "next";

import PageClient from "./page-client";

export const metadata: Metadata = {
  title: "Display Fleet",
  description:
    "Layar TV alokasi fleet — 1920×1080, rotasi antar fleet, kartu operator.",
};

export default function Page() {
  return (
    <Suspense>
      <PageClient />
    </Suspense>
  );
}
