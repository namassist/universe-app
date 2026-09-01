"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarDays,
  Clock,
  Heart,
  IdCard,
  MessageSquareMore,
  Monitor,
  Search,
  Truck,
  UserCheck,
  XCircle,
} from "lucide-react";

import type { MenuSlug } from "@/lib/access";
import { useI18n } from "@/lib/i18n";
import {
  dashboardQueryOptions,
  type AttentionFact,
} from "@/lib/queries/dashboard";
import { useRole } from "@/components/providers/role-context";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Pagination, usePagination } from "@/components/ui/pagination";
import {
  FootSum,
  Fresh,
  PageTitle,
  Panel,
  PanelFoot,
  Toolbar,
  ToolbarGroup,
  ToolbarTitle,
} from "@/components/ui/panel";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { StatCard } from "@/components/ui/stat-card";
import { StateBox } from "@/components/ui/state-box";
import {
  NameCell,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type AttentionRow = {
  name: string;
  sub: string;
  dept: string;
  issue: string;
  badge: string;
  badgeVariant: BadgeVariant;
  target: MenuSlug;
  action: string;
};

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

export function DashboardMenu() {
  const { t, lang } = useI18n();
  const { roleLabel, access } = useRole();
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
    const rows = (kind: AttentionFact["kind"]) =>
      (data?.attention ?? []).filter((r) => r.kind === kind);
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
        fit: data?.ftw?.fit ?? 0,
        kurang: data?.ftw?.followUp ?? 0,
        belum: data?.ftw?.missing ?? 0,
      },
      units: { breakdown: data?.units?.breakdown ?? 0 },
      rev: {
        pending: data?.revisions?.pendingItems ?? 0,
        pendingSids: data?.revisions?.pendingDocs ?? 0,
      },
      simper: {
        expired: data?.simper?.expired ?? 0,
        soon: data?.simper?.soon ?? 0,
      },
      disp: {
        total: data?.devices?.total ?? 0,
        offline: data?.devices?.offline ?? 0,
      },
      alloc: {
        /* Both of today's shifts, summed: the card is "how much of today is
           crewed", not "how much of one shift is". */
        filled: (data?.allocation ?? []).reduce((n, b) => n + b.filled, 0),
        slots: (data?.allocation ?? []).reduce((n, b) => n + b.slots, 0),
        boards: (data?.allocation ?? []).length,
      },
      fleetGap: data?.fleetConfig?.unitsWithOperatorNoFleet ?? 0,
      ingest: data?.ingest ?? null,
      me: data?.me ?? null,
      breakdownUnits: rows("breakdown"),
      unfit: rows("unfit"),
      absent: rows("absent"),
      offlineDisplays: rows("display"),
    };
  }, [data]);
  const en = lang === "en";
  const link = (slug: MenuSlug) => `/${slug}`;
  const has = (slug: MenuSlug) => Boolean(access(slug));

  const [q, setQ] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("");
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
  const dateLine = `${new Date().toLocaleDateString(en ? "en-GB" : "id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  })} · ${t.shiftNote}`;

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
          <b>{facts.breakdownUnits[0]?.name ?? "—"}</b>
          {facts.breakdownUnits
            .slice(1, 3)
            .map((u) => ` · ${u.name}`)
            .join("")}
        </>
      }
    />
  );
  const cardApproval = () => (
    <StatCard
      key="apv"
      href={link("roster-approval")}
      icon={<MessageSquareMore />}
      iconStyle={CARD_INFO}
      value={String(facts.rev.pending)}
      label={t.statApproval}
      detail={
        <>
          <b>{facts.rev.pendingSids}</b> {t.dRevGroups}
        </>
      }
    />
  );
  const cardRevPending = () => (
    <StatCard
      key="rev"
      href={link("roster-revision")}
      icon={<MessageSquareMore />}
      iconStyle={CARD_INFO}
      value={String(facts.rev.pending)}
      label={t.statRevPending}
      detail={
        <>
          <b>{facts.rev.pendingSids}</b> {t.dRevGroups}
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
  const cardFit = () => (
    <StatCard
      key="fit"
      href={link("fit-to-work")}
      icon={<Heart />}
      iconStyle={CARD_SUCCESS}
      value={String(facts.ftw.fit)}
      label={t.statFtwFit}
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
          <b>{Math.max(0, facts.alloc.slots - facts.alloc.filled)}</b>{" "}
          {t.dNoOperator}
        </>
      }
    />
  );
  const cardActualToday = () => (
    <StatCard
      key="actual-today"
      href={link("fleet-allocation")}
      icon={<CalendarDays />}
      iconStyle={facts.alloc.boards < 2 ? CARD_WARNING : CARD_SUCCESS}
      value={`${facts.alloc.boards}/2`}
      label={t.statActualToday}
      detail={
        <>
          <b>{facts.alloc.slots}</b> {t.dGenerated}
        </>
      }
    />
  );
  const cardDisplays = () => (
    <StatCard
      key="disp"
      href={
        has("display-attendance")
          ? link("display-attendance")
          : link("display-fleet")
      }
      icon={<Monitor />}
      iconStyle={facts.disp.offline ? CARD_WARNING : CARD_SUCCESS}
      value={`${facts.disp.total - facts.disp.offline}/${facts.disp.total}`}
      label={t.statDisplays}
      detail={
        <>
          <b>{facts.disp.offline}</b> offline
        </>
      }
    />
  );

  /**
   * Units a standing operator holds that no formation claims.
   *
   * Shown only when there are any: during normal operation this is zero and a
   * permanent card reading 0 is one nobody looks at. While the formations are
   * still being set up it is in the hundreds, and it is the single number that
   * says how much of the yard the engine cannot see.
   */
  const cardFleetGap = () => (
    <StatCard
      key="fleet-gap"
      href={link("fleet-setting")}
      icon={<Truck />}
      iconStyle={CARD_WARNING}
      value={String(facts.fleetGap)}
      label={t.statFleetGap}
      detail={<>{t.dFleetGap}</>}
    />
  );

  /* ---- attention rows ----
     The API sends facts; the sentence and the badge are written here, in the
     reader's language. Kept as one mapper rather than six near-identical
     ones — the shape is the same and only the wording differs. */
  const rowsOf = (
    kind: AttentionFact["kind"],
    badge: string,
    badgeVariant: BadgeVariant,
    target: MenuSlug,
    action: string,
    issue: (fact: AttentionFact) => string
  ): AttentionRow[] =>
    facts[
      (
        {
          breakdown: "breakdownUnits",
          unfit: "unfit",
          absent: "absent",
          display: "offlineDisplays",
        } as const
      )[kind]
    ].map((fact) => ({
      name: fact.name,
      sub: fact.sub,
      dept: fact.dept,
      issue: issue(fact),
      badge,
      badgeVariant,
      target,
      action,
    }));

  const bdRows = () =>
    rowsOf(
      "breakdown",
      "Breakdown",
      "danger",
      "unit-status",
      en ? "Open Unit Status" : "Buka Status Unit",
      (f) => (en ? `Down — ${f.sub}` : `Rusak — ${f.sub}`)
    );
  const unfitRows = () =>
    rowsOf(
      "unfit",
      "Unfit",
      "danger",
      "fit-to-work",
      en ? "Open Fit To Work" : "Buka Fit To Work",
      /* The source's own words, not a paraphrase: a supervisor comparing this
         against the Fit To Work menu must not find two wordings for one
         reading. */
      (f) => f.detail ?? (en ? "Needs follow-up" : "Perlu tindak lanjut")
    );
  const absenRows = () =>
    rowsOf(
      "absent",
      en ? "No tap" : "Belum tap",
      "warning",
      "attendance",
      en ? "Open Attendance" : "Buka Attendance",
      (f) =>
        en
          ? `Rostered ${f.detail} — no fingerprint yet`
          : `Roster ${f.detail} — belum ada fingerprint`
    );
  const dispRows = () =>
    rowsOf(
      "display",
      "Offline",
      "danger",
      "display-attendance",
      en ? "Open Displays" : "Buka Display",
      () =>
        en
          ? "No heartbeat in the last minutes"
          : "Tidak ada heartbeat beberapa menit terakhir"
    );

  /* ---- composition ---- */
  /* Driven by the caller's grants rather than by a role name. Roles are
     created at runtime now, so a branch per role would have nothing to match
     the moment somebody adds one — and every card here was already gated on a
     permission anyway. Order is fixed: most urgent first. */
  const cards: React.ReactNode[] = [];
  const allRows: AttentionRow[] = [];

  /* Gated on the section, not on the grant. The API already applied the
     permission — a null section is its answer, and re-deriving it here would
     be a second rule to keep in step with the first. */
  if (data?.ftw) {
    cards.push(cardUnfit(), cardBelumFtw(), cardFit());
    allRows.push(...unfitRows());
  }
  if (data?.attendance) {
    cards.push(cardAbsen(), cardPresent());
    allRows.push(...absenRows());
  }
  if (data?.units) {
    cards.push(cardBreakdown());
    allRows.push(...bdRows());
  }
  if (data?.revisions) {
    /* One queue, two readings of it: whoever decides sees "waiting on you",
       whoever submits sees "waiting on someone else". */
    cards.push(has("roster-approval") ? cardApproval() : cardRevPending());
  }
  if (data?.allocation) cards.push(cardAlloc(), cardActualToday());
  if (data?.fleetConfig && data.fleetConfig.unitsWithOperatorNoFleet > 0)
    cards.push(cardFleetGap());
  if (data?.simper) cards.push(cardSimper());
  if (data?.devices) {
    cards.push(cardDisplays());
    allRows.push(...dispRows());
  }

  const badgeOpts = Array.from(new Set(allRows.map((r) => r.badge)));
  const rows = allRows.filter((r) => {
    const needle = q.toLowerCase();
    const okQ =
      r.name.toLowerCase().includes(needle) ||
      r.sub.toLowerCase().includes(needle) ||
      r.issue.toLowerCase().includes(needle);
    return okQ && (statusFilter === "" || r.badge === statusFilter);
  });
  const pg = usePagination(rows);
  const heads = [t.thName, t.thDept, t.thIssue, t.thStatus, t.thAction];

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={`${greet}, ${roleLabel} 👋`} sub={dateLine}>
        <Fresh>
          {t.dataAsOf}&nbsp;
          <b className="font-mono text-(--text-secondary)">{freshTime}</b>
        </Fresh>
      </PageTitle>

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
            {facts.me.pendingRevisions > 0 ? (
              <MeFact
                label={t.meRevision}
                value={String(facts.me.pendingRevisions)}
                tone="warning"
              />
            ) : null}
          </div>
        </Panel>
      ) : null}

      {cards.length ? (
        <div className="grid grid-cols-4 gap-4 max-xl:grid-cols-2">{cards}</div>
      ) : null}

      <Panel>
        <Toolbar>
          <ToolbarTitle>{t.panelTitle}</ToolbarTitle>
          <ToolbarGroup>
            <SearchInput
              className="w-60"
              placeholder={t.searchPh}
              aria-label={t.searchPh}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <Select
              wrapperClassName="w-[170px]"
              aria-label={t.thStatus}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">{t.allStatus}</option>
              {badgeOpts.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </Select>
          </ToolbarGroup>
        </Toolbar>

        {rows.length ? (
          <>
            <Table>
              <TableHeader>
                <tr>
                  {heads.map((h, i) => (
                    <TableHead
                      key={h}
                      className={i === 1 ? "max-xl:hidden" : undefined}
                    >
                      {h}
                    </TableHead>
                  ))}
                </tr>
              </TableHeader>
              <TableBody>
                {pg.rows.map((r) => (
                  <TableRow key={`${r.name}-${r.badge}-${r.sub}`}>
                    <TableCell>
                      <NameCell name={r.name} sub={r.sub} />
                    </TableCell>
                    <TableCell className="max-xl:hidden">{r.dept}</TableCell>
                    <TableCell>{r.issue}</TableCell>
                    <TableCell>
                      <Badge variant={r.badgeVariant} dot>
                        {r.badge}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {has(r.target) ? (
                        <Link href={link(r.target)}>{r.action}</Link>
                      ) : (
                        <span className="text-(--text-tertiary)">
                          {r.action}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <PanelFoot>
              <FootSum>
                {t.attSumA} <b>{pg.range}</b> {t.attSumB} <b>{pg.total}</b>{" "}
                {t.sumRest}
              </FootSum>
              <Pagination
                page={pg.page}
                pageCount={pg.pageCount}
                onPage={pg.setPage}
                per={pg.per}
                perOptions={["10", "25", "50"]}
                onPer={pg.setPer}
              />
            </PanelFoot>
          </>
        ) : (
          <StateBox
            icon={<Search className="text-(--text-tertiary)" />}
            title={t.noResTitle}
            body={t.noResBody}
          />
        )}
      </Panel>
    </div>
  );
}
