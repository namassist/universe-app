import { Suspense } from "react";
import type { Metadata } from "next";

import PageClient from "./page-client";

export const metadata: Metadata = {
  title: "Display Attendance",
  description:
    "Layar TV attendance shift berjalan — 1920×1080, jam real-time, auto-scroll.",
};

export default function Page() {
  return (
    <Suspense>
      <PageClient />
    </Suspense>
  );
}
