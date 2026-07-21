"use client";

import * as React from "react";
import {
  Ban,
  CheckCircle2,
  Download,
  Pencil,
  Plus,
  Search,
  Upload,
  UserPlus,
} from "lucide-react";

import type { AccessMode } from "@/lib/access";
import { downloadCsv } from "@/lib/csv";
import { EMPLOYEES } from "@/lib/employees-data";
import { useI18n } from "@/lib/i18n";
import { ROLES_INIT, USERS_INIT, type UmUser } from "@/lib/um-data";
import { AsyncSelect, type AsyncOption } from "@/components/ui/async-select";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Checkbox, ToggleRow } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogIcon,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
import { useToast } from "@/components/ui/toast";

type EmpRow = { nik: string; name: string };

/* pencarian karyawan tertaut — lokal atas data contoh */
async function loadEmployees(search: string): Promise<AsyncOption<EmpRow>[]> {
  const needle = search.trim().toLowerCase();
  return EMPLOYEES.filter(
    (e) =>
      !needle ||
      e.name.toLowerCase().includes(needle) ||
      e.nik.toLowerCase().includes(needle)
  )
    .slice(0, 20)
    .map((e) => ({
      value: e.nik,
      label: e.name,
      row: { nik: e.nik, name: e.name },
    }));
}

