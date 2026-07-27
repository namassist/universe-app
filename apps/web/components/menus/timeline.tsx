"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, Pencil, Plus, Search, Trash2 } from "lucide-react";

import {
  MENU_LABELS,
  TIMELINE_ACTIONS,
  timelineActionLabel,
  type TimelineAction,
} from "@universe/contracts";

import type { AccessMode } from "@/lib/access";
import { api, errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
  timelineKey,
  timelineQueryOptions,
  type TimelineStageRow,
} from "@/lib/queries/timeline";
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

/**
 * The morning allocation schedule — not a display announcement.
 *
 * These rows are read by the scheduler each minute, so editing a time here
 * changes when that stage next fires with no deploy. The action select is
 * driven by `TIMELINE_ACTIONS` from the contracts package and submits the
 * **value**, never the label: dispatch matches on the value, so rewording a
 * label is a presentation change and nothing else.
 */
export function TimelineMenu({ mode }: { mode: AccessMode }) {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const canW = mode === "manage";

  const listQ = useQuery(timelineQueryOptions());
  const entries = React.useMemo(() => listQ.data ?? [], [listQ.data]);

  const [q, setQ] = React.useState("");
  const [stF, setStF] = React.useState("");
  const [dlgOpen, setDlgOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<TimelineStageRow | null>(null);
  const [fName, setFName] = React.useState("");
  const [fAt, setFAt] = React.useState("05:00");
  const [fAction, setFAction] = React.useState<TimelineAction>(
    TIMELINE_ACTIONS[0]
  );
  const [fActive, setFActive] = React.useState(true);
  const [errName, setErrName] = React.useState(false);
  const [delTarget, setDelTarget] = React.useState<TimelineStageRow | null>(
    null
  );

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: timelineKey });

  const save = useMutation({
    mutationFn: async (input: {
      id: string | null;
      name: string;
      at: string;
      action: TimelineAction;
      active: boolean;
    }) => {
      const body = {
        name: input.name,
        at: input.at,
        action: input.action,
        active: input.active,
      };
      const result = input.id
        ? await api.v1.timeline({ id: input.id }).patch(body)
        : await api.v1.timeline.post(body);
      if (result.error) throw result.error;
      return result.data;
    },
    onSuccess: async (_d, input) => {
      await invalidate();
      pushToast(
        "success",
        input.id ? t.mdEditToastT : t.mdAddToastT,
        `${input.name} — ${input.at}`
      );
      setDlgOpen(false);
    },
    onError: (error) =>
      pushToast("error", t.mdAdd, errorMessage(error, t.loginErr)),
  });

  const del = useMutation({
    mutationFn: async (row: TimelineStageRow) => {
      const { error } = await api.v1.timeline({ id: row.id }).delete();
      if (error) throw error;
    },
    onSuccess: async (_d, row) => {
      await invalidate();
      pushToast("success", t.mdDelToastT, row.name);
      setDelTarget(null);
    },
    onError: (error) =>
      pushToast("error", t.mdDelT, errorMessage(error, t.loginErr)),
  });

  const rows = entries.filter((r) => {
    if (stF === "1" && !r.active) return false;
    if (stF === "0" && r.active) return false;
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return (
      r.name.toLowerCase().includes(needle) ||
      r.at.includes(needle) ||
      timelineActionLabel(r.action).toLowerCase().includes(needle)
    );
  });
  const pg = usePagination(rows);

  function openAdd() {
    setEditing(null);
    setFName("");
    setFAt("05:00");
    setFAction(TIMELINE_ACTIONS[0]);
    setFActive(true);
    setErrName(false);
    setDlgOpen(true);
  }
  function openEdit(r: TimelineStageRow) {
    setEditing(r);
    setFName(r.name);
    setFAt(r.at);
    setFAction(r.action);
    setFActive(r.active);
    setErrName(false);
    setDlgOpen(true);
  }
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const name = fName.trim();
    setErrName(!name);
    if (!name) return;
    save.mutate({
      id: editing?.id ?? null,
      name,
      at: fAt,
      action: fAction,
      active: fActive,
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={MENU_LABELS.timeline} sub={t.tlSub}>
        {canW ? (
          <Button onClick={openAdd}>
            <Plus />
            {t.mdAdd}
          </Button>
        ) : null}
      </PageTitle>

      <Panel>
        <Toolbar>
          <ToolbarTitle>{MENU_LABELS.timeline}</ToolbarTitle>
          <ToolbarGroup>
            <SearchInput
              className="w-[240px]"
              placeholder={t.mdSearchPh}
              aria-label={t.mdSearchPh}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <Select
              wrapperClassName="w-[160px]"
              value={stF}
              onChange={(e) => setStF(e.target.value)}
              aria-label={t.allStatus}
            >
              <option value="">{t.allStatus}</option>
              <option value="1">{t.stAktif}</option>
              <option value="0">{t.stNonaktif}</option>
            </Select>
          </ToolbarGroup>
        </Toolbar>

        {rows.length ? (
          <Table>
            <TableHeader>
              <tr>
                <TableHead>Nama Tahap</TableHead>
                <TableHead>{t.mdJam}</TableHead>
                <TableHead>Aksi</TableHead>
                <TableHead>{t.thStatus}</TableHead>
                <TableHead style={{ width: 110 }}>{t.thAct}</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {pg.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <span className="font-semibold">{r.name}</span>
                  </TableCell>
                  <TableCell className="font-mono">{r.at}</TableCell>
                  <TableCell className="text-(--text-secondary)">
                    {timelineActionLabel(r.action)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.active ? "success" : "danger"} dot>
                      {r.active ? t.stAktif : t.stNonaktif}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      {canW ? (
                        <>
                          <IconButton
                            aria-label={t.mdEditT}
                            onClick={() => openEdit(r)}
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
            body={t.mdEmptyB}
          />
        )}

        <PanelFoot>
          <FootSum>
            {t.attSumA} <b>{pg.range}</b> {t.attSumB} <b>{pg.total}</b>{" "}
            {t.mdSumB}
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

      <Dialog
        open={dlgOpen}
        onClose={() => setDlgOpen(false)}
        labelledBy="tl-t"
      >
        <DialogIcon variant="info">
          <Clock />
        </DialogIcon>
        <DialogTitle id="tl-t">{editing ? t.mdEditT : t.mdAdd}</DialogTitle>
        <DialogBody>{t.tlDlgB}</DialogBody>
        <form onSubmit={submit} noValidate>
          <Field
            className="mt-4"
            label="Nama Tahap"
            htmlFor="tl-name"
            required
            error={errName}
            errorMessage={t.mdErrName}
          >
            <Input
              id="tl-name"
              value={fName}
              onChange={(e) => setFName(e.target.value)}
            />
          </Field>
          <Field className="mt-4" label={t.mdJam} htmlFor="tl-at">
            <Input
              id="tl-at"
              type="time"
              className="font-mono"
              value={fAt}
              onChange={(e) => setFAt(e.target.value)}
            />
          </Field>
          <Field className="mt-4" label="Aksi" htmlFor="tl-action">
            {/* The option's value is the contract value; the label is only what
                it reads as. Submitting the label would make dispatch depend on
                the wording of a translation. */}
            <Select
              id="tl-action"
              value={fAction}
              onChange={(e) => setFAction(e.target.value as TimelineAction)}
            >
              {TIMELINE_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {timelineActionLabel(a)}
                </option>
              ))}
            </Select>
          </Field>
          <ToggleRow className="mt-4" htmlFor="tl-active">
            <Checkbox
              id="tl-active"
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
            <Button type="submit" disabled={save.isPending}>
              {editing ? t.udbSaveEdit : t.mdSaveAdd}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      <Dialog
        open={!!delTarget}
        onClose={() => setDelTarget(null)}
        labelledBy="tld-t"
      >
        <DialogIcon variant="danger">
          <Trash2 />
        </DialogIcon>
        <DialogTitle id="tld-t">
          {t.mdDelT} &ldquo;{delTarget?.name}&rdquo;?
        </DialogTitle>
        <DialogBody>{t.mdDelB}</DialogBody>
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
