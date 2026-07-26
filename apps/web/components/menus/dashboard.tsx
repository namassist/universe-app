"use client";

import * as React from "react";
import Link from "next/link";
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

/* ---- static sample content (no data layer) ---- */
const SAMPLE = {
  att: { total: 128, present: 116, belum: 12 },
  ftw: { total: 128, fit: 121, kurang: 3, belum: 4 },
  units: { breakdown: 4 },
  rev: { pending: 6, pendingSids: 3 },
  simper: { expired: 2, soon: 5 },
  alloc: { filled: 42, downtime: 3, made: 1, generated: 1 },
  disp: { total: 8, offline: 1 },
  breakdownUnits: [
    { code: "DT-104", model: "HD785-7", loc: "Pit 3", at: "08:12" },
    { code: "EX-22", model: "PC2000-8", loc: "Disposal", at: "07:40" },
  ],
  unfit: [
    { name: "Budi Santoso", nik: "OPS-0421", dept: "Hauling", sleep: "4j 10m" },
    { name: "Andi Wijaya", nik: "OPS-0388", dept: "Loading", sleep: "3j 55m" },
  ],
  absent: [
    { name: "Rudi Hartono", nik: "OPS-0510", dept: "Hauling", code: "P-2" },
    { name: "Sari Lestari", nik: "OPS-0233", dept: "Support", code: "M-1" },
  ],
  pendingRev: [
    { sid: "REV-2481", entries: 3 },
    { sid: "REV-2479", entries: 2 },
  ],
  expiredSimper: [
    {
      name: "Joko Prasetyo",
      nik: "OPS-0111",
      dept: "Hauling",
      jenis: "BII",
      exp: "18 Jul 2026",
    },
  ],
  offlineDisplays: [
    { name: "Display Gate B", id: "DSP-03", kind: "att" as const },
  ],
};