export function UmUsersMenu({ mode }: { mode: AccessMode }) {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const canW = mode === "manage";
  const impRef = React.useRef<HTMLInputElement>(null);

  const [users, setUsers] = React.useState<UmUser[]>(USERS_INIT);
  const [q, setQ] = React.useState("");
  const [statusF, setStatusF] = React.useState("all");
  const [roleF, setRoleF] = React.useState("all");

  const roleName = (id: string) =>
    ROLES_INIT.find((r) => r.id === id)?.name ?? id;

  const needle = q.trim().toLowerCase();
  const rows = users.filter((u) => {
    if (statusF === "on" && !u.active) return false;
    if (statusF === "off" && u.active) return false;
    if (roleF !== "all" && !u.roleIds.includes(roleF)) return false;
    if (!needle) return true;
    return (
      u.email.toLowerCase().includes(needle) ||
      (u.name ?? "").toLowerCase().includes(needle) ||
      (u.nik ?? "").toLowerCase().includes(needle)
    );
  });
  const pg = usePagination(rows);
  const activeN = users.filter((u) => u.active).length;

  /* dialog tambah/edit */
  const [dlgOpen, setDlgOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<UmUser | null>(null);
  const [fEmail, setFEmail] = React.useState("");
  const [fKar, setFKar] = React.useState("");
  const [fRoles, setFRoles] = React.useState<Record<string, boolean>>({});
  const [fActive, setFActive] = React.useState(true);
  const [err, setErr] = React.useState(false);
  const [offTarget, setOffTarget] = React.useState<UmUser | null>(null);

  function openAdd() {
    setEditing(null);
    setFEmail("");
    setFKar("");
    setFRoles({});
    setFActive(true);
    setErr(false);
    setDlgOpen(true);
  }
  function openEdit(u: UmUser) {
    setEditing(u);
    setFEmail(u.email);
    setFKar(u.name ? `${u.name} — ${u.nik}` : "");
    setFRoles(Object.fromEntries(u.roleIds.map((r) => [r, true])));
    setFActive(u.active);
    setErr(false);
    setDlgOpen(true);
  }
  function save(e: React.FormEvent) {
    e.preventDefault();
    const roleIds = Object.keys(fRoles).filter((r) => fRoles[r]);
    const email = fEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || roleIds.length === 0) {
      setErr(true);
      return;
    }
    const [name, nik] = fKar ? fKar.split(" — ") : [null, null];
    if (editing) {
      setUsers((prev) =>
        prev.map((u) =>
          u.id === editing.id
            ? { ...u, email, name, nik, roleIds, active: fActive }
            : u
        )
      );
      pushToast("success", t.umToastUserEdit, email);
    } else {
      setUsers((prev) => [
        { id: `n-${email}`, email, name, nik, roleIds, active: fActive },
        ...prev,
      ]);
      pushToast("success", t.umToastInvite, `${email} — ${t.umToastInviteD}`);
    }
    setDlgOpen(false);
  }
  function setActive(u: UmUser, active: boolean) {
    setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, active } : x)));
    if (active)
      pushToast("success", t.umToastOn, `${u.email} — ${t.umToastOnD}`);
    else pushToast("info", t.umToastOff, `${u.email} — ${t.umToastOffD}`);
  }

  function exportCsv() {
    const head = "email;karyawan;nik;roles;status";
    const body = users
      .map((u) =>
        [
          u.email,
          u.name ?? "",
          u.nik ?? "",
          u.roleIds.map(roleName).join(","),
          u.active ? "aktif" : "nonaktif",
        ].join(";")
      )
      .join("\n");
    const name = `users_${new Date().toISOString().slice(0, 10)}.csv`;
    downloadCsv(name, `${head}\n${body}`);
    pushToast("success", t.umToastExp, name);
  }
  function importChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    pushToast("success", t.umToastImp, `${file.name} — 3 ${t.umToastImpD}`);
    e.target.value = "";
  }

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={t.umUsersT} sub={t.umSub}>
        {canW ? (
          <Button onClick={openAdd}>
            <Plus />
            {t.umUserAdd}
          </Button>
        ) : null}
      </PageTitle>

      <Panel>
        <Toolbar>
          <ToolbarTitle>{t.umUserListT}</ToolbarTitle>
          <ToolbarGroup>
            <SearchInput
              className="w-[240px]"
              placeholder={t.umSearchPh}
              aria-label={t.umSearchPh}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <Select
              wrapperClassName="w-[150px]"
              aria-label={t.thStatus}
              value={statusF}
              onChange={(e) => setStatusF(e.target.value)}
            >
              <option value="all">{t.umFAll}</option>
              <option value="on">{t.stAktif}</option>
              <option value="off">{t.stNonaktif}</option>
            </Select>
            <Select
              wrapperClassName="w-[170px]"
              aria-label="Role"
              value={roleF}
              onChange={(e) => setRoleF(e.target.value)}
            >
              <option value="all">{t.umFAllRoles}</option>
              {ROLES_INIT.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
            {canW ? (
              <Button
                variant="secondary"
                onClick={() => impRef.current?.click()}
              >
                <Upload />
                Import
              </Button>
            ) : null}
            <Button variant="secondary" onClick={exportCsv}>
              <Download />
              Export
            </Button>
            <input
              ref={impRef}
              type="file"
              accept=".csv,.xlsx"
              className="hidden"
              onChange={importChange}
            />
          </ToolbarGroup>
        </Toolbar>

        {pg.rows.length ? (
          <Table>
            <TableHeader>
              <tr>
                <TableHead>Email</TableHead>
                <TableHead className="max-xl:hidden">{t.umLinked}</TableHead>
                <TableHead className="max-xl:hidden">NIK</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead>{t.thStatus}</TableHead>
                <TableHead className="w-[110px]">{t.thAct}</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {pg.rows.map((u) => (
                <TableRow
                  key={u.id}
                  className={u.active ? undefined : "opacity-60"}
                >
                  <TableCell>
                    <b className="font-semibold">{u.email}</b>
                  </TableCell>
                  <TableCell className="max-xl:hidden">
                    {u.name ? (
                      <span className="font-semibold">{u.name}</span>
                    ) : (
                      <span className="text-(--text-tertiary)">—</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-(--text-secondary) tabular-nums max-xl:hidden">
                    {u.nik ?? <span className="text-(--text-tertiary)">—</span>}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
                      {u.roleIds.map((rid) => (
                        <Badge key={rid} variant="info">
                          {roleName(rid)}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.active ? "success" : "danger"} dot>
                      {u.active ? t.stAktif : t.stNonaktif}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {canW ? (
                      <div className="flex gap-2">
                        <IconButton
                          aria-label={t.udbEditT}
                          onClick={() => openEdit(u)}
                        >
                          <Pencil />
                        </IconButton>
                        {u.active ? (
                          <IconButton
                            danger
                            aria-label={t.umOff}
                            onClick={() => setOffTarget(u)}
                          >
                            <Ban />
                          </IconButton>
                        ) : (
                          <IconButton
                            aria-label={t.umOn}
                            onClick={() => setActive(u, true)}
                          >
                            <CheckCircle2 />
                          </IconButton>
                        )}
                      </div>
                    ) : null}
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
          />
        )}

        <PanelFoot>
          <FootSum>
            {t.attSumA} <b>{pg.range}</b> {t.attSumB} <b>{pg.total}</b> user ·{" "}
            <b>{activeN}</b> {t.umActiveSum}
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
      </Panel>

      {/* dialog tambah/edit user */}
      <Dialog
        open={dlgOpen}
        onClose={() => setDlgOpen(false)}
        className="w-[min(520px,100%)]"
        labelledBy="umu-t"
      >
        <DialogIcon variant="info">
          <UserPlus />
        </DialogIcon>
        <DialogTitle id="umu-t">
          {editing ? `${t.umUserEditT} — ${editing.email}` : t.umUserAdd}
        </DialogTitle>
        <DialogBody>{t.umUserDlgB}</DialogBody>
        <form onSubmit={save} noValidate>
          <Field
            className="mt-4"
            label="Email"
            htmlFor="um-email"
            required
            error={err}
            errorMessage={t.umErrEmail}
          >
            <Input
              id="um-email"
              type="email"
              placeholder="nama@unggul.co.id"
              value={fEmail}
              onChange={(e) => setFEmail(e.target.value)}
            />
          </Field>
          <Field className="mt-4" label={t.umLinked} htmlFor="um-kar">
            <AsyncSelect
              id="um-kar"
              value={fKar}
              onChange={(o) => setFKar(o ? `${o.label} — ${o.value}` : "")}
              load={loadEmployees}
              placeholder={t.umNoLink}
              searchPlaceholder={t.mdSearchPh}
              emptyText={t.noResTitle}
              clearLabel={t.umNoLink}
            />
          </Field>
          <Field className="mt-4" label="Roles" required>
            <div className="grid grid-cols-2 gap-2">
              {ROLES_INIT.map((r) => (
                <ToggleRow key={r.id}>
                  <Checkbox
                    checked={!!fRoles[r.id]}
                    onChange={(e) =>
                      setFRoles((prev) => ({
                        ...prev,
                        [r.id]: e.target.checked,
                      }))
                    }
                  />
                  {r.name}
                </ToggleRow>
              ))}
            </div>
          </Field>
          <ToggleRow className="mt-4" htmlFor="um-active">
            <Checkbox
              id="um-active"
              checked={fActive}
              onChange={(e) => setFActive(e.target.checked)}
            />
            {t.stAktif}
          </ToggleRow>
          <DialogActions>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDlgOpen(false)}
            >
              {t.btnCancel}
            </Button>
            <Button type="submit">
              {editing ? t.udbSaveEdit : t.umUserSaveAdd}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* dialog nonaktifkan user */}
      <Dialog
        open={offTarget !== null}
        onClose={() => setOffTarget(null)}
        labelledBy="umoff-t"
      >
        <DialogIcon variant="warning">
          <Ban />
        </DialogIcon>
        <DialogTitle id="umoff-t">{`${t.umOff} ${offTarget?.email ?? ""}?`}</DialogTitle>
        <DialogBody>{t.umOffB}</DialogBody>
        <DialogActions>
          <Button variant="ghost" onClick={() => setOffTarget(null)}>
            {t.btnCancel}
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (offTarget) setActive(offTarget, false);
              setOffTarget(null);
            }}
          >
            {t.umOff}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
