"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Download,
  Eye,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
} from "lucide-react";

import type { EmployeeStatus } from "@universe/contracts";

import type { AccessMode } from "@/lib/access";
import { api, errorMessage, fetchBlob } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
  employeesQueryOptions,
  photoUrl,
  type EmployeeRow,
} from "@/lib/queries/employees";
import { masterQueryOptions } from "@/lib/queries/master";
import { Avatar, initialsOf } from "@/components/ui/avatar";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogIcon,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Select } from "@/components/ui/select";
import { StateBox } from "@/components/ui/state-box";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { useToast } from "@/components/ui/toast";

/** Long enough not to fire on every keystroke, short enough to feel live. */
const SEARCH_DEBOUNCE_MS = 250;

/** How close to expiry a permit has to be before the badge says so. */
const EXPIRING_DAYS = 60;

function simperVariant(exp: string): BadgeVariant {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(`${exp}T00:00:00`);
  if (d.getTime() < today.getTime()) return "danger";
  const days = (d.getTime() - today.getTime()) / 86400000;
  return days <= EXPIRING_DAYS ? "warning" : "info";
}

/**
 * The employee register.
 *
 * Search, the status filter, and the department filter are served by the API
 * rather than applied to a full list here (design D12): the search has to reach
 * the joined catalogue names, which the browser has no index for, and a real
 * site's register is hundreds to thousands of rows.
 *
 * There is no `cuti` option any more (design D7). Leave is dated and belongs to
 * the roster; an employment status has no date and cannot answer "until when",
 * so a filter for it here would have been filtering on a value nothing writes.
 */
