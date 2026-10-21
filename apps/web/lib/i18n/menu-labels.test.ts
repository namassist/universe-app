import { describe, expect, test } from "bun:test";

import { MENU_LABELS, MENU_SLUGS } from "@universe/contracts";

import { en } from "./en";
import { id } from "./id";
import { menuLabel } from "./menu-labels";

describe("menuLabel", () => {
  /* The Indonesian name of every menu is the one the contracts have always
     given it — moving the label into the dictionary renames nothing. */
  test.each([...MENU_SLUGS])("%s reads as it did in Indonesian", (slug) => {
    expect(menuLabel(id, slug)).toBe(MENU_LABELS[slug]);
  });

  test("every menu has an English name", () => {
    for (const slug of MENU_SLUGS) expect(menuLabel(en, slug)).toBeTruthy();
  });
});
