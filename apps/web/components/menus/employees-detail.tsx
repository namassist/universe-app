"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Briefcase,
  Camera,
  Heart,
  House,
  IdCard,
  Maximize2,
  Pencil,
  Search,
} from "lucide-react";

import type { EmployeeStatus } from "@universe/contracts";

import { useI18n } from "@/lib/i18n";
import {
  employeeQueryOptions,
  photoUrl,
  type EmployeeRow,
} from "@/lib/queries/employees";
import { cn } from "@/lib/utils";
import { useRole } from "@/components/providers/role-context";
import { Avatar, initialsOf } from "@/components/ui/avatar";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogTitle,
} from "@/components/ui/dialog";
import { Panel, SectionTitle } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { StateBox } from "@/components/ui/state-box";

/** How close to expiry a date has to be before it is coloured as a warning. */
const EXPIRING_DAYS = 60;

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

/**
 * The photo, and what can be done with it.
 *
 * A 96px avatar is too small to confirm a face against the person standing in
 * front of you, which is the one thing this screen is opened for in the field —
 * so the photo opens full size. A real `<button>` rather than a click handler on
 * the avatar: this is the only interactive element in the header that is not
 * already one, and keyboard and screen-reader users need it to announce itself.
 *
 * With no photo stored, the same square becomes the way to add one, but only for
 * a caller who may write. For a read-only caller there is nothing to do with it
 * and it stays inert rather than offering an action that would 403.
 */
function PhotoBlock({
  emp,
  canW,
  onAdd,
}: {
  emp: EmployeeRow;
  canW: boolean;
  onAdd: () => void;
}) {
  const { t } = useI18n();
  const [zoomed, setZoomed] = React.useState(false);
  const src = photoUrl(emp);

  const avatar = (
    <Avatar
      src={src}
      alt={emp.name}
      className="size-24 rounded-card text-[28px] shadow-[0_0_0_3px_var(--ring-avatar),0_0_24px_rgba(0,212,255,.3)]"
    >
      {initialsOf(emp.name)}
    </Avatar>
  );

  if (!src && !canW)
    return (
      <div className="flex-none" title={t.edPhotoNone}>
        {avatar}
      </div>
    );

  const label = src ? t.edPhotoView : t.edPhotoAdd;
  const Icon = src ? Maximize2 : Camera;

  return (
    <>
      <button
        type="button"
        onClick={src ? () => setZoomed(true) : onAdd}
        aria-label={`${label} — ${emp.name}`}
        title={label}
        className={cn(
          "group relative flex-none rounded-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
          src ? "cursor-zoom-in" : "cursor-pointer"
        )}
      >
        {avatar}
        {/* Hidden until hover or keyboard focus: the photo is the content here,
            and an icon parked on top of a face permanently is noise. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 grid place-items-center rounded-card bg-(--scrim) opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
        >
          <Icon className="size-5" />
        </span>
      </button>

      {src ? (
        <Dialog
          open={zoomed}
          onClose={() => setZoomed(false)}
          labelledBy="ed-photo-t"
          className="w-[min(520px,100%)]"
        >
          <DialogTitle id="ed-photo-t">{emp.name}</DialogTitle>
          <DialogBody className="font-mono">NIK {emp.nik}</DialogBody>
          {/* Served by the API behind a session cookie, which the Next image
              optimizer cannot forward — the same reason `Avatar` uses <img>. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={emp.name}
            /* `contain`, unlike the avatar's `cover`: a photo stored before
               cropping existed is not square, and a viewer that crops what it
               is meant to reveal is worse than a letterboxed one. */
            className="mt-4 max-h-[min(60dvh,520px)] w-full rounded-card bg-(--fill-subtle) object-contain"
          />
          <DialogActions>
            <Button variant="secondary" onClick={() => setZoomed(false)}>
              {t.btnClose}
            </Button>
          </DialogActions>
        </Dialog>
      ) : null}
    </>
  );
}

function expTone(exp: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(`${exp}T00:00:00`);
  if (d.getTime() < today.getTime()) return "text-(--color-danger-text)";
  const days = (d.getTime() - today.getTime()) / 86400000;
  return days <= EXPIRING_DAYS
    ? "text-(--badge-warning-text)"
    : "text-(--text-tertiary)";
}

