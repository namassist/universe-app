"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  CheckCircle2,
  Download,
  KeyRound,
  Pencil,
  Plus,
  Search,
  Upload,
  UserPlus,
} from "lucide-react";

import type { AccessMode } from "@/lib/access";
import { api, errorMessage } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import { useI18n } from "@/lib/i18n";
import { rolesQueryOptions } from "@/lib/queries/roles";
import { usersKey, usersQueryOptions, type UserRow } from "@/lib/queries/users";
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
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { useToast } from "@/components/ui/toast";

export function UmUsersMenu({ mode }: { mode: AccessMode }) {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const router = useRouter();
  const canW = mode === "manage";

  const users = useQuery(usersQueryOptions);
  const roles = useQuery(rolesQueryOptions);

  const [q, setQ] = React.useState("");
  const [statusF, setStatusF] = React.useState("all");
  const [roleF, setRoleF] = React.useState("all");

  const roleName = (id: string) =>
    roles.data?.find((r) => r.id === id)?.name ?? id;

  const rows = (users.data ?? []).filter((u) => {
    if (statusF === "on" && !u.active) return false;
    if (statusF === "off" && u.active) return false;
    if (roleF !== "all" && u.roleId !== roleF) return false;
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return (
      (u.email ?? "").toLowerCase().includes(needle) ||
      u.name.toLowerCase().includes(needle) ||
      (u.nik ?? "").toLowerCase().includes(needle)
    );
  });
  const pg = usePagination(rows);
  const activeN = (users.data ?? []).filter((u) => u.active).length;

  /* Mutations invalidate their key rather than router.refresh(): the refetch
     is scoped to the affected query instead of re-rendering the whole route. */
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: usersKey });

  const save = useMutation({
    mutationFn: async (input: {
      id: string | null;
      email: string | null;
      nik: string | null;
      name: string;
      roleId: string;
      active: boolean;
    }) => {
      const { id, ...body } = input;
      const result = id
        ? await api.v1.users({ id }).patch(body)
        : await api.v1.users.post({
            email: body.email ?? undefined,
            nik: body.nik ?? undefined,
            name: body.name,
            roleId: body.roleId,
            active: body.active,
          });
      if (result.error) throw result.error;
      return result.data;
    },
    onSuccess: async (_data, input) => {
      await invalidate();
      const label = input.email ?? input.nik ?? input.name;
      if (input.id) pushToast("success", t.umToastUserEdit, label);
      else
        pushToast("success", t.umToastInvite, `${label} — ${t.umToastInviteD}`);
      setDlgOpen(false);
    },
    onError: (error) =>
      pushToast("error", t.umToastUserEdit, errorMessage(error, t.loginErr)),
  });

  const setActiveM = useMutation({
    mutationFn: async (input: { user: UserRow; active: boolean }) => {
      const { error } = await api.v1
        .users({ id: input.user.id })
        .patch({ active: input.active });
      if (error) throw error;
    },
    onSuccess: async (_d, input) => {
      await invalidate();
      const label = input.user.email ?? input.user.nik ?? input.user.name;
      if (input.active)
        pushToast("success", t.umToastOn, `${label} — ${t.umToastOnD}`);
      else pushToast("info", t.umToastOff, `${label} — ${t.umToastOffD}`);
    },
    onError: (error) =>
      pushToast("error", t.umOff, errorMessage(error, t.loginErr)),
  });

  const resetPw = useMutation({
    mutationFn: async (user: UserRow) => {
      const { error } = await api.v1
        .users({ id: user.id })
        ["reset-password"].post();
      if (error) throw error;
    },
    onSuccess: async (_d, user) => {
      await invalidate();
      pushToast(
        "success",
        t.umResetDoneT,
        `${user.email ?? user.nik ?? user.name} — ${t.umResetDoneD}`
      );
      setResetTarget(null);
    },
    onError: (error) =>
      pushToast("error", t.umResetT, errorMessage(error, t.loginErr)),
  });

  /* dialog tambah/edit */
  const [dlgOpen, setDlgOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<UserRow | null>(null);
  const [fEmail, setFEmail] = React.useState("");
  const [fNik, setFNik] = React.useState("");
  const [fName, setFName] = React.useState("");
  const [fRole, setFRole] = React.useState("");
  const [fActive, setFActive] = React.useState(true);
  const [err, setErr] = React.useState<string | null>(null);
  const [offTarget, setOffTarget] = React.useState<UserRow | null>(null);
  const [resetTarget, setResetTarget] = React.useState<UserRow | null>(null);

  function openAdd() {
    setEditing(null);
    setFEmail("");
    setFNik("");
    setFName("");
    setFRole(roles.data?.[0]?.id ?? "");
    setFActive(true);
    setErr(null);
    setDlgOpen(true);
  }
  function openEdit(u: UserRow) {
    setEditing(u);
    setFEmail(u.email ?? "");
    setFNik(u.nik ?? "");
    setFName(u.name);
    setFRole(u.roleId);
    setFActive(u.active);
    setErr(null);
    setDlgOpen(true);
  }
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const email = fEmail.trim();
    const nik = fNik.trim();
    if (!fName.trim() || !fRole) return setErr(t.umErrRequired);
    // An account is credentialed by email or NIK; the database enforces this
    // too, but saying so here beats a 422 round trip.
    if (!email && !nik) return setErr(t.umErrIdentifier);
    save.mutate({
      id: editing?.id ?? null,
      email: email || null,
      nik: nik || null,
      name: fName.trim(),
      roleId: fRole,
      active: fActive,
    });
  }

  function exportCsv() {
    const head = "email;nik;nama;role;status";
    const body = (users.data ?? [])
      .map((u) =>
        [
          u.email ?? "",
          u.nik ?? "",
          u.name,
          roleName(u.roleId),
          u.active ? "aktif" : "nonaktif",
        ].join(";")
      )
      .join("\n");
    const name = `users_${new Date().toISOString().slice(0, 10)}.csv`;
    downloadCsv(name, `${head}\n${body}`);
    pushToast("success", t.umToastExp, name);
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
              {(roles.data ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
            {/* A page of its own: the import is a multi-step flow with two
                tables, and it should not push this list off the screen. */}
            {canW ? (
              <Button
                variant="secondary"
                onClick={() => router.push("/users/import")}
              >
                <Upload />
                Import
              </Button>
            ) : null}
            <Button variant="secondary" onClick={exportCsv}>
              <Download />
              Export
            </Button>
          </ToolbarGroup>
        </Toolbar>

        {users.isPending ? (
          <TableSkeleton rows={6} />
        ) : pg.rows.length ? (
          <Table>
            <TableHeader>
              <tr>
                <TableHead>Email</TableHead>
                <TableHead className="max-xl:hidden">{t.thNama}</TableHead>
                <TableHead className="max-xl:hidden">NIK</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>{t.thStatus}</TableHead>
                <TableHead className="w-[150px]">{t.thAct}</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {pg.rows.map((u) => (
                <TableRow
                  key={u.id}
                  className={u.active ? undefined : "opacity-60"}
                >
                  <TableCell>
                    <b className="font-semibold">
                      {u.email ?? (
                        <span className="text-(--text-tertiary)">—</span>
                      )}
                    </b>
                  </TableCell>
                  <TableCell className="max-xl:hidden">
                    <span className="font-semibold">{u.name}</span>
                    {u.mustChangePassword ? (
                      <Badge variant="warning" className="ml-2">
                        {t.umMustChange}
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-mono text-(--text-secondary) tabular-nums max-xl:hidden">
                    {u.nik ?? <span className="text-(--text-tertiary)">—</span>}
                  </TableCell>
                  <TableCell>
                    <Badge variant="info">{roleName(u.roleId)}</Badge>
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
                        <IconButton
                          aria-label={t.umResetT}
                          onClick={() => setResetTarget(u)}
                        >
                          <KeyRound />
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
                            onClick={() =>
                              setActiveM.mutate({ user: u, active: true })
                            }
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
          {editing
            ? `${t.umUserEditT} — ${editing.email ?? editing.nik}`
            : t.umUserAdd}
        </DialogTitle>
        <DialogBody>{t.umUserDlgB}</DialogBody>
        <form onSubmit={submit} noValidate>
          <Field className="mt-4" label={t.thNama} htmlFor="um-name" required>
            <Input
              id="um-name"
              value={fName}
              onChange={(e) => {
                setFName(e.target.value);
                setErr(null);
              }}
            />
          </Field>
          <Field
            className="mt-4"
            label="Email"
            htmlFor="um-email"
            helper={t.umIdentHelp}
          >
            <Input
              id="um-email"
              type="email"
              placeholder="nama@unggul.co.id"
              value={fEmail}
              onChange={(e) => {
                setFEmail(e.target.value);
                setErr(null);
              }}
            />
          </Field>
          <Field className="mt-4" label="NIK" htmlFor="um-nik">
            <Input
              id="um-nik"
              placeholder="OPS-0421"
              value={fNik}
              onChange={(e) => {
                setFNik(e.target.value);
                setErr(null);
              }}
            />
          </Field>
          {/* Single-select: an account holds exactly one role. Two roles could
              disagree about scope, so the question has no coherent answer. */}
          <Field className="mt-4" label="Role" htmlFor="um-role" required>
            <Select
              id="um-role"
              value={fRole}
              onChange={(e) => {
                setFRole(e.target.value);
                setErr(null);
              }}
            >
              <option value="" disabled>
                {t.umPickRole}
              </option>
              {(roles.data ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} · {r.scope}
                </option>
              ))}
            </Select>
          </Field>
          <ToggleRow className="mt-4" htmlFor="um-active">
            <Checkbox
              id="um-active"
              checked={fActive}
              onChange={(e) => setFActive(e.target.checked)}
            />
            {t.stAktif}
          </ToggleRow>
          {err ? (
            <p className="mt-3 text-xs text-(--color-danger-text)">{err}</p>
          ) : null}
          {!editing ? (
            <p className="mt-3 text-xs text-(--text-tertiary)">
              {t.umDefaultPwNote}
            </p>
          ) : null}
          <DialogActions>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDlgOpen(false)}
            >
              {t.btnCancel}
            </Button>
            <Button type="submit" disabled={save.isPending}>
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
        <DialogTitle id="umoff-t">{`${t.umOff} ${offTarget?.email ?? offTarget?.nik ?? ""}?`}</DialogTitle>
        <DialogBody>{t.umOffB}</DialogBody>
        <DialogActions>
          <Button variant="ghost" onClick={() => setOffTarget(null)}>
            {t.btnCancel}
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (offTarget)
                setActiveM.mutate({ user: offTarget, active: false });
              setOffTarget(null);
            }}
          >
            {t.umOff}
          </Button>
        </DialogActions>
      </Dialog>

      {/* dialog reset password */}
      <Dialog
        open={resetTarget !== null}
        onClose={() => setResetTarget(null)}
        labelledBy="umrst-t"
      >
        <DialogIcon variant="warning">
          <KeyRound />
        </DialogIcon>
        <DialogTitle id="umrst-t">{`${t.umResetT} — ${resetTarget?.email ?? resetTarget?.nik ?? ""}`}</DialogTitle>
        <DialogBody>{t.umResetB}</DialogBody>
        <DialogActions>
          <Button variant="ghost" onClick={() => setResetTarget(null)}>
            {t.btnCancel}
          </Button>
          <Button
            variant="destructive"
            disabled={resetPw.isPending}
            onClick={() => resetTarget && resetPw.mutate(resetTarget)}
          >
            {t.umResetDo}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
