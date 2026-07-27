"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Search, Trash2, Upload, Volume2 } from "lucide-react";

import { MENU_LABELS } from "@universe/contracts";

import type { AccessMode } from "@/lib/access";
import { api, errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
  soundFileUrl,
  soundsKey,
  soundsQueryOptions,
  type SoundRow,
} from "@/lib/queries/sounds";
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

/** The API's cap, repeated here so a too-large file is refused before upload. */
const MAX_BYTES = 2 * 1024 * 1024;

const kb = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;

/**
 * Sound clips, with real upload and playback.
 *
 * The static port's file input made an object URL for preview and uploaded
 * nothing; the bytes now go to the API and come back from
 * `GET /v1/sounds/:id/file`. The size and type limits are checked here *and*
 * enforced there — the client check exists so an operator learns about a 6 MB
 * file before waiting for it to upload, not because it is the boundary.
 */
export function SoundsMenu({ mode }: { mode: AccessMode }) {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const canW = mode === "manage";

  const listQ = useQuery(soundsQueryOptions());
  const entries = React.useMemo(() => listQ.data ?? [], [listQ.data]);

  const [q, setQ] = React.useState("");
  const [stF, setStF] = React.useState("");
  const [dlgOpen, setDlgOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<SoundRow | null>(null);
  const [fName, setFName] = React.useState("");
  const [fActive, setFActive] = React.useState(true);
  const [fFile, setFFile] = React.useState<File | null>(null);
  const [fFileUrl, setFFileUrl] = React.useState<string | null>(null);
  const [errName, setErrName] = React.useState(false);
  const [errFile, setErrFile] = React.useState<string | null>(null);
  const [delTarget, setDelTarget] = React.useState<SoundRow | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  // The object URL is a resource, not a value: revoked when it is replaced or
  // the dialog closes, or every preview leaks a blob for the tab's lifetime.
  React.useEffect(() => {
    return () => {
      if (fFileUrl) URL.revokeObjectURL(fFileUrl);
    };
  }, [fFileUrl]);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: soundsKey });

  const save = useMutation({
    mutationFn: async (input: {
      id: string | null;
      name: string;
      active: boolean;
      file: File | null;
    }) => {
      // A new sound is a multipart upload; an edit is metadata only, because
      // replacing the audio would orphan the stored file behind the row.
      const result = input.id
        ? await api.v1.sounds({ id: input.id }).patch({
            name: input.name,
            active: input.active,
          })
        : await api.v1.sounds.post({
            name: input.name,
            file: input.file!,
          });
      if (result.error) throw result.error;
      return result.data;
    },
    onSuccess: async (_d, input) => {
      await invalidate();
      pushToast(
        "success",
        input.id ? t.mdEditToastT : t.mdAddToastT,
        input.name
      );
      setDlgOpen(false);
    },
    onError: (error) =>
      pushToast("error", t.mdAdd, errorMessage(error, t.loginErr)),
  });

  const del = useMutation({
    mutationFn: async (row: SoundRow) => {
      const { error } = await api.v1.sounds({ id: row.id }).delete();
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
    return !needle || r.name.toLowerCase().includes(needle);
  });
  const pg = usePagination(rows);

  function pickFile(picked: File) {
    if (!picked.type.startsWith("audio/")) {
      setErrFile(t.sndErrType);
      return;
    }
    if (picked.size > MAX_BYTES) {
      setErrFile(`${t.sndErrSize} (${kb(picked.size)})`);
      return;
    }
    setErrFile(null);
    setFFile(picked);
    setFFileUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(picked);
    });
  }

  function openAdd() {
    setEditing(null);
    setFName("");
    setFActive(true);
    setFFile(null);
    setFFileUrl(null);
    setErrName(false);
    setErrFile(null);
    setDlgOpen(true);
  }
  function openEdit(r: SoundRow) {
    setEditing(r);
    setFName(r.name);
    setFActive(r.active);
    setFFile(null);
    setFFileUrl(null);
    setErrName(false);
    setErrFile(null);
    setDlgOpen(true);
  }
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const name = fName.trim();
    setErrName(!name);
    if (!name) return;
    if (!editing && !fFile) {
      setErrFile(t.sndErrRequired);
      return;
    }
    save.mutate({
      id: editing?.id ?? null,
      name,
      active: fActive,
      file: fFile,
    });
  }

  const play = (src: string) => void new Audio(src).play().catch(() => {});

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={MENU_LABELS.sound} sub={t.mdSub}>
        {canW ? (
          <Button onClick={openAdd}>
            <Plus />
            {t.mdAdd}
          </Button>
        ) : null}
      </PageTitle>

      <Panel>
        <Toolbar>
          <ToolbarTitle>{MENU_LABELS.sound}</ToolbarTitle>
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
                <TableHead>{t.mdNama}</TableHead>
                <TableHead>File</TableHead>
                <TableHead>{t.thStatus}</TableHead>
                <TableHead style={{ width: 150 }}>{t.thAct}</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {pg.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <span className="font-semibold">{r.name}</span>
                  </TableCell>
                  <TableCell className="text-(--text-secondary)">
                    <span className="font-mono text-xs">{r.mimeType}</span>
                    <span className="ml-2">{kb(r.sizeBytes)}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.active ? "success" : "danger"} dot>
                      {r.active ? t.stAktif : t.stNonaktif}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <IconButton
                        aria-label="Putar"
                        onClick={() => play(soundFileUrl(r.id))}
                      >
                        <Volume2 />
                      </IconButton>
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
        labelledBy="sd-t"
      >
        <DialogIcon variant="info">
          <Volume2 />
        </DialogIcon>
        <DialogTitle id="sd-t">{editing ? t.mdEditT : t.mdAdd}</DialogTitle>
        <DialogBody>{editing ? t.sndEditB : t.sndAddB}</DialogBody>
        <form onSubmit={submit} noValidate>
          <Field
            className="mt-4"
            label={t.mdNama}
            htmlFor="sd-name"
            required
            error={errName}
            errorMessage={t.mdErrName}
          >
            <Input
              id="sd-name"
              value={fName}
              onChange={(e) => setFName(e.target.value)}
            />
          </Field>

          {/* Audio is chosen once, on creation: replacing it would leave the
              previous file on disk with nothing pointing at it. */}
          {editing ? (
            <Field className="mt-4" label="File">
              <div className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-sm text-(--text-secondary)">
                  {editing.mimeType} · {kb(editing.sizeBytes)}
                </span>
                <IconButton
                  type="button"
                  aria-label="Putar"
                  onClick={() => play(soundFileUrl(editing.id))}
                >
                  <Volume2 />
                </IconButton>
              </div>
            </Field>
          ) : (
            <Field
              className="mt-4"
              label="File"
              htmlFor="sd-file"
              required
              error={!!errFile}
              errorMessage={errFile ?? undefined}
              helper={t.sndHelp}
            >
              <div className="flex items-center gap-3">
                <input
                  ref={fileRef}
                  id="sd-file"
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={(e) => {
                    const picked = e.target.files?.[0];
                    if (picked) pickFile(picked);
                    e.target.value = "";
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload />
                  Pilih file
                </Button>
                {fFile ? (
                  <>
                    <span className="min-w-0 flex-1 truncate text-sm text-(--text-secondary)">
                      {fFile.name} · {kb(fFile.size)}
                    </span>
                    <IconButton
                      type="button"
                      aria-label="Putar"
                      onClick={() => fFileUrl && play(fFileUrl)}
                    >
                      <Volume2 />
                    </IconButton>
                  </>
                ) : (
                  <span className="flex-1 text-sm text-(--text-tertiary) italic">
                    Belum ada file
                  </span>
                )}
              </div>
            </Field>
          )}

          <ToggleRow className="mt-4" htmlFor="sd-active">
            <Checkbox
              id="sd-active"
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
        labelledBy="sdd-t"
      >
        <DialogIcon variant="danger">
          <Trash2 />
        </DialogIcon>
        <DialogTitle id="sdd-t">
          {t.mdDelT} &ldquo;{delTarget?.name}&rdquo;?
        </DialogTitle>
        <DialogBody>{t.sndDelB}</DialogBody>
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
