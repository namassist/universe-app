"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarDays,
  Clock,
  CloudOff,
  IdCard,
  Truck,
  UserCheck,
  XCircle,
} from "lucide-react";

import type { MenuSlug } from "@/lib/access";
import { errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { dashboardQueryOptions } from "@/lib/queries/dashboard";
import { siteClock } from "@/lib/site-clock";
import { useRole } from "@/components/providers/role-context";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Fresh, PageTitle, Panel } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard, StatCardSkeleton } from "@/components/ui/stat-card";
import { StateBox } from "@/components/ui/state-box";

import { DashboardCharts, DashboardChartsSkeleton } from "./dashboard-charts";

const CARD_DANGER = {
  background: "var(--badge-danger-fill)",
  borderColor: "var(--badge-danger-border)",
  color: "var(--color-danger-text)",
};
const CARD_WARNING = {
  background: "var(--badge-warning-fill)",
  borderColor: "var(--badge-warning-border)",
  color: "var(--badge-warning-text)",
};
const CARD_INFO = {
  background: "rgba(0,212,255,.14)",
  borderColor: "rgba(0,212,255,.4)",
  color: "var(--color-primary-bright)",
};
const CARD_SUCCESS = {
  background: "var(--badge-success-fill)",
  borderColor: "var(--badge-success-border)",
  color: "var(--badge-success-text)",
};

/** One labelled fact on the personal strip. */
function MeFact({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: BadgeVariant;
}) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-(--text-tertiary)">{label}</div>
      <Badge variant={tone} className="mt-1">
        {value}
      </Badge>
    </div>
  );
}

