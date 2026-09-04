/**
 * Principal identity and the shapes the auth endpoints exchange.
 *
 * A session id is opaque: it encodes no identity, role, permission, or scope.
 * Everything here is what the *server* answers when asked about a session, not
 * something a client can derive from the identifier it holds.
 */

import type { EffectivePermissions, Scope } from "./access";

/**
 * The four kiosk kinds. Every one of them pairs the same way and has a
 * fullscreen screen; which admin page manages a kind's devices is a web
 * concern, registered per slug in `components/menus/registry.tsx`.
 */
export const DEVICE_KINDS = ["att", "fleet", "fitwork", "fingerprint"] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

/**
 * Where a paired device of each kind belongs.
 *
 * Shared rather than per-app: the API redirects here after consuming a pairing
 * link, and the web admin links here to preview a screen. Two copies of this
 * mapping drift the moment a route is renamed, and the drift is silent — the
 * link simply lands on a 404 nobody is watching, on a TV.
 */
export const DISPLAY_ROUTE_OF_KIND: Record<DeviceKind, string> = {
  att: "/display/attendance",
  fleet: "/display/fleet",
  fitwork: "/display/fitwork",
  fingerprint: "/display/fingerprint",
};

/**
 * The id prefix each kind's devices are numbered under (`DSP-P01`, …).
 *
 * A device id is operator-visible and typed on the device itself, so it is
 * assigned rather than generated. These are the prefixes already in use.
 */
export const DEVICE_ID_PREFIX: Record<DeviceKind, string> = {
  att: "DSP-A",
  fleet: "DSP-F",
  fitwork: "DSP-W",
  fingerprint: "DSP-P",
};

/**
 * How a fleet wall spends its screen.
 *
 * `slideshow` is the original bargain and stays the default: one formation
 * fills the screen, and the wall turns over to the next every `rotateSeconds`.
 * A card is as large as the screen allows, which is what makes a name readable
 * from the far side of a workshop.
 *
 * `monitor` trades that size for breadth: `MONITOR_FLEETS_PER_PAGE` formations
 * stand side by side, so a control room takes in four pits at a glance instead
 * of waiting out a cycle for the one it cares about. Neither layout caps how
 * many formations a screen may be given — a monitor holding more than one
 * page's worth rotates between pages exactly as a slideshow rotates between
 * fleets, and at the same dwell.
 */
export const DISPLAY_LAYOUTS = ["slideshow", "monitor"] as const;
export type DisplayLayout = (typeof DISPLAY_LAYOUTS)[number];

/**
 * How many formations a `monitor` screen shows at once.
 *
 * Four, because the grid it implies is 2x2: on the 1920x1080 canvas the walls
 * actually run at, that is ~950x480 a quadrant, which still fits a unit code
 * and a full name at a size worth mounting a television for. Six would fit
 * geometrically and be unreadable in the yard.
 *
 * A page size, not a ceiling. A screen given nine formations shows three
 * pages of four, four, and one.
 */
export const MONITOR_FLEETS_PER_PAGE = 4;

/**
 * The one screen that shows the support units, and nothing else.
 *
 * A reserved device rather than a formation somebody may pick alongside others
 * (owner, 2026-09-04). Support is not a pit: its machines are scattered across
 * the site, so putting them in a pit screen's rotation would mean a TV at one
 * panel cycling through dozers working somewhere else. It is its own wall, and
 * it exists whether or not anybody created it — the yard always has support
 * units, so a screen for them is part of the product rather than something to
 * set up.
 *
 * Fixed in every respect except its dwell: the name, the layout and what it
 * shows are all decided by what it *is*. `rotate_seconds` is the one honest
 * question, because how long a slide should hold depends on the room the
 * television is in.
 *
 * The id is reserved, so nothing else can take it: `devices.id` is the primary
 * key, which is what makes "there is exactly one of these" a fact the database
 * holds rather than a rule somebody maintains.
 */
export const SUPPORT_DEVICE_ID = "fleet-support";
export const SUPPORT_DEVICE_NAME = "Fleet Support";

/**
 * How many support units one slide carries.
 *
 * Six across in a single row (owner, 2026-09-04) — half the count of a
 * formation slide's widest row, because each of these cards carries two badges
 * a formation card does not: where the unit is working, and which vehicle
 * brings its crew. A support unit is scattered, so those two are the whole
 * reason somebody walks up to this screen.
 */
export const SUPPORT_SLIDE_SIZE = 6;

/** Which transport a login wants its session delivered over. */
export const SESSION_TRANSPORTS = ["cookie", "bearer"] as const;
export type SessionTransport = (typeof SESSION_TRANSPORTS)[number];

export type UserPrincipal = {
  kind: "user";
  id: string;
  name: string;
  email: string | null;
  nik: string | null;
  roleId: string;
  roleName: string;
  scope: Scope;
  mustChangePassword: boolean;
};

/** A device carries no role, no scope, and no NIK — it is not a user. */
export type DevicePrincipal = {
  kind: "device";
  id: string;
  name: string;
  deviceKind: DeviceKind;
};

export type SessionPrincipal = UserPrincipal | DevicePrincipal;

export type LoginRequest = {
  /** Email or NIK — resolved against email first, then NIK. */
  identifier: string;
  password: string;
  /** Omitted means cookie; a non-browser client asks for `bearer`. */
  transport?: SessionTransport;
};

export type LoginResponse = {
  principal: UserPrincipal;
  permissions: EffectivePermissions;
  /** Present only for `bearer` delivery; cookie logins never echo the id. */
  sessionId?: string;
};

export type SessionResponse = {
  principal: SessionPrincipal;
  /** Empty for devices: their authorization is fixed in code, not granted. */
  permissions: EffectivePermissions;
};

export type ChangePasswordRequest = {
  currentPassword: string;
  newPassword: string;
};

/**
 * The 403 an account gets on every route but logout/session/change-password
 * while `mustChangePassword` holds. Distinct from an ordinary permission
 * failure so the web shell can redirect instead of rendering not-found.
 */
export const PASSWORD_CHANGE_REQUIRED = "password_change_required" as const;
