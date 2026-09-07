/**
 * The application version, from `apps/web/package.json` by way of
 * `next.config.ts` — one source, so the footer cannot disagree with the
 * manifest. Raising it is a deliberate edit to that one field.
 *
 * The fallback is not decoration: `env` is inlined at build time, so a bundle
 * built by some other path than `next build` would otherwise print
 * "vundefined" on the login page.
 */
export const APP_VERSION = `v${process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0"}`;
