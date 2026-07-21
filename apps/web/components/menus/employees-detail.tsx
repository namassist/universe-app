"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Briefcase,
  Heart,
  House,
  IdCard,
  Pencil,
  Search,
} from "lucide-react";

import { findEmployee, type Employee } from "@/lib/employees-data";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useRole } from "@/components/providers/role-context";
import { initialsOf } from "@/components/ui/avatar";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, SectionTitle } from "@/components/ui/panel";
import { StateBox } from "@/components/ui/state-box";

function Kv({ children }: { children: React.ReactNode }) {
  return (
    <dl className="grid grid-cols-[180px_1fr] gap-x-4 gap-y-3 text-sm">
      {children}
    </dl>
  );
}

function KvRow({
  label,
  mono,
  children,
}: {
  label: React.ReactNode;
  mono?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-(--text-tertiary)">{label}</dt>
      <dd className={mono ? "font-mono" : "font-medium"}>
        {children || <span className="text-(--text-tertiary)">—</span>}
      </dd>
    </>
  );
}

function expTone(exp: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(`${exp}T00:00:00`);
  if (d.getTime() < today.getTime()) return "text-(--color-danger-text)";
  const days = (d.getTime() - today.getTime()) / 86400000;
  return days <= 60 ? "text-(--badge-warning-text)" : "text-(--text-tertiary)";
}

export function EmployeeDetail({ nik }: { nik: string }) {
  const { t } = useI18n();
  const { role, access } = useRole();
  const router = useRouter();
  const canW = access("employees") === "manage";
  const listHref = `/${role}/employees`;

  const emp = findEmployee(nik);

  if (!emp) {
    return (
      <Panel>
        <StateBox
          icon={<Search className="text-(--color-primary-bright)" />}
          title={t.noResTitle}
          body={`NIK ${nik}`}
        >
          <Button
            variant="secondary"
            className="mx-auto"
            onClick={() => router.push(listHref)}
          >
            <ArrowLeft />
            {t.back}
          </Button>
        </StateBox>
      </Panel>
    );
  }

  const komps = emp.komp;
  const statusMap: Record<Employee["status"], { v: BadgeVariant; l: string }> =
    {
      aktif: { v: "success", l: "Aktif" },
      cuti: { v: "neutral", l: t.stCuti },
      nonaktif: { v: "danger", l: t.stNonaktif },
    };
  const st = statusMap[emp.status];

  return (
    <div className="flex flex-col gap-6">
      <Panel>
        <div className="flex flex-wrap items-center gap-6">
          <div className="grid size-24 flex-none place-items-center rounded-card bg-(image:--gradient-cta) text-[28px] font-bold text-(--color-on-cta) shadow-[0_0_0_3px_var(--ring-avatar),0_0_24px_rgba(0,212,255,.3)]">
            {initialsOf(emp.name)}
          </div>
          <div className="min-w-65 flex-1">
            <h1 className="text-2xl font-bold">{emp.name}</h1>
            <div className="mt-0.5 font-mono text-sm text-(--text-secondary)">
              NIK {emp.nik} · {emp.company}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge variant={st.v} dot>
                {st.l}
              </Badge>
              {komps[0] ? (
                <Badge variant="info" dot>
                  SIMPER {komps[0].jenis}
                </Badge>
              ) : null}
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => router.push(listHref)}>
              <ArrowLeft />
              {t.back}
            </Button>
            {canW ? (
              <Button
                onClick={() => router.push(`${listHref}/${emp.nik}/edit`)}
              >
                <Pencil />
                {t.empChange}
              </Button>
            ) : null}
          </div>
        </div>
      </Panel>

      <div className="grid grid-cols-2 gap-6 max-[1360px]:grid-cols-1">
        <Panel>
          <SectionTitle>
            <Briefcase />
            {t.secEmployment}
          </SectionTitle>
          <Kv>
            <KvRow label={t.kCompany}>{emp.company}</KvRow>
            <KvRow label={t.thDept}>{emp.dept}</KvRow>
            <KvRow label={t.thPos}>{emp.pos}</KvRow>
            <KvRow label="Equipment type">{emp.equip}</KvRow>
            <KvRow label={t.kJoin} mono>
              {emp.join}
            </KvRow>
            <KvRow label={t.kExp} mono>
              {emp.exp}
            </KvRow>
          </Kv>
        </Panel>

        <Panel>
          <SectionTitle>
            <IdCard />
            SIMPER &amp; {t.kLicense}
          </SectionTitle>
          <div className="mb-4 flex flex-col gap-3">
            {komps.length ? (
              komps.map((k) => (
                <div key={k.jenis} className="flex items-center gap-3">
                  <Badge variant="info">{k.jenis}</Badge>
                  <span className="text-sm text-(--text-secondary)">
                    {(k.egis ?? []).join(", ")}
                  </span>
                  <span
                    className={cn("ml-auto font-mono text-xs", expTone(k.exp))}
                  >
                    s/d {k.exp}
                  </span>
                </div>
              ))
            ) : (
              <span className="text-sm text-(--text-tertiary)">
                {t.edKompNone}
              </span>
            )}
          </div>
          <Kv>
            <KvRow label="License type">{emp.license}</KvRow>
          </Kv>
        </Panel>

        <Panel>
          <SectionTitle>
            <Heart />
            {t.secMedical}
          </SectionTitle>
          <Kv>
            <KvRow label={t.kMcu}>{emp.mcu}</KvRow>
            <KvRow label={t.kMedHistory}>{emp.medis}</KvRow>
            <KvRow label={t.kBlood}>{emp.blood}</KvRow>
            <KvRow label="BPJS Kesehatan" mono>
              {emp.bpjs}
            </KvRow>
          </Kv>
        </Panel>

        <Panel>
          <SectionTitle>
            <House />
            {t.secMess}
          </SectionTitle>
          <Kv>
            <KvRow label="Mess">{emp.mess}</KvRow>
            <KvRow label={t.kRoom} mono>
              {emp.kamar}
            </KvRow>
            <KvRow label={t.kPhone} mono>
              {emp.hp}
            </KvRow>
            <KvRow label={t.kEmergency}>{emp.emg}</KvRow>
          </Kv>
        </Panel>
      </div>
    </div>
  );
}
