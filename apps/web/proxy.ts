import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "universe_session";
const DEVICE_COOKIE = "universe_device";

/**
 * A cheap presence check, and nothing more.
 *
 * This is user experience, not the security boundary (design D10): it does not
 * talk to Postgres, it does not validate the session, and a forged cookie
 * defeats it. That is fine, because it buys a redirect instead of a flash of
 * empty shell — and everything behind it re-checks. Real authorization happens
 * twice, in `(app)/layout.tsx` and independently in every API route through
 * the auth macro.
 *
 * Do not add authorization logic here. Proxy runs on every request and cannot
 * see the caller's permissions without a round trip that would put a database
 * read in front of every navigation.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  /*
   * A kiosk has two legitimate kinds of viewer, so it accepts two credentials.
   *
   * A wall-mounted TV logs in as nobody: it carries the device cookie a
   * pairing link minted, and that is the only thing it will ever have. A
   * person checking the same wall from their desk carries a session instead.
   * Admitting only the device cookie turned every such visit into a redirect
   * to a login page that could not help — signing in produced a session, and
   * a session was precisely what this branch refused.
   *
   * `/display/` with the slash, not `/display` as a prefix: the shell's own
   * `display-attendance` and `display-fleet` pages start with the same eight
   * characters, and treating them as kiosks locks admins out of two menus.
   */
  const paired =
    pathname.startsWith("/display/") && request.cookies.has(DEVICE_COOKIE);
  if (paired || request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  if (pathname !== "/") url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    /*
     * Everything except the auth pages, Next's own assets, and static files.
     * The negative lookahead is what keeps the login page reachable without a
     * session — matching it would redirect it to itself.
     *
     * `sounds` used to be listed here for `public/sounds/*.wav`. Those are gone:
     * audio is uploaded now and served by the API out of `SOUND_DIR`, a path
     * this matcher never governed. Keeping the exclusion would advertise an
     * unauthenticated route that no longer exists.
     */
    "/((?!login|change-password|_next/static|_next/image|favicon.ico|icon1.png|icon2.png|apple-icon.png|logoV1.svg|android-chrome).*)",
  ],
};
