/**
 * Principal identity and the shapes the auth endpoints exchange.
 *
 * A session id is opaque: it encodes no identity, role, permission, or scope.
 * Everything here is what the *server* answers when asked about a session, not
 * something a client can derive from the identifier it holds.
 */

import type { EffectivePermissions, Scope } from "./access";

/** The four kiosk kinds. Only `att` and `fleet` have an admin UI. */
export const DEVICE_KINDS = ["att", "fleet", "fitwork", "fingerprint"] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

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
