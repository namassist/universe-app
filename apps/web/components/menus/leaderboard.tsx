"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarX, SearchX, TriangleAlert } from "lucide-react";

import { LEADERBOARD_MAX_DAYS } from "@universe/contracts";

import { errorMessage } from "@/lib/api";
import { fmt, menuLabel, useI18n } from "@/lib/i18n";
import {
  leaderboardDepartmentsQueryOptions,
  leaderboardQueryOptions,
} from "@/lib/queries/leaderboard";
import { useRole } from "@/components/providers/role-context";
import { Pagination, usePagination } from "@/components/ui/pagination";
import {
  FootSum,
  PageTitle,
  Panel,
  PanelFoot,
  Toolbar,
  ToolbarGroup,
  ToolbarTitle,
} from "@/components/ui/panel";
import { SearchInput } from "@/components/ui/search-input";
import { Segmented, SegmentedButton } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { StateBox } from "@/components/ui/state-box";
import { TableSkeleton } from "@/components/ui/table-skeleton";

import {
  openPeriod,
  PeriodControls,
  type PeriodKind,
} from "./leaderboard-period";
import { Podium } from "./leaderboard-podium";
import {
  customPeriodError,
  matchesSearch,
  type Period,
} from "./leaderboard-rows";
import { LeaderboardTable } from "./leaderboard-table";

/**
 * Peringkat Operator: a week, a month or a custom range of settled points,
 * for one unit type or all of them — the top three on a podium, everyone in a
 * ranked table beneath.
 *
 * Read-only. Nothing here scores: the ledger is written by the API as each
 * shift closes, so a shift still running is not on the board yet. Department opens on the whole site for a role
 * that sees it and on its own for one scoped to a department; the API
 * enforces the second either way, and the select only says so.
 *
 * The search filters the rows already ranked, so a name keeps the rank it
 * holds on the whole board, and the podium stays the board's.
 */
export function LeaderboardMenu() {
  const { t } = useI18n();
  const { scope } = useRole();
  const [kind, setKind] = React.useState<PeriodKind>("month");
  const [period, setPeriod] = React.useState<Period>(() =>
    openPeriod("month", { from: "", to: "" })
  );
  const [unitType, setUnitType] = React.useState("");
  const [department, setDepartment] = React.useState("");
  const [search, setSearch] = React.useState("");

  const rangeError =
    kind === "custom" ? customPeriodError(period.from, period.to) : null;
  const deptQ = useQuery(leaderboardDepartmentsQueryOptions());
  const boardQ = useQuery({
    ...leaderboardQueryOptions({ ...period, unitType, department }),
    enabled: rangeError === null,
  });

  const ranked = boardQ.data?.rows ?? [];
  const rows = ranked.filter((r) => matchesSearch(r, search));
  const pg = usePagination(rows, "25");
  const siteWide = scope === "all";
  const perType = unitType !== "";
  const unitTypes = boardQ.data?.unitTypes ?? [];
  const title = unitTypes.find((u) => u.id === unitType)?.name ?? t.lbAllTypes;

  /* Any change of board starts at its first page. A new period or department
     also drops the type tab: the tabs are that board's, and a type with no
     points there would leave the table filtered by a tab nobody can see. */
  const rebase = () => {
    setUnitType("");
    pg.setPage(1);
  };
  const changePeriod = (nextKind: PeriodKind, next: Period) => {
    setKind(nextKind);
    setPeriod(next);
    rebase();
  };

  const body = (() => {
    if (rangeError)
      return (
        <StateBox
          icon={<CalendarX />}
          title={t.lbPeriod}
          body={
            rangeError === "reversed"
              ? t.lbReversed
              : fmt(t.lbTooLong, { days: LEADERBOARD_MAX_DAYS })
          }
        />
      );
    if (boardQ.isPending) return <TableSkeleton />;
    if (boardQ.isError)
      return (
        <StateBox
          icon={<TriangleAlert />}
          title={t.lbLoadErr}
          body={errorMessage(boardQ.error, t.lbLoadErr)}
        />
      );
    if (!rows.length)
      return (
        <StateBox icon={<SearchX />} title={t.lbEmptyT} body={t.lbEmptyB} />
      );
    return <LeaderboardTable rows={pg.rows} perType={perType} />;
  })();

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={menuLabel(t, "leaderboard")} sub={t.lbSub} />

      <Panel>
        <Toolbar>
          <ToolbarTitle>{title}</ToolbarTitle>
          <ToolbarGroup>
            <PeriodControls
              kind={kind}
              period={period}
              onChange={changePeriod}
            />
            <Select
              wrapperClassName="w-[220px]"
              value={department}
              onChange={(e) => {
                setDepartment(e.target.value);
                rebase();
              }}
              disabled={!siteWide}
              aria-label={t.allDepts}
            >
              {siteWide ? <option value="">{t.allDepts}</option> : null}
              {(deptQ.data ?? []).map((d) => (
                <option key={d.id} value={siteWide ? d.id : ""}>
                  {d.name} · {d.company}
                </option>
              ))}
            </Select>
            <SearchInput
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                pg.setPage(1);
              }}
              onClear={() => {
                setSearch("");
                pg.setPage(1);
              }}
              clearLabel={t.lbClear}
              placeholder={t.lbSearch}
              aria-label={t.lbSearch}
            />
          </ToolbarGroup>
        </Toolbar>

        <Segmented
          role="group"
          aria-label={t.lbTypes}
          className="mb-5 flex-wrap"
        >
          {[{ id: "", name: t.lbAllTypes }, ...unitTypes].map((u) => (
            <SegmentedButton
              key={u.id || "all"}
              type="button"
              active={unitType === u.id}
              aria-pressed={unitType === u.id}
              onClick={() => {
                setUnitType(u.id);
                pg.setPage(1);
              }}
            >
              {u.name}
            </SegmentedButton>
          ))}
        </Segmented>

        {rangeError || !boardQ.isSuccess ? null : (
          <Podium rows={ranked} perType={perType} />
        )}

        {body}

        {rows.length && !rangeError ? (
          <PanelFoot>
            <FootSum>
              <b>{pg.range}</b> / <b>{pg.total}</b> {t.lbRows}
            </FootSum>
            <Pagination
              page={pg.page}
              pageCount={pg.pageCount}
              onPage={pg.setPage}
              per={pg.per}
              perOptions={["25", "50", "100"]}
              onPer={pg.setPer}
            />
          </PanelFoot>
        ) : null}
      </Panel>
    </div>
  );
}