export function DashboardMenu() {
  const { t, lang } = useI18n();
  const { roleLabel, access } = useRole();
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
      value={String(SAMPLE.ftw.kurang)}
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
      value={String(SAMPLE.att.belum)}
      label={t.statAbsent}
      detail={
        <>
          {t.dAbsent1} <b>{SAMPLE.att.total}</b> {t.dAbsent2}
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
      value={String(SAMPLE.att.present)}
      label={t.statPresent}
      detail={
        <>
          {t.dAbsent1} <b>{SAMPLE.att.total}</b> {t.dAbsent2}
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
      value={String(SAMPLE.units.breakdown)}
      label={t.statBreakdown}
      detail={
        <>
          <b>{SAMPLE.breakdownUnits[0]?.code}</b>
          {SAMPLE.breakdownUnits
            .slice(1, 3)
            .map((u) => ` · ${u.code}`)
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
      value={String(SAMPLE.rev.pending)}
      label={t.statApproval}
      detail={
        <>
          <b>{SAMPLE.rev.pendingSids}</b> {t.dRevGroups}
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
      value={String(SAMPLE.rev.pending)}
      label={t.statRevPending}
      detail={
        <>
          <b>{SAMPLE.rev.pendingSids}</b> {t.dRevGroups}
        </>
      }
    />
  );
  const cardSimper = () => (
    <StatCard
      key="simper"
      href={link("employees")}
      icon={<IdCard />}
      iconStyle={SAMPLE.simper.expired ? CARD_DANGER : CARD_SUCCESS}
      value={String(SAMPLE.simper.expired)}
      label={t.statSimperExp}
      detail={
        <>
          <b>{SAMPLE.simper.soon}</b> {t.dSimperSoon}
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
      value={String(SAMPLE.ftw.belum)}
      label={t.statFtwBelum}
      detail={
        <>
          {t.dAbsent1} <b>{SAMPLE.ftw.total}</b> {t.dOps}
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
      value={String(SAMPLE.ftw.fit)}
      label={t.statFtwFit}
      detail={
        <>
          {t.dAbsent1} <b>{SAMPLE.ftw.total}</b> {t.dOps}
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
      value={String(SAMPLE.alloc.filled)}
      label={t.statAllocNow}
      detail={
        <>
          <b>{SAMPLE.alloc.downtime}</b> downtime
        </>
      }
    />
  );
  const cardActualToday = () => (
    <StatCard
      key="actual-today"
      href={link("fleet-allocation")}
      icon={<CalendarDays />}
      iconStyle={SAMPLE.alloc.generated < 2 ? CARD_WARNING : CARD_SUCCESS}
      value={`${SAMPLE.alloc.made}/2`}
      label={t.statActualToday}
      detail={
        <>
          <b>{SAMPLE.alloc.generated}</b> {t.dGenerated}
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
      iconStyle={SAMPLE.disp.offline ? CARD_WARNING : CARD_SUCCESS}
      value={`${SAMPLE.disp.total - SAMPLE.disp.offline}/${SAMPLE.disp.total}`}
      label={t.statDisplays}
      detail={
        <>
          <b>{SAMPLE.disp.offline}</b> offline
        </>
      }
    />
  );

  /* ---- attention-row library ---- */
  const bdRows = (): AttentionRow[] =>
    SAMPLE.breakdownUnits.map((u) => ({
      name: u.code,
      sub: u.model,
      dept: "—",
      issue: en
        ? `Reported down at ${u.at} — awaiting repair (${u.loc})`
        : `Dilaporkan rusak ${u.at} — menunggu perbaikan (${u.loc})`,
      badge: "Breakdown",
      badgeVariant: "danger",
      target: "unit-status",
      action: en ? "Open Unit Status" : "Buka Status Unit",
    }));
  const unfitRows = (): AttentionRow[] =>
    SAMPLE.unfit.map((r) => ({
      name: r.name,
      sub: r.nik,
      dept: r.dept,
      issue: en
        ? `Slept ${r.sleep} — below the safe threshold`
        : `Tidur ${r.sleep} — di bawah ambang aman`,
      badge: "Unfit",
      badgeVariant: "danger",
      target: "fit-to-work",
      action: en ? "Open Fit To Work" : "Buka Fit To Work",
    }));
  const absenRows = (): AttentionRow[] =>
    SAMPLE.absent.map((r) => ({
      name: r.name,
      sub: r.nik,
      dept: r.dept,
      issue: en
        ? `Roster ${r.code} — no check-in yet`
        : `Roster ${r.code} — belum check-in`,
      badge: en ? "Not clocked in" : "Belum absen",
      badgeVariant: "warning",
      target: "attendance",
      action: en ? "View attendance" : "Lihat attendance",
    }));
  const revRows = (target: MenuSlug): AttentionRow[] =>
    SAMPLE.pendingRev.map((g) => ({
      name: g.sid,
      sub: `${g.entries} entri`,
      dept: "—",
      issue: en
        ? `${g.entries} revision entries awaiting decision`
        : `${g.entries} entri revisi menunggu keputusan`,
      badge: "Pending",
      badgeVariant: "info",
      target,
      action: en ? "Open Revisions" : "Buka Revisi",
    }));
  const simperRows = (): AttentionRow[] =>
    SAMPLE.expiredSimper.map((e) => ({
      name: e.name,
      sub: e.nik,
      dept: e.dept,
      issue: en
        ? `SIMPER ${e.jenis} expired on ${e.exp}`
        : `SIMPER ${e.jenis} kedaluwarsa ${e.exp}`,
      badge: en ? "Expired" : "Kedaluwarsa",
      badgeVariant: "danger",
      target: "employees",
      action: en ? "Open employee" : "Buka Karyawan",
    }));
  const dispRows = (): AttentionRow[] =>
    SAMPLE.offlineDisplays.map((d) => ({
      name: d.name,
      sub: d.id,
      dept: "—",
      issue: en
        ? "Display offline — last heartbeat 6m ago"
        : "Display offline — heartbeat terakhir 6m lalu",
      badge: "Offline",
      badgeVariant: "danger",
      target: d.kind === "att" ? "display-attendance" : "display-fleet",
      action: en ? "Open displays" : "Buka display",
    }));

  /* ---- composition ---- */
  /* Driven by the caller's grants rather than by a role name. Roles are
     created at runtime now, so a branch per role would have nothing to match
     the moment somebody adds one — and every card here was already gated on a
     permission anyway. Order is fixed: most urgent first. */
  const cards: React.ReactNode[] = [];
  const allRows: AttentionRow[] = [];

  if (has("fit-to-work")) {
    cards.push(cardUnfit(), cardBelumFtw(), cardFit());
    allRows.push(...unfitRows());
  }
  if (has("attendance")) {
    cards.push(cardAbsen(), cardPresent());
    allRows.push(...absenRows());
  }
  if (has("unit-status")) {
    cards.push(cardBreakdown());
    allRows.push(...bdRows());
  }
  if (has("roster-approval")) {
    cards.push(cardApproval());
    allRows.push(...revRows("roster-approval"));
  } else if (has("roster-revision")) {
    cards.push(cardRevPending());
    allRows.push(...revRows("roster-revision"));
  }
  if (has("fleet-allocation")) cards.push(cardAlloc(), cardActualToday());
  if (has("employees")) {
    cards.push(cardSimper());
    allRows.push(...simperRows());
  }
  if (has("display-attendance") || has("display-fleet")) {
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

      <div className="grid grid-cols-4 gap-4 max-xl:grid-cols-2">{cards}</div>

      <Panel>
        <Toolbar>
          <ToolbarTitle>{t.panelTitle}</ToolbarTitle>
          <ToolbarGroup>
            <SearchInput
              className="w-[240px]"
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
