import { queryOptions } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api";

export type RosterCorrectionFilters = {
  q?: string;
  /** `YYYY-MM-DD`, inclusive. */
  from?: string;
  to?: string;
};

/** The prefix every list key shares, for invalidating after a write. */
export const rosterCorrectionsRoot = ["roster-corrections"] as const;

export const rosterCorrectionsKey = (filters: RosterCorrectionFilters = {}) =>
  [...rosterCorrectionsRoot, filters] as const;

export const rosterCorrectionsQueryOptions = (
  filters: RosterCorrectionFilters = {}
) =>
  queryOptions({
    queryKey: rosterCorrectionsKey(filters),
    queryFn: () =>
      unwrap(
        api.v1["roster-corrections"].get({
          query: {
            ...(filters.q ? { q: filters.q } : {}),
            ...(filters.from ? { from: filters.from } : {}),
            ...(filters.to ? { to: filters.to } : {}),
          },
        })
      ),
  });

export type RosterCorrectionRow = Awaited<
  ReturnType<
    NonNullable<ReturnType<typeof rosterCorrectionsQueryOptions>["queryFn"]>
  >
>[number];

/**
 * People a correction may name, with what their day reads now.
 *
 * Not the employee register: Manpower corrects the roster without holding
 * that menu, and the form needs the day's code, which the register does not
 * carry.
 */
export const rosterCorrectionPeople = (q: string, date: string) =>
  unwrap(api.v1["roster-corrections"].people.get({ query: { q, date } }));

export type RosterCorrectionPerson = Awaited<
  ReturnType<typeof rosterCorrectionPeople>
>[number];
