/**
 * What is left of the display sample data: the fleet picks the Display admin
 * screen still offers.
 *
 * Everything else that lived here — running texts, sounds, the timeline, and
 * the display registry — is persisted now and read from the API. `RunningText`,
 * `SoundClip`, and `TimelineStage` are the API's row types; `TimelineAction`,
 * `RUNTEXT_COLORS`, and `COLOR_VAL` moved to `@universe/contracts` so the
 * database, the API schema, and the client cannot drift apart.
 *
 * Fleet picks stay here because fleets themselves are not persisted yet: they
 * are `fleet-setting`'s own sample records, and wiring the picker before the
 * thing it picks from would be wiring it to nothing.
 */

export type FleetPick = { id: string; digger: string; unitCount: number };

export const FLEETS: FleetPick[] = [
  { id: "fl1", digger: "EX-22", unitCount: 6 },
  { id: "fl2", digger: "EX-07", unitCount: 5 },
  { id: "fl3", digger: "PC-11", unitCount: 4 },
  { id: "fl4", digger: "WA-03", unitCount: 3 },
];
