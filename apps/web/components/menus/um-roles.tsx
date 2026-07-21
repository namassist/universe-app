"use client";

import * as React from "react";
import {
  Download,
  Lock,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
} from "lucide-react";

import type { AccessMode } from "@/lib/access";
import { downloadCsv } from "@/lib/csv";
import { useI18n } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n/id";
import {
  emptyPerms,
  MENU_SLUGS,
  pageSections,
  ROLES_INIT,
  roleUserCount,
  USERS_INIT,
  type MenuSlug,
  type UmPerm,
  type UmRole,
  type UmScope,
} from "@/lib/um-data";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogIcon,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FormGrid } from "@/components/ui/field";
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
import { Segmented, SegmentedButton } from "@/components/ui/segmented";
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

const SCOPE_LABEL_KEYS: Record<UmScope, keyof Dict> = {
  all: "umScopeAll",
  dept: "umScopeDept",
  self: "umScopeSelf",
};

export function UmRolesMenu({ mode }: { mode: AccessMode }) {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const canW = mode === "manage";
  const impRef = React.useRef<HTMLInputElement>(null);

  const [roles, setRoles] = React.useState<UmRole[]>(ROLES_INIT);
  const [q, setQ] = React.useState("");

  /* dialog tambah/edit role */
  const [dlgOpen, setDlgOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<UmRole | null>(null);
  const [fName, setFName] = React.useState("");
  const [fDesc, setFDesc] = React.useState("");
  const [fScope, setFScope] = React.useState<UmScope>("self");
  const [fPerms, setFPerms] =
    React.useState<Record<MenuSlug, UmPerm>>(emptyPerms);
  const [nameErr, setNameErr] = React.useState(false);
  const [delTarget, setDelTarget] = React.useState<UmRole | null>(null);

  const userCount = (roleId: string) => roleUserCount(USERS_INIT, roleId);

  const rows = roles.filter(
    (r) =>
      !q ||
      r.name.toLowerCase().includes(q.toLowerCase()) ||
      r.desc.toLowerCase().includes(q.toLowerCase())
  );
  const pg = usePagination(rows);
  const locked = !!editing?.locked;
  const sections = pageSections();

  const permStr = (r: UmRole) => {
    const vals = Object.values(r.perms);
    const m = vals.filter((p) => p === "manage").length;
    const v = vals.filter((p) => p === "view").length;
    return `${m} ${t.umPManage.toLowerCase()} · ${v} ${t.umPView.toLowerCase()}`;
  };

  function openAdd() {
    setEditing(null);
    setFName("");
    setFDesc("");
    setFScope("self");
    setFPerms(emptyPerms());
    setNameErr(false);
    setDlgOpen(true);
  }
  function openEdit(r: UmRole) {
    setEditing(r);
    setFName(r.name);
    setFDesc(r.desc);
    setFScope(r.scope);
    setFPerms({ ...r.perms });
    setNameErr(false);
    setDlgOpen(true);
  }
  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!fName.trim()) {
      setNameErr(true);
      return;
    }
    const data = {
      name: fName.trim(),
      desc: fDesc.trim(),
      scope: fScope,
      perms: fPerms,
    };
    if (editing) {
      setRoles((prev) =>
        prev.map((r) => (r.id === editing.id ? { ...r, ...data } : r))
      );
      pushToast("success", t.umToastRoleEdit, data.name);
    } else {
      setRoles((prev) => [
        ...prev,
        { id: `n-${data.name}`, locked: false, ...data },
      ]);
      pushToast("success", t.umToastRoleAdd, data.name);
    }
    setDlgOpen(false);
  }
  function delDo() {
    if (!delTarget) return;
    setRoles((prev) => prev.filter((r) => r.id !== delTarget.id));
    pushToast("success", t.umToastRoleDel, delTarget.name);
    setDelTarget(null);
  }
  function exportCsv() {
    const head = ["role", "deskripsi", "lingkup", ...MENU_SLUGS].join(";");
    const body = roles
      .map((r) =>
        [r.name, r.desc, r.scope, ...MENU_SLUGS.map((m) => r.perms[m])].join(
          ";"
        )
      )
      .join("\n");
    const name = `roles_${new Date().toISOString().slice(0, 10)}.csv`;
    downloadCsv(name, `${head}\n${body}`);
    pushToast("success", t.umToastExp, name);
  }
  function importChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    pushToast("success", t.umToastImp, `${file.name} — 1 ${t.umToastImpD}`);
    e.target.value = "";
  }

  const delUsed = delTarget ? userCount(delTarget.id) : 0;

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={t.umRolesT} sub={t.umRoleSub}>
        {canW ? (
          <Button onClick={openAdd}>
            <Plus />
            {t.umRoleAdd}
          </Button>
        ) : null}
      </PageTitle>

      <div className="flex flex-col gap-6">
        <Panel>
          <Toolbar>
            <ToolbarTitle>{t.umRoleListT}</ToolbarTitle>
            <ToolbarGroup>
              <SearchInput
                className="w-[240px]"
                placeholder={t.umRoleSearchPh}
                aria-label={t.umRoleSearchPh}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
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
                  <TableHead>Role</TableHead>
                  <TableHead className="max-xl:hidden">{t.umDesc}</TableHead>
                  <TableHead>Permission</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead className="w-[110px]">{t.thAct}</TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {pg.rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <span className="inline-flex items-center gap-2">
                        <Badge variant="info">{r.name}</Badge>
                        {r.locked ? (
                          <Lock className="size-3.5 text-(--text-tertiary)" />
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell className="text-(--text-secondary) max-xl:hidden">
                      {r.desc}
                    </TableCell>
                    <TableCell className="font-mono">{permStr(r)}</TableCell>
                    <TableCell className="font-mono">
                      {userCount(r.id)}
                    </TableCell>
                    <TableCell>
                      {canW ? (
                        <div className="flex gap-2">
                          <IconButton
                            aria-label={t.udbEditT}
                            onClick={() => openEdit(r)}
                          >
                            <Pencil />
                          </IconButton>
                          {!r.locked ? (
                            <IconButton
                              danger
                              aria-label={t.empDel}
                              onClick={() => setDelTarget(r)}
                            >
                              <Trash2 />
                            </IconButton>
                          ) : null}
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
              {t.attSumA} <b>{pg.range}</b> {t.attSumB} <b>{pg.total}</b> role
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

        {/* matriks RBAC: baris = halaman (ber-seksi), kolom = semua role */}
        <Panel>
          <Toolbar>
            <ToolbarTitle>{t.umRbacT}</ToolbarTitle>
          </Toolbar>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <tr>
                  <TableHead>{t.umRbacPageCol}</TableHead>
                  {roles.map((r) => (
                    <TableHead key={r.id} className="text-center">
                      {r.name}
                    </TableHead>
                  ))}
                </tr>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-semibold">{t.umScopeT}</TableCell>
                  {roles.map((r) => (
                    <TableCell key={r.id} className="text-center">
                      <Badge variant="info">
                        {t[SCOPE_LABEL_KEYS[r.scope]]}
                      </Badge>
                    </TableCell>
                  ))}
                </TableRow>
                {sections.map((s) => (
                  <React.Fragment key={s.key}>
                    {s.pages.length > 1 ? (
                      <tr>
                        <td
                          colSpan={roles.length + 1}
                          className="px-4 pt-4 pb-1.5 text-xs font-semibold tracking-wide text-(--text-tertiary) uppercase"
                        >
                          {s.label}
                        </td>
                      </tr>
                    ) : null}
                    {s.pages.map(([m, label]) => (
                      <TableRow key={m}>
                        <TableCell
                          className={cn(
                            "text-(--text-secondary)",
                            s.pages.length > 1 && "pl-8"
                          )}
                        >
                          {label}
                        </TableCell>
                        {roles.map((r) => {
                          const perm = r.perms[m];
                          return (
                            <TableCell key={r.id} className="text-center">
                              {perm === "none" ? (
                                <span className="text-(--text-disabled)">
                                  —
                                </span>
                              ) : (
                                <Badge
                                  variant={
                                    perm === "manage" ? "info" : "neutral"
                                  }
                                >
                                  {perm === "manage" ? t.umPManage : t.umPView}
                                </Badge>
                              )}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="mt-4 text-xs leading-normal text-(--text-secondary)">
            {t.umRbacNote}
          </p>
        </Panel>
      </div>

      {/* dialog tambah/edit role + matriks perms */}
      <Dialog
        open={dlgOpen}
        onClose={() => setDlgOpen(false)}
        className="w-[min(620px,100%)]"
        labelledBy="umr-t"
      >
        <DialogIcon variant="info">
          <Lock />
        </DialogIcon>
        <DialogTitle id="umr-t">
          {editing ? `${t.umRoleEditT} — ${editing.name}` : t.umRoleAdd}
        </DialogTitle>
        <DialogBody>{t.umRoleDlgB}</DialogBody>
        <form onSubmit={save} noValidate>
          <FormGrid className="mt-4">
            <Field
              label={t.umRoleName}
              htmlFor="um-rname"
              required
              error={nameErr}
              errorMessage={t.mdErrName}
            >
              <Input
                id="um-rname"
                placeholder="Admin Roster"
                disabled={locked}
                value={fName}
                onChange={(e) => {
                  setFName(e.target.value);
                  if (e.target.value.trim()) setNameErr(false);
                }}
              />
            </Field>
            <Field label={t.umDesc} htmlFor="um-rdesc">
              <Input
                id="um-rdesc"
                value={fDesc}
                onChange={(e) => setFDesc(e.target.value)}
              />
            </Field>
          </FormGrid>
          <div className="mt-5">
            <div className="mb-3 flex items-center gap-3">
              <label className="flex-1 text-sm font-medium">{t.umScopeT}</label>
              <Segmented role="group" aria-label={t.umScopeT}>
                {(["all", "dept", "self"] as UmScope[]).map((s) => (
                  <SegmentedButton
                    key={s}
                    type="button"
                    active={fScope === s}
                    disabled={locked}
                    className="px-2.5 py-1 text-xs disabled:cursor-not-allowed"
                    onClick={() => setFScope(s)}
                  >
                    {t[SCOPE_LABEL_KEYS[s]]}
                  </SegmentedButton>
                ))}
              </Segmented>
            </div>
            <div className="mb-3 flex items-center justify-between">
              <label className="text-sm font-medium">{t.umMatrixT}</label>
              <span className="text-xs text-(--text-tertiary)">
                {t.umMatrixHint}
              </span>
            </div>
            <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
              {sections.map((s) => (
                <React.Fragment key={s.key}>
                  {s.pages.length > 1 ? (
                    <div className="mt-2 px-2.5 text-xs font-semibold tracking-wide text-(--text-tertiary) uppercase first:mt-0">
                      {s.label}
                    </div>
                  ) : null}
                  {s.pages.map(([m, label]) => (
                    <div
                      key={m}
                      className={cn(
                        "flex items-center gap-3 rounded-lg bg-(--fill-subtle) px-2.5 py-1.5",
                        s.pages.length > 1 && "ml-2.5"
                      )}
                    >
                      <span className="flex-1 text-sm font-medium">
                        {label}
                      </span>
                      <Segmented role="group" aria-label={label}>
                        {(
                          [
                            ["none", t.umPNone],
                            ["view", t.umPView],
                            ["manage", t.umPManage],
                          ] as [UmPerm, string][]
                        ).map(([p, plabel]) => (
                          <SegmentedButton
                            key={p}
                            type="button"
                            active={fPerms[m] === p}
                            disabled={locked}
                            className="px-2.5 py-1 text-xs disabled:cursor-not-allowed"
                            onClick={() =>
                              setFPerms((prev) => ({ ...prev, [m]: p }))
                            }
                          >
                            {plabel}
                          </SegmentedButton>
                        ))}
                      </Segmented>
                    </div>
                  ))}
                </React.Fragment>
              ))}
            </div>
            {locked ? (
              <p className="mt-3 text-xs text-(--text-tertiary)">
                {t.umLockedNote}
              </p>
            ) : null}
          </div>
          <DialogActions>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDlgOpen(false)}
            >
              {t.btnCancel}
            </Button>
            {!locked ? (
              <Button type="submit">
                {editing ? t.udbSaveEdit : t.umRoleSaveAdd}
              </Button>
            ) : null}
          </DialogActions>
        </form>
      </Dialog>

      {/* dialog hapus role — terblokir bila masih dipakai user */}
      <Dialog
        open={delTarget !== null}
        onClose={() => setDelTarget(null)}
        labelledBy="umrd-t"
      >
        <DialogIcon variant="danger">
          <Trash2 />
        </DialogIcon>
        <DialogTitle id="umrd-t">{`${t.umRoleDelT} "${delTarget?.name ?? ""}"?`}</DialogTitle>
        <DialogBody>
          {delUsed > 0
            ? `${t.umRoleDelBlocked} ${delUsed} user.`
            : t.umRoleDelB}
        </DialogBody>
        <DialogActions>
          <Button variant="ghost" onClick={() => setDelTarget(null)}>
            {t.btnCancel}
          </Button>
          {delUsed === 0 ? (
            <Button variant="destructive" onClick={delDo}>
              {t.empDelDo}
            </Button>
          ) : null}
        </DialogActions>
      </Dialog>
    </div>
  );
}