export function EmployeeDetail({ nik }: { nik: string }) {
  const { t } = useI18n();
  const { access } = useRole();
  const router = useRouter();
  const canW = access("employees") === "manage";
  const listHref = `/employees`;

  const empQ = useQuery(employeeQueryOptions(nik));
  const emp = empQ.data;

  if (empQ.isPending) {
    return (
      <Panel>
        <Skeleton className="h-24" />
      </Panel>
    );
  }

  // A record outside the caller's scope answers 404 rather than 403 — the
  // predicate is in the where clause, so out-of-scope and absent are the same
  // answer, which is the point of putting it there (design D9).
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

  const statusMap: Record<EmployeeStatus, { v: BadgeVariant; l: string }> = {
    aktif: { v: "success", l: t.stAktif },
    standby: { v: "warning", l: t.stStandby },
    nonaktif: { v: "danger", l: t.stNonaktif },
  };
  const st = statusMap[emp.status];

  return (
    <div className="flex flex-col gap-6">
      <Panel>
        <div className="flex flex-wrap items-center gap-6">
          <PhotoBlock
            emp={emp}
            canW={canW}
            onAdd={() => router.push(`${listHref}/${emp.nik}/edit`)}
          />
          <div className="min-w-65 flex-1">
            <h1 className="text-2xl font-bold">{emp.name}</h1>
            <div className="mt-0.5 font-mono text-sm text-(--text-secondary)">
              NIK {emp.nik} · {emp.companyName}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge variant={st.v} dot>
                {st.l}
              </Badge>
              {emp.simperTypeName ? (
                <Badge variant="info" dot>
                  SIMPER {emp.simperTypeName}
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
            <KvRow label={t.kCompany}>{emp.companyName}</KvRow>
            <KvRow label={t.thDept}>{emp.departmentName}</KvRow>
            <KvRow label={t.thPos}>{emp.positionName}</KvRow>
            <KvRow label={t.kJoin} mono>
              {emp.joinDate}
            </KvRow>
          </Kv>
        </Panel>

        <Panel>
          <SectionTitle>
            <IdCard />
            SIMPER &amp; {t.kLicense}
          </SectionTitle>
          {emp.simperTypeName ? (
            <div className="mb-4 flex items-center gap-3">
              <Badge variant="info">{emp.simperTypeName}</Badge>
              <span className="font-mono text-sm text-(--text-secondary)">
                {emp.simperNo || "—"}
              </span>
              {emp.simperExp ? (
                <span
                  className={cn(
                    "ml-auto font-mono text-xs",
                    expTone(emp.simperExp)
                  )}
                >
                  s/d {emp.simperExp}
                </span>
              ) : null}
            </div>
          ) : (
            <div className="mb-4">
              <span className="text-sm text-(--text-tertiary)">
                {t.edKompNone}
              </span>
            </div>
          )}
          <div className="mb-4">
            <div className="mb-2 text-xs text-(--text-tertiary)">
              {t.efSkills}
            </div>
            {/* What the allocation engine matches against a unit's own
                qualification code — references, never text (design D4). */}
            {emp.skills.length ? (
              <div className="flex flex-wrap gap-1.5">
                {emp.skills.map((s) => (
                  <Badge key={s.id} variant="neutral">
                    {s.name}
                  </Badge>
                ))}
              </div>
            ) : (
              <span className="text-sm text-(--text-tertiary)">—</span>
            )}
          </div>
          <Kv>
            <KvRow label={t.kLicenseType}>{emp.license}</KvRow>
          </Kv>
        </Panel>

        <Panel>
          <SectionTitle>
            <Heart />
            {t.secMedical}
          </SectionTitle>
          <Kv>
            <KvRow label={t.kMcu}>{emp.mcu}</KvRow>
            <KvRow label={t.kMcuExp} mono>
              {emp.mcuExp}
            </KvRow>
            <KvRow label={t.kBlood}>{emp.blood}</KvRow>
            <KvRow label={t.kMedHistory}>{emp.medical}</KvRow>
          </Kv>
        </Panel>

        <Panel>
          <SectionTitle>
            <House />
            {t.secMess}
          </SectionTitle>
          <Kv>
            <KvRow label="Mess">{emp.messName}</KvRow>
            <KvRow label={t.kBlock}>{emp.block}</KvRow>
            <KvRow label={t.kRoom} mono>
              {emp.room}
            </KvRow>
            <KvRow label={t.kPhone} mono>
              {emp.phone}
            </KvRow>
            <KvRow label={t.kEmergency}>{emp.emergency}</KvRow>
          </Kv>
        </Panel>
      </div>
    </div>
  );
}