export function EmployeesMenu({ mode }: { mode: AccessMode }) {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const router = useRouter();
  const base = `/employees`;
  const canW = mode === "manage";

  const [q, setQ] = React.useState("");
  const [debouncedQ, setDebouncedQ] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [departmentId, setDepartmentId] = React.useState("");
  const [delTarget, setDelTarget] = React.useState<EmployeeRow | null>(null);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q]);

  const employeesQ = useQuery(
    employeesQueryOptions({
      ...(debouncedQ.trim() ? { q: debouncedQ.trim() } : {}),
      ...(departmentId ? { departmentId } : {}),
      ...(status ? { status: status as EmployeeStatus } : {}),
    })
  );
  const rows = React.useMemo(() => employeesQ.data ?? [], [employeesQ.data]);

  // Active rows only: a retired department is not something anyone filters for,
  // and the employees still in it keep showing its name in their own column.
  const departments = useQuery(masterQueryOptions("departemen", true));

  const del = useMutation({
    mutationFn: async (row: EmployeeRow) => {
      const { error } = await api.v1.employees({ nik: row.nik }).delete();
      if (error) throw error;
    },
    onSuccess: async (_d, row) => {
      await queryClient.invalidateQueries({ queryKey: ["employees"] });
      setDelTarget(null);
      pushToast("success", t.toastDelT, `${row.name} ${t.toastDelD}`);
    },
    // An employee whose NIK an account carries is refused with 409 and the
    // API's own wording, which names the account (design D10).
    onError: (error) =>
      pushToast("error", t.empDelT1, errorMessage(error, t.loginErr)),
  });

  async function exportSheet() {
    try {
      // fetchBlob, not Eden — Treaty decodes an unrecognised body as text and
      // mangles the workbook past recovery (lib/api.ts).
      const blob = await fetchBlob("/v1/employees/export");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "karyawan.xlsx";
      a.click();
      URL.revokeObjectURL(url);
      pushToast("success", t.toastExportT, "karyawan.xlsx");
    } catch (error) {
      pushToast(
        "error",
        t.toastExportT,
        error instanceof Error ? error.message : t.loginErr
      );
    }
  }

  function resetFilters() {
    setQ("");
    setStatus("");
    setDepartmentId("");
  }

  const pg = usePagination(rows);

  function statusBadge(row: EmployeeRow) {
    const map: Record<EmployeeStatus, { v: BadgeVariant; l: string }> = {
      aktif: { v: "success", l: t.stAktif },
      // Warning, not danger: standby is on the payroll, just not on a unit.
      standby: { v: "warning", l: t.stStandby },
      nonaktif: { v: "danger", l: t.stNonaktif },
    };
    const m = map[row.status];
    return (
      <Badge variant={m.v} dot>
        {m.l}
      </Badge>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={t.navEmployees} sub={t.empSub}>
        {canW ? (
          <Button onClick={() => router.push(`${base}/new`)}>
            <Plus />
            {t.empAdd}
          </Button>
        ) : null}
      </PageTitle>

      <Panel>
        <Toolbar>
          <ToolbarTitle>{t.empListTitle}</ToolbarTitle>
          <ToolbarGroup>
            <SearchInput
              className="w-[280px]"
              placeholder={t.searchEmp}
              aria-label={t.searchEmp}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onClear={() => setQ("")}
              clearLabel={t.clearSearch}
            />
            <Select
              wrapperClassName="w-[190px]"
              aria-label={t.allDepts}
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
            >
              <option value="">{t.allDepts}</option>
              {(departments.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
            <Select
              wrapperClassName="w-[160px]"
              aria-label={t.thStatus}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">{t.allStatus}</option>
              <option value="aktif">{t.stAktif}</option>
              <option value="standby">{t.stStandby}</option>
              <option value="nonaktif">{t.stNonaktif}</option>
            </Select>
            <Button variant="secondary" onClick={exportSheet}>
              <Download />
              {t.export}
            </Button>
            {/* A page of its own, as every other import is: the flow carries
                two tables and should not push this list off the screen. */}
            {canW ? (
              <Button
                variant="secondary"
                onClick={() => router.push(`${base}/import`)}
              >
                <Upload />
                {t.udbImport}
              </Button>
            ) : null}
          </ToolbarGroup>
        </Toolbar>

        {employeesQ.isPending ? (
          <TableSkeleton rows={8} />
        ) : pg.rows.length ? (
          <Table>
            <TableHeader>
              <tr>
                <TableHead>{t.thNama}</TableHead>
                <TableHead>NIK</TableHead>
                <TableHead className="max-xl:hidden">{t.thDept}</TableHead>
                <TableHead>{t.thPos}</TableHead>
                <TableHead>SIMPER</TableHead>
                <TableHead>{t.thStatus}</TableHead>
                <TableHead className="w-[140px]">{t.thAct}</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {pg.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      {/* The stored photo, with the initials underneath as the
                          fallback for a row whose file is gone. */}
                      <Avatar src={photoUrl(r)} alt={r.name}>
                        {initialsOf(r.name)}
                      </Avatar>
                      <button
                        type="button"
                        onClick={() => router.push(`${base}/${r.nik}`)}
                        className="cursor-pointer font-semibold text-inherit hover:underline"
                      >
                        {r.name}
                      </button>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-(--text-secondary) tabular-nums">
                    {r.nik}
                  </TableCell>
                  <TableCell className="max-xl:hidden">
                    {r.departmentName}
                  </TableCell>
                  <TableCell>{r.positionName}</TableCell>
                  <TableCell>
                    {r.simperTypeName ? (
                      <Badge
                        variant={
                          r.simperExp ? simperVariant(r.simperExp) : "info"
                        }
                        title={[r.simperNo, r.simperExp && `s/d ${r.simperExp}`]
                          .filter(Boolean)
                          .join(" · ")}
                      >
                        {r.simperTypeName}
                      </Badge>
                    ) : (
                      <span className="text-(--text-tertiary)">—</span>
                    )}
                  </TableCell>
                  <TableCell>{statusBadge(r)}</TableCell>
                  <TableCell>
                    <div className="flex gap-1.5">
                      <IconButton
                        aria-label={t.empSee}
                        onClick={() => router.push(`${base}/${r.nik}`)}
                      >
                        <Eye />
                      </IconButton>
                      {canW ? (
                        <>
                          <IconButton
                            aria-label={t.empChange}
                            onClick={() => router.push(`${base}/${r.nik}/edit`)}
                          >
                            <Pencil />
                          </IconButton>
                          <IconButton
                            danger
                            aria-label={t.empDel}
                            onClick={() => setDelTarget(r)}
                          >
                            <Trash2 />
                          </IconButton>
                        </>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <StateBox
            icon={<Search className="text-(--color-primary-bright)" />}
            title={t.noResTitle}
            body={t.empEmptyB}
          >
            <Button
              variant="secondary"
              className="mx-auto"
              onClick={resetFilters}
            >
              {t.empResetF}
            </Button>
          </StateBox>
        )}

        <PanelFoot>
          <FootSum>
            {t.attSumA} <b>{pg.range}</b> {t.attSumB} <b>{pg.total}</b>{" "}
            {t.empSumB}
          </FootSum>
          <Pagination
            page={pg.page}
            pageCount={pg.pageCount}
            onPage={pg.setPage}
            per={pg.per}
            perOptions={["5", "10", "25"]}
            onPer={pg.setPer}
          />
        </PanelFoot>
      </Panel>

      <Dialog
        open={!!delTarget}
        onClose={() => setDelTarget(null)}
        labelledBy="del-t"
      >
        <DialogIcon variant="danger">
          <Trash2 />
        </DialogIcon>
        <DialogTitle id="del-t">{`${t.empDelT1} ${delTarget?.name}?`}</DialogTitle>
        <DialogBody>{t.empDelBody}</DialogBody>
        <DialogActions>
          <Button variant="ghost" onClick={() => setDelTarget(null)}>
            {t.btnCancel}
          </Button>
          <Button
            variant="destructive"
            disabled={del.isPending}
            onClick={() => delTarget && del.mutate(delTarget)}
          >
            {t.empDelDo}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
