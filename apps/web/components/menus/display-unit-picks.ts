/**
 * The pure half of a unit wall's picker (owner, 2026-11-05): which picks are
 * still in Fleet Setting, what a search matches, and the order the admin
 * builds. Kept out of the component so it can be tested without one.
 */

/** A unit the picker offers — the shape `GET /devices/fleet-units` returns. */
export type UnitOption = {
  id: string;
  code: string;
  modelName: string;
  groupKind: "fleet" | "support";
  leaderCode: string | null;
  area: string | null;
};

/**
 * A wall's picks, split into those Fleet Setting still offers and those it no
 * longer does. The wall already ignores the stale ones; the form shows them so
 * the admin sees why a card went missing, and saving drops them.
 *
 * `options` undefined means not loaded yet, and then nothing is stale.
 */
export function splitUnitPicks(
  picked: readonly string[],
  options: readonly UnitOption[] | undefined
): { live: string[]; stale: string[] } {
  if (!options) return { live: [...picked], stale: [] };
  const offered = new Set(options.map((o) => o.id));
  return {
    live: picked.filter((id) => offered.has(id)),
    stale: picked.filter((id) => !offered.has(id)),
  };
}

/** Whether a search matches a unit: code, model, formation, area or "support". */
export function matchesUnitOption(option: UnitOption, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [
    option.code,
    option.modelName,
    option.leaderCode,
    option.area,
    option.groupKind === "support" ? "support" : null,
  ].some((field) => !!field && field.toLowerCase().includes(needle));
}

/** Tick or untick; a new tick goes last, so pick order is screen order. */
export function toggleItem(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

/** One step up (-1) or down (1); the same list back when it cannot move. */
export function moveItem(list: string[], id: string, dir: -1 | 1): string[] {
  const i = list.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

/** The name a unit wall gets when the admin leaves the field empty. */
export function unitWallName(
  picked: readonly string[],
  codeOf: ReadonlyMap<string, string>
): string | null {
  const first = picked[0] ? codeOf.get(picked[0]) : undefined;
  if (!first) return null;
  return picked.length === 1
    ? `Unit ${first}`
    : `Unit ${first} +${picked.length - 1}`;
}
