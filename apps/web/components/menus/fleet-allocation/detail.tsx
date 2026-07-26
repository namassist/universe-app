"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import { useRole } from "@/components/providers/role-context";
import { Button } from "@/components/ui/button";
import { PageTitle } from "@/components/ui/panel";

import { AllocBoard } from "./board";
import type { FaShift } from "./data";

/* Detail ACTUAL satu tanggal+shift — papan ala PLAN berisi hasil generate:
   unit teralokasi, substitusi spare, downtime, dan intervensi manual. */
export function FleetAllocationDetail() {
  const { t } = useI18n();
  const { access } = useRole();
  const router = useRouter();
  const searchParams = useSearchParams();
  const canManage = access("fleet-allocation") === "manage";

  const dParam = searchParams.get("date") ?? "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dParam) ? dParam : "2026-07-21";
  const shift: FaShift =
    searchParams.get("shift") === "malam" ? "malam" : "pagi";
  const shiftLabel = shift === "pagi" ? t.faShiftPagi : t.faShiftMalam;

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={`ACTUAL — ${date}`} sub={`${shiftLabel} — ${t.faSubB}`}>
        <Button
          variant="ghost"
          onClick={() => router.push(`/fleet-allocation?mode=actual`)}
        >
          <ArrowLeft />
          {t.upBack}
        </Button>
      </PageTitle>

      <AllocBoard
        mode="actual"
        canManage={canManage}
        createdAt="04:30"
        generatedAt="05:02"
      />
    </div>
  );
}
