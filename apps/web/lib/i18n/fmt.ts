/**
 * Fill the `{name}` slots of a dictionary sentence.
 *
 * For sentences that carry values in the middle: Indonesian and English put
 * them in different places, so the sentence is one entry per language rather
 * than fragments glued around the numbers. A slot with no value is left as
 * written — a visible `{n}` on screen beats a silent "undefined".
 */
export function fmt(
  template: string,
  values: Record<string, string | number>
): string {
  return template.replace(/\{(\w+)\}/g, (slot, name: string) =>
    name in values ? String(values[name]) : slot
  );
}
