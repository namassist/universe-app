"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";

import type { AccessMode } from "@/lib/access";
import { useI18n } from "@/lib/i18n";
import { DNote, PageTitle } from "@/components/ui/panel";
import { Segmented, SegmentedButton } from "@/components/ui/segmented";

import { ActualTable } from "./fleet-allocation/actual-table";
import { AllocBoard } from "./fleet-allocation/board";

type Mode = "plan" | "actual";

/* Papan dua lapis: tab PLAN = pasangan tetap unit ↔ maks. 2 operator;
   tab ACTUAL = tabel riwayat per tanggal+shift (Tambah = lock, Generate =
   substitusi spare, Detail = papan hasil generate). Static design port. */
function FleetAllocationInner({ mode: access }: { mode: AccessMode }) {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const canManage = access === "manage";
  const [mode, setMode] = React.useState<Mode>(
    searchParams.get("mode") === "actual" ? "actual" : "plan"
  );

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={t.navFleetAlloc} sub={t.faSubB}>
        <Segmented role="group" aria-label="Mode">
          <SegmentedButton
            active={mode === "plan"}
            onClick={() => setMode("plan")}
          >
            {t.faModePlan}
          </SegmentedButton>
          <SegmentedButton
            active={mode === "actual"}
            onClick={() => setMode("actual")}
          >
            {t.faModeActual}
          </SegmentedButton>
        </Segmented>
      </PageTitle>

      {mode === "plan" ? (
        <>
          <AllocBoard mode="plan" canManage={canManage} />
          <DNote title={t.faNoteT}>{t.faNoteB}</DNote>
        </>
      ) : (
        <ActualTable canManage={canManage} />
      )}
    </div>
  );
}

export function FleetAllocationMenu({ mode }: { mode: AccessMode }) {
  return (
    <React.Suspense>
      <FleetAllocationInner mode={mode} />
    </React.Suspense>
  );
}
