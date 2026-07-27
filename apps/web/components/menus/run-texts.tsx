"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Megaphone, Pencil, Plus, Search, Trash2 } from "lucide-react";

import {
  COLOR_VAL,
  MENU_LABELS,
  RUNTEXT_COLORS,
  type RunTextColor,
} from "@universe/contracts";

import type { AccessMode } from "@/lib/access";
import { api, errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
  runTextsKey,
  runTextsQueryOptions,
  type RunTextRow,
} from "@/lib/queries/run-texts";
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
 * The master running-text list — what every display shows unless it carries
 * texts of its own (design D8).
 *
 * Its own screen rather than the generic catalogue component: a running text is
 * display content, not a lookup value, and it has a colour rather than a
 * description. It shared that component only because the static port needed a
 * table with a dialog.
 */
export function RunTextsMenu({ mode }: { mode: AccessMode }) {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const canW = mode === "manage";

  const listQ = useQuery(runTextsQueryOptions());
  const entries = React.useMemo(() => listQ.data ?? [], [listQ.data]);

  const [q, setQ] = React.useState("");
  const [stF, setStF] = React.useState("");
  const [dlgOpen, setDlgOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<RunTextRow | null>(null);
  const [fText, setFText] = React.useState("");
  const [fColor, setFColor] = React.useState<RunTextColor>(RUNTEXT_COLORS[0]);
  const [fActive, setFActive] = React.useState(true);
  const [errText, setErrText] = React.useState(false);
  const [delTarget, setDelTarget] = React.useState<RunTextRow | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: runTextsKey });

  const save = useMutation({
    mutationFn: async (input: {
      id: string | null;
      text: string;
      color: RunTextColor;
      active: boolean;
    }) => {
      const result = input.id
        ? await api.v1["run-texts"]({ id: input.id }).patch({
            text: input.text,
            color: input.color,
            active: input.active,
          })
        : await api.v1["run-texts"].post({
            text: input.text,
            color: input.color,
            active: input.active,
          });
      if (result.error) throw result.error;
      return result.data;
    },
    onSuccess: async (_d, input) => {
      await invalidate();
      pushToast(
        "success",
        input.id ? t.mdEditToastT : t.mdAddToastT,
        input.text
      );
      setDlgOpen(false);
    },
    onError: (error) =>
      pushToast("error", t.mdAdd, errorMessage(error, t.loginErr)),
  });

  const del = useMutation({
    mutationFn: async (row: RunTextRow) => {
      const { error } = await api.v1["run-texts"]({ id: row.id }).delete();
      if (error) throw error;
    },
    onSuccess: async (_d, row) => {
      await invalidate();
      pushToast("success", t.mdDelToastT, row.text);
      setDelTarget(null);
    },
    onError: (error) =>
      pushToast("error", t.mdDelT, errorMessage(error, t.loginErr)),
  });

  const rows = entries.filter((r) => {
    if (stF === "1" && !r.active) return false;
    if (stF === "0" && r.active) return false;
    const needle = q.trim().toLowerCase();
    return !needle || r.text.toLowerCase().includes(needle);
  });
  const pg = usePagination(rows);

  function openAdd() {
    setEditing(null);
    setFText("");
    setFColor(RUNTEXT_COLORS[0]);
    setFActive(true);
    setErrText(false);
    setDlgOpen(true);
  }
  function openEdit(r: RunTextRow) {
    setEditing(r);
    setFText(r.text);
    setFColor(r.color);
    setFActive(r.active);
    setErrText(false);
    setDlgOpen(true);
  }
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = fText.trim();
    setErrText(!text);
    if (!text) return;
    save.mutate({
      id: editing?.id ?? null,
      text,
      color: fColor,
      active: fActive,
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={MENU_LABELS["running-text"]} sub={t.mdSub}>
        {canW ? (
          <Button onClick={openAdd}>
            <Plus />
            {t.mdAdd}
          </Button>
        ) : null}
      </PageTitle>

      <Panel>
        <Toolbar>
          <ToolbarTitle>{MENU_LABELS["running-text"]}</ToolbarTitle>
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
                <TableHead>Teks</TableHead>
                <TableHead>Warna</TableHead>
                <TableHead>{t.thStatus}</TableHead>
                <TableHead style={{ width: 110 }}>{t.thAct}</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {pg.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="max-w-[520px]">
                    <span className="font-semibold">{r.text}</span>
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-2">
                      <i
                        className="inline-block size-3 rounded"
                        style={{ background: COLOR_VAL[r.color] }}
                      />
                      {r.color}
                    </span>
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
        labelledBy="rt-t"
      >
        <DialogIcon variant="info">
          <Megaphone />
        </DialogIcon>
        <DialogTitle id="rt-t">{editing ? t.mdEditT : t.mdAdd}</DialogTitle>
        <DialogBody>{t.mdDlgB}</DialogBody>
        <form onSubmit={submit} noValidate>
          <Field
            className="mt-4"
            label="Teks"
            htmlFor="rt-text"
            required
            error={errText}
            errorMessage={t.mdErrName}
          >
            <Input
              id="rt-text"
              value={fText}
              onChange={(e) => setFText(e.target.value)}
            />
          </Field>
          <Field className="mt-4" label="Warna" htmlFor="rt-color">
            <div className="flex items-center gap-3">
              <Select
                id="rt-color"
                value={fColor}
                onChange={(e) => setFColor(e.target.value as RunTextColor)}
              >
                {RUNTEXT_COLORS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
              <span
                className="inline-block size-4 flex-none rounded"
                style={{ background: COLOR_VAL[fColor] }}
              />
            </div>
          </Field>
          <ToggleRow className="mt-4" htmlFor="rt-active">
            <Checkbox
              id="rt-active"
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
        labelledBy="rtd-t"
      >
        <DialogIcon variant="danger">
          <Trash2 />
        </DialogIcon>
        <DialogTitle id="rtd-t">
          {t.mdDelT} &ldquo;{delTarget?.text}&rdquo;?
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
