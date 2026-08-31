import { queryOptions } from "@tanstack/react-query";

import { api, API_URL, unwrap } from "@/lib/api";

/**
 * The fleet TV's own feed: the Actual board of whichever shift is running.
 *
 * A minute, not the fingerprint wall's thirty seconds — the board is written
 * once at `spare-validate` and afterwards only moves when a supervisor
 * corrects a slot, so a faster poll would re-read the same rows all shift. It
 * is still frequent enough that a correction reaches the yard while the person
 * who made it is still standing at the screen, and that the turn from day to
 * night lands within a minute of its gate.
 *
 * `retry: false` for the same reason as the other kiosks: an unpaired screen
 * gets a 401 no second attempt will change, and the poll underneath recovers
 * on its own once contact returns.
 */
export const FLEET_DISPLAY_POLL_MS = 60_000;

export const fleetDisplayKey = (deviceId?: string) =>
  ["fleet-display", deviceId ?? null] as const;

/**
 * `deviceId` is how a browser previews one particular TV — it answers with
 * that screen's formations and dwell instead of the site-wide defaults, so
 * what the preview shows is what the wall will show. A paired TV never sends
 * it: the API answers a device as itself and ignores the parameter, which is
 * what stops one kiosk reading another's wall.
 */
export const fleetDisplayQueryOptions = (deviceId?: string) =>
  queryOptions({
    queryKey: fleetDisplayKey(deviceId),
    queryFn: () =>
      unwrap(
        api.v1["fleet-allocation"].actual.display.get(
          deviceId ? { query: { device: deviceId } } : undefined
        )
      ),
    refetchInterval: FLEET_DISPLAY_POLL_MS,
    refetchIntervalInBackground: true,
    retry: false,
  });

export type FleetDisplay = Awaited<
  ReturnType<
    NonNullable<ReturnType<typeof fleetDisplayQueryOptions>["queryFn"]>
  >
>;

export type FleetDisplayFleet = FleetDisplay["fleets"][number];
export type FleetDisplayUnit = FleetDisplayFleet["units"][number];

/**
 * Where the wall fetches one operator's photograph, or null when they have no
 * photo on file and the card falls back to their initials.
 *
 * Its own endpoint rather than `/employees/:nik/photo`: a paired TV holds no
 * grant on the employee register, and this one serves only the faces that are
 * on the board it is showing. A plain URL for an `<img>` so the browser caches
 * and streams it, with the stored file name as the cache-buster — a wall that
 * has been running for a month must pick up a replaced photo without being
 * restarted.
 */
export function fleetPhotoUrl(unit: {
  employeeNik: string | null;
  employeePhotoFile: string | null;
}): string | null {
  if (!unit.employeeNik || !unit.employeePhotoFile) return null;
  const nik = encodeURIComponent(unit.employeeNik);
  return `${API_URL}/v1/fleet-allocation/actual/display/photo/${nik}?v=${unit.employeePhotoFile}`;
}
