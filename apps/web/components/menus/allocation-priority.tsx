"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  ListOrdered,
} from "lucide-react";

import type { AccessMode } from "@/lib/access";
import { api, errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
  allocationPriorityKey,
  allocationPriorityQueryOptions,
  type PriorityRow,
} from "@/lib/queries/allocation-priority";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import {
  FootSum,
  PageTitle,
  Panel,
  PanelFoot,
  Toolbar,
  ToolbarGroup,
  ToolbarTitle,
} from "@/components/ui/panel";
import { StateBox } from "@/components/ui/state-box";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { useToast } from "@/components/ui/toast";

/**
 * How many unit codes a row names before it starts counting instead.
 *
 * Four fits the line at the widths this screen is read at; the rest is a
 * number, and the full list is one hover away in the title attribute.
 */
const CODES_SHOWN = 4;

/**
 * The rank, as somewhere to type.
 *
 * The arrows move a row one step, which is the wrong tool for the move people
 * actually make: "this class belongs fifth" is one decision, and reaching
 * position 5 from position 49 was forty-four clicks or a drag down a list
 * taller than the window. Typing the number says the whole thing at once.
 *
 * Holds its own draft so the field does not fight the list: the value is only
 * applied on Enter or on leaving, and reverts on Escape. Keyed by position by
 * its parent, so a row that moves gets a fresh field showing where it landed.
 */
function PositionInput({
  position,
  total,
  onCommit,
}: {
  position: number;
  total: number;
  onCommit: (to: number) => void;
}) {
  const [draft, setDraft] = React.useState(String(position));

  function commit() {
    const wanted = Number(draft);
    /* Anything that is not a position at all puts the field back rather than
       moving the row somewhere arbitrary — an empty box means "I changed my
       mind", not "send it to the top". */
    if (!Number.isInteger(wanted) || wanted < 1 || wanted > total) {
      setDraft(String(position));
      return;
    }
    if (wanted !== position) onCommit(wanted);
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label={`Posisi ${position}`}
      value={draft}
      onChange={(event) => setDraft(event.target.value.replace(/\D/g, ""))}
      onFocus={(event) => event.target.select()}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          setDraft(String(position));
          event.currentTarget.blur();
        }
      }}
      className="w-10 flex-none rounded-chip border border-transparent bg-transparent py-0.5 text-right font-mono text-sm font-semibold text-(--text-secondary) hover:border-(--divider) focus:border-(--color-primary-bright) focus:bg-(--fill-input) focus:text-(--text-primary) focus:outline-none"
    />
  );
}

/**
 * The row's identity, and the wire's.
 *
 * The description itself — it is the key. Blank is a real one: `description`
 * is `notNull` with an empty default, so a machine nobody described still has
 * to be rankable, and it gets a line that says so rather than none.
 */
const keyOf = (row: { description: string }) => row.description;

/**
 * The order the allocation engine fills vacancies in.
 *
 * One list, not one per unit type. The screen groups by type only to be
 * readable — the ordering itself has to span types, because the commonest tie
 * of all is between two of them: an operator holding both DUMP TRUCK and REAR
 * DUMP TRUCK codes is the ordinary case here, not the exception, and a
 * per-type list could not say which of those to crew first.
 *
 * Reordered by dragging, with arrows beside every row for the same move: drag
 * is how anyone moves a line from the bottom to the top without fifty clicks,
 * and the arrows are how it stays usable on a touchscreen and from a keyboard.
 */
