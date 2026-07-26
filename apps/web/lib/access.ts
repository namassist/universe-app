/**
 * Re-export of the shared access vocabulary.
 *
 * The role → menu matrix used to live here as a static constant. It is now
 * database rows seeded from `openspec/changes/add-auth-rbac`, resolved per
 * session and handed to the shell through `RoleProvider`. What remains shared
 * with the API is the menu list itself, the two access modes, and the three
 * scopes — all of which live in `@universe/contracts` so the database, the API
 * and the client cannot drift apart.
 *
 * Kept as a module so the many `@/lib/access` imports across the app keep
 * resolving.
 */

export {
  ACCESS_MODES,
  isMenuSlug,
  MENU_LABELS,
  MENU_SLUGS,
  SCOPES,
  type AccessMode,
  type EffectivePermissions,
  type MenuSlug,
  type Scope,
} from "@universe/contracts";