/** The personal strip's shape: a name, a NIK, and the four facts. */
function MeSkeleton() {
  return (
    <Panel aria-hidden="true" className="px-6 py-5">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
        <div className="min-w-0">
          <Skeleton className="h-7 w-44" />
          <Skeleton className="mt-1 h-4 w-20" />
        </div>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="min-w-0">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="mt-1 h-6 w-24" />
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function DashboardMenu() {
  const { t, lang } = useI18n();
  const { roleLabel, principal, access } = useRole();
  const dashQ = useQuery(dashboardQueryOptions());
  const data = dashQ.data;

  /**
   * The payload, in the shape the cards below already read.
   *
   * A projection rather than a rewrite of every card: what changed is where
   * the numbers come from, not what they mean. `null` on a section means the
   * API withheld it for want of a grant — which is why the composition below
   * now tests the section rather than re-deriving the permission.
   */
  const facts = React.useMemo(() => {
    /* The board for the shift the payload is about. The API sends both of
       today's, because one card counts the shift and another counts the day —
       picking here keeps the two from having to share a number. */
    const boards = data?.allocation ?? [];
    const board = boards.find((b) => b.shift === data?.shift);
    return {
      att: {
        total: data?.attendance?.scheduled ?? 0,
        present: data?.attendance?.tapped ?? 0,
        belum: Math.max(
          0,
          (data?.attendance?.scheduled ?? 0) - (data?.attendance?.tapped ?? 0)
        ),
      },
      ftw: {
        total: data?.ftw?.scheduled ?? 0,
        kurang: data?.ftw?.followUp ?? 0,
        belum: data?.ftw?.missing ?? 0,
      },
      units: {
        breakdown: data?.units?.breakdown ?? 0,
        codes: data?.units?.breakdownCodes ?? [],
      },
      simper: {
        expired: data?.simper?.expired ?? 0,
        soon: data?.simper?.soon ?? 0,
      },
      alloc: {
        /* This shift's board, for the card that says "shift ini" — it used to
           sum both, so before noon it reported tonight's empty board as part
           of this morning's shortfall. */
        filled: board?.filled ?? 0,
        vacant: Math.max(0, (board?.slots ?? 0) - (board?.filled ?? 0)),
        slots: board?.slots ?? 0,
        /* Null when this shift has no board. Not a zero: "not generated
           yet" and "generated, holding nothing" are different mornings. */
        generatedAt: board?.generatedAt ?? null,
      },
      ingest: data?.ingest ?? null,
      me: data?.me ?? null,
    };
  }, [data]);
  const en = lang === "en";
  const link = (slug: MenuSlug) => `/${slug}`;

  const [freshTime, setFreshTime] = React.useState("");

  React.useEffect(() => {
    const id = setTimeout(() => {
      const d = new Date();
      const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
      setFreshTime(`${pad(d.getHours())}:${pad(d.getMinutes())} WITA`);
    }, 0);
    return () => clearTimeout(id);
  }, []);

  const hour = new Date().getHours();
  const greet =
    hour < 11
      ? t.greetMorning
      : hour < 15
        ? t.greetNoon
        : hour < 19
          ? t.greetAfternoon
          : t.greetEvening;
  /* Named, not implied. Every people-shaped number below is about one shift,
     and the reader has to be told which — a morning figure and an evening one
     look identical on a card. The API decides it; the browser's clock would
     disagree with the site's the moment a laptop is an hour out. */
  const shiftLabel = data?.shift === "night" ? t.dbShiftNight : t.dbShiftDay;
  const dateLine = `${new Date().toLocaleDateString(en ? "en-GB" : "id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  })}${data ? ` · ${shiftLabel}` : ""}`;

  /* ---- card library ---- */
  const cardUnfit = () => (
    <StatCard
      key="unfit"
      href={link("fit-to-work")}
      icon={<XCircle />}
      iconStyle={CARD_DANGER}
      value={String(facts.ftw.kurang)}
      label={t.statUnfit}
      detail={
        <>
          {t.dUnfit1} <b>{t.dUnfit2}</b>
        </>
      }
    />
  );
  const cardAbsen = () => (
    <StatCard
      key="absen"
      href={link("attendance")}
      icon={<Clock />}
      iconStyle={CARD_WARNING}
      value={String(facts.att.belum)}
      label={t.statAbsent}
      detail={
        <>
          {t.dAbsent1} <b>{facts.att.total}</b> {t.dAbsent2}
        </>
      }
    />
  );
  const cardPresent = () => (
    <StatCard
      key="present"
      href={link("attendance")}
      icon={<UserCheck />}
      iconStyle={CARD_SUCCESS}
      value={String(facts.att.present)}
      label={t.statPresent}
      detail={
        <>
          {t.dAbsent1} <b>{facts.att.total}</b> {t.dAbsent2}
        </>
      }
    />
  );
  const cardBreakdown = () => (
    <StatCard
      key="bd"
      href={link("unit-status")}
      icon={<Truck />}
      iconStyle={CARD_DANGER}
      value={String(facts.units.breakdown)}
      label={t.statBreakdown}
      detail={
        <>
          <b>{facts.units.codes[0] ?? "—"}</b>
          {facts.units.codes
            .slice(1)
            .map((code) => ` · ${code}`)
            .join("")}
        </>
      }
    />
  );
  const cardSimper = () => (
    <StatCard
      key="simper"
      href={link("employees")}
      icon={<IdCard />}
      iconStyle={facts.simper.expired ? CARD_DANGER : CARD_SUCCESS}
      value={String(facts.simper.expired)}
      label={t.statSimperExp}
      detail={
        <>
          <b>{facts.simper.soon}</b> {t.dSimperSoon}
        </>
      }
    />
  );
  const cardBelumFtw = () => (
    <StatCard
      key="belum-ftw"
      href={link("fit-to-work")}
      icon={<Clock />}
      iconStyle={CARD_WARNING}
      value={String(facts.ftw.belum)}
      label={t.statFtwBelum}
      detail={
        <>
          {t.dAbsent1} <b>{facts.ftw.total}</b> {t.dOps}
        </>
      }
    />
  );
  const cardAlloc = () => (
    <StatCard
      key="alloc"
      href={link("fleet-allocation")}
      icon={<CalendarDays />}
      iconStyle={CARD_INFO}
      value={String(facts.alloc.filled)}
      label={t.statAllocNow}
      detail={
        <>
          {t.dAbsent1} <b>{facts.alloc.slots}</b> {t.dUnits}
        </>
      }
    />
  );
  /* Its other half, as a number of its own. It was the small print under the
     card above, where a shortfall of 292 read as a footnote to a 0 — and the
     shortfall is the half somebody has to do something about. */
  const cardAllocGap = () => (
    <StatCard
      key="alloc-gap"
      href={link("fleet-allocation")}
      icon={<Truck />}
      iconStyle={facts.alloc.vacant ? CARD_WARNING : CARD_SUCCESS}
      value={String(facts.alloc.vacant)}
      label={t.statAllocGap}
      detail={
        <>
          {t.dAbsent1} <b>{facts.alloc.slots}</b> {t.dUnits}
        </>
      }
    />
  );
  /**
   * Whether this shift's board is out, and when it was generated.
   *
   * It used to count the day's two boards as `1/2`, which answered a question
   * nobody standing at a muster asks: by the time tonight's board matters, it
   * is tonight's shift. The clock is the useful figure — a board generated at
   * 04:10 and one generated at 07:04 are very different mornings, and the
   * second is the one somebody wants to know about.
   */
  const cardActualShift = () => (
    <StatCard
      key="actual-shift"
      href={link("fleet-allocation")}
      icon={<CalendarDays />}
      iconStyle={facts.alloc.generatedAt ? CARD_SUCCESS : CARD_WARNING}
      value={siteClock(facts.alloc.generatedAt)}
      label={t.statActualShift}
      detail={
        facts.alloc.generatedAt ? (
          <>
            <b>{facts.alloc.slots}</b> {t.dUnits}
          </>
        ) : (
          t.dNotGenerated
        )
      }
    />
  );

  /* ---- composition ---- */
  /**
   * The order the owner reads them in (2026-09-18), written as a list rather
   * than as a run of `push` calls so that the order is the thing you see.
   *
   * Two rows of four on a wide screen: the people first — who cannot work,
   * who has not filed, who has not tapped, who is here — then the yard: is
   * the board out, how much of it is crewed, how much is not, what is broken.
   * Left to right is roughly most urgent to least within each row.
   *
   * Gated on the section, not on the grant. The API already applied the
   * permission — a null section is its answer, and re-deriving it here would
   * be a second rule to keep in step with the first. A withheld section
   * leaves a gap rather than shifting everything up, which is the honest
   * reading: the reader is missing a card, not looking at a different one.
   *
   * The SIMPER card below the eight is conditional on its own data rather
   * than on a grant — it is withheld until the register carries expiry dates
   * at all — so it cannot hold a fixed place and appears underneath.
   */
  /**
   * What the page will hold, predicted before the payload says so.
   *
   * The request takes 300–600 ms, and for that long the page used to be a
   * title over nothing: every card, the strip and the charts are rendered
   * only once their section has arrived. A placeholder fixes that, but only
   * if it has the page's eventual *shape* — an operator whose whole dashboard
   * is the personal strip must not watch eight cards and four charts appear
   * and then vanish.
   *
   * So the shape is predicted from the grants the shell already holds, which
   * are the same grants the API gates each section on. This is a prediction
   * and nothing more: it decides where grey blocks go for half a second, and
   * the real cards below still gate on the payload, never on this. If the two
   * ever disagree the page corrects itself when the data lands — a brief
   * reshape, not a wrong number.
   */
  const holds = (...slugs: MenuSlug[]) => slugs.every((slug) => access(slug));
  const expected = {
    me: principal.kind === "user" && Boolean(principal.nik),
    cards:
      (holds("fit-to-work") ? 2 : 0) +
      (holds("attendance") ? 2 : 0) +
      (holds("fleet-allocation") ? 3 : 0) +
      (holds("unit-status") ? 1 : 0),
    charts: holds("fleet-allocation", "attendance", "fit-to-work"),
  };

  const cards = [
    data?.ftw && cardUnfit(),
    data?.ftw && cardBelumFtw(),
    data?.attendance && cardAbsen(),
    data?.attendance && cardPresent(),
    data?.allocation && cardActualShift(),
    data?.allocation && cardAlloc(),
    data?.allocation && cardAllocGap(),
    data?.units && cardBreakdown(),
    data?.simper && cardSimper(),
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={`${greet}, ${roleLabel} 👋`} sub={dateLine}>
        <Fresh>
          {t.dataAsOf}&nbsp;
          <b className="font-mono text-(--text-secondary)">{freshTime}</b>
        </Fresh>
      </PageTitle>

      {dashQ.isPending ? (
        /* First load only. The query refetches every minute, and a refetch
           keeps the previous figures on screen rather than blanking them —
           `isPending` is true only while there is nothing to show at all. */
        <>
          {expected.me ? <MeSkeleton /> : null}
          {expected.cards ? (
            <div
              aria-busy="true"
              className="grid grid-cols-4 gap-4 max-xl:grid-cols-2"
            >
              {Array.from({ length: expected.cards }).map((_, i) => (
                <StatCardSkeleton key={i} />
              ))}
            </div>
          ) : null}
          {expected.charts ? <DashboardChartsSkeleton /> : null}
        </>
      ) : null}

      {dashQ.isError && !data ? (
        /* The other way the page used to go blank. A failed first load left
           the title over nothing, which reads as "nothing to report" — the
           one thing a dashboard must never say by accident. Once there is
           data, a failed refetch keeps it; this is only for having none. */
        <Panel>
          <StateBox
            icon={<CloudOff className="text-(--color-danger-text)" />}
            title={t.dbLoadErr}
            body={errorMessage(dashQ.error, t.dbLoadErr)}
          >
            <Button variant="secondary" onClick={() => void dashQ.refetch()}>
              {t.rdRetry}
            </Button>
          </StateBox>
        </Panel>
      ) : null}

      {/* The signed-in person's own day, above the aggregates.
          For a `self` account it is the entire dashboard — a department total
          means nothing to an operator, and "you are on D, you tapped at 04:45,
          you are on DT4023" is the only line here they can act on. Everyone
          else gets it too, because everyone has a shift. */}
      {facts.me ? (
        <Panel className="px-6 py-5">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
            <div className="min-w-0">
              <div className="text-lg font-semibold">{facts.me.name}</div>
              <div className="font-mono text-xs text-(--text-tertiary)">
                {facts.me.nik}
              </div>
            </div>
            <MeFact
              label={t.meRoster}
              value={facts.me.rosterCode ?? "—"}
              tone={facts.me.rosterCode ? "info" : "neutral"}
            />
            <MeFact
              label={t.meFtw}
              value={facts.me.ftwDecision ?? t.meNoReading}
              tone={
                !facts.me.ftwDecision
                  ? "danger"
                  : /aman/i.test(facts.me.ftwDecision)
                    ? "success"
                    : "warning"
              }
            />
            <MeFact
              label={t.meTap}
              value={facts.me.tappedAt?.slice(11, 16) ?? t.meNoTap}
              tone={facts.me.tappedAt ? "success" : "danger"}
            />
            <MeFact
              label={t.meUnit}
              value={facts.me.unitCode ?? t.meNoUnit}
              tone={facts.me.unitCode ? "success" : "neutral"}
            />
          </div>
        </Panel>
      ) : null}

      {cards.length ? (
        <div className="grid grid-cols-4 gap-4 max-xl:grid-cols-2">{cards}</div>
      ) : null}

      {/* The four charts the operations admin used to rebuild by hand for the
          morning meeting (owner, 2026-09-18). They replaced a ten-row table of
          names — "jelek dan tidak informatif", and true: a list of whoever was
          alphabetically first never did say how the shift was going. */}
      {data?.analytics ? (
        <DashboardCharts analytics={data.analytics} shiftLabel={shiftLabel} />
      ) : null}
    </div>
  );
}