export function AllocationPriorityMenu({ mode }: { mode: AccessMode }) {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const canManage = mode === "manage";

  const query = useQuery(allocationPriorityQueryOptions());

  /*
   * The working copy, and the server answer it was built from.
   *
   * Held locally because a reorder is a sequence of moves the reader is still
   * composing — saving each one would renumber the list under their hand and
   * make the board's order depend on how far they had got.
   *
   * The two travel together so the draft can be dropped by *comparison* at
   * render rather than by an effect: when the server sends a different list,
   * `base` no longer matches and the draft stops applying on its own. An
   * effect that reset it would run a render late, showing a stale order for
   * one frame, and lint rightly refuses the synchronous version of it.
   */
  const [draft, setDraft] = React.useState<{
    base: PriorityRow[];
    order: PriorityRow[];
  } | null>(null);

  const server = query.data ?? [];
  const live = draft && draft.base === query.data ? draft : null;
  const rows = live ? live.order : server;
  const dirty = live !== null;

  const save = useMutation({
    mutationFn: async (next: PriorityRow[]) => {
      const result = await api.v1["allocation-priority"].put({
        order: next.map((r) => ({ description: r.description })),
      });
      if (result.error) throw result.error;
      return result.data;
    },
    onSuccess: async () => {
      /* Cleared here rather than left to the comparison above: a save that
         changed nothing returns an identical list, and React Query hands back
         the same reference for it — so the draft would still match and the
         toolbar would go on claiming unsaved work. */
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey: allocationPriorityKey });
      pushToast("success", t.apTitle, t.apSaved);
    },
    onError: (error) =>
      pushToast("error", t.apTitle, errorMessage(error, t.loginErr)),
  });

  /*
   * The row that last moved, so a long jump can be followed.
   *
   * Sending a line from 49 to 5 puts it off the top of the window: without
   * this the list simply looks unchanged, and the reader has to scroll to find
   * out whether anything happened. Marked rather than flashed, so it also
   * answers "which one did I just move" a minute later.
   */
  const [landed, setLanded] = React.useState<string | null>(null);

  function move(from: number, to: number) {
    if (to < 0 || to >= rows.length || from === to) return;
    const next = [...rows];
    const [row] = next.splice(from, 1);
    next.splice(to, 0, row!);
    setDraft({ base: server, order: next });
    setLanded(keyOf(row!));
  }

  /* Scrolled after the list has been laid out again — the row is somewhere
     else by now, and asking for it before the render would find where it
     used to be. */
  React.useEffect(() => {
    if (!landed) return;
    document
      .getElementById(`prio-${landed}`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [landed, rows]);

  /* Native drag: no library, and nothing to keep in step with React's own
     rendering. The dragged row's index rides in state rather than in the
     dataTransfer payload, because Firefox will not read that payload during
     `dragover` — which is where the row has to move to be seen moving. */
  const [dragging, setDragging] = React.useState<number | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={t.apTitle} sub={t.apSub} />

      <Panel>
        <Toolbar className="mb-3">
          <ToolbarTitle>{t.apListTitle}</ToolbarTitle>
          <ToolbarGroup>
            {dirty ? (
              <>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setDraft(null);
                    setLanded(null);
                  }}
                >
                  {t.apReset}
                </Button>
                <Button
                  onClick={() => save.mutate(rows)}
                  disabled={save.isPending}
                >
                  {save.isPending ? t.apSaving : t.apSave}
                </Button>
              </>
            ) : null}
          </ToolbarGroup>
        </Toolbar>

        {query.isPending ? (
          <TableSkeleton rows={8} />
        ) : !rows.length ? (
          <StateBox
            icon={<ListOrdered className="text-(--color-primary-bright)" />}
            title={t.apEmpty}
            body={t.apEmptyB}
          />
        ) : (
          <>
            <ol className="flex flex-col gap-1.5">
              {rows.map((row, index) => (
                <li
                  key={keyOf(row)}
                  id={`prio-${keyOf(row)}`}
                  draggable={canManage}
                  onDragStart={() => setDragging(index)}
                  onDragEnd={() => setDragging(null)}
                  onDragOver={(event) => {
                    event.preventDefault();
                    if (dragging === null || dragging === index) return;
                    move(dragging, index);
                    setDragging(index);
                  }}
                  title={row.unitCodes.join(", ")}
                  className={cn(
                    "flex items-center gap-3 rounded-control border border-(--divider) bg-(--fill-subtle) px-3 py-2",
                    canManage && "cursor-grab",
                    dragging === index && "opacity-50",
                    landed === keyOf(row) &&
                      "border-(--color-primary-bright) bg-(--fill-hover)"
                  )}
                >
                  {canManage ? (
                    <PositionInput
                      key={index}
                      position={index + 1}
                      total={rows.length}
                      onCommit={(to) => move(index, to - 1)}
                    />
                  ) : (
                    <span className="w-10 flex-none text-right font-mono text-sm font-semibold text-(--text-secondary)">
                      {index + 1}
                    </span>
                  )}
                  {canManage ? (
                    <GripVertical className="size-4 flex-none text-(--text-tertiary)" />
                  ) : null}

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {row.description || t.apNoDescription}
                      {/* Beside the class rather than on the line below: it
                          says what kind of machine this is, which is the same
                          question the class answers. Two makes on one line is
                          the honest reading of a pair that holds both — it is
                          not a choice between them, since the ranking does not
                          separate makes. */}
                      {row.brandNames.length ? (
                        <span className="ml-2 font-normal text-(--text-tertiary)">
                          {row.brandNames.join(", ")}
                        </span>
                      ) : null}
                    </span>
                    {/* The machines this line actually moves, so a rank is set
                        against real units rather than against a category. Only
                        the first few: one pair here covers 83 units, and a row
                        that wrapped to six lines would bury every other row on
                        the screen. The count beside it says what is hidden. */}
                    <span className="mt-px block truncate text-xs text-(--text-tertiary)">
                      {row.typeName}
                      {row.unitCodes.length ? (
                        <>
                          {" · "}
                          <span className="font-mono">
                            {row.unitCodes.slice(0, CODES_SHOWN).join(", ")}
                          </span>
                          {row.unitCodes.length > CODES_SHOWN
                            ? ` +${row.unitCodes.length - CODES_SHOWN}`
                            : null}
                        </>
                      ) : null}
                    </span>
                  </span>

                  {/* The codes are what actually gate who may drive these, so
                      they read as badges rather than as more grey text. A
                      description may cover several — four sit under
                      EXCAVATOR200T — and they are listed, not ranked apart. */}
                  {row.simperCodeNames.length ? (
                    row.simperCodeNames.map((code) => (
                      <Badge key={code} variant="info" className="font-mono">
                        {code}
                      </Badge>
                    ))
                  ) : (
                    <Badge variant="neutral">{t.apNoCode}</Badge>
                  )}

                  {/* How much of the yard this line is worth, so a rank can be
                      weighed rather than guessed. */}
                  <span className="w-20 flex-none text-right text-xs text-(--text-tertiary)">
                    {row.units} {t.apUnits}
                  </span>

                  {row.rank === null ? (
                    <Badge variant="warning">{t.apUnranked}</Badge>
                  ) : null}

                  {canManage ? (
                    <span className="flex flex-none gap-1">
                      <IconButton
                        aria-label={t.apUp}
                        title={t.apUp}
                        disabled={index === 0}
                        onClick={() => move(index, index - 1)}
                      >
                        <ChevronUp />
                      </IconButton>
                      <IconButton
                        aria-label={t.apDown}
                        title={t.apDown}
                        disabled={index === rows.length - 1}
                        onClick={() => move(index, index + 1)}
                      >
                        <ChevronDown />
                      </IconButton>
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
            <PanelFoot>
              <FootSum>
                <b>{rows.length}</b> {t.apPairs}
                {dirty ? ` · ${t.apDirty}` : null}
              </FootSum>
            </PanelFoot>
          </>
        )}
      </Panel>
    </div>
  );
}
