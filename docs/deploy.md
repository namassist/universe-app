# Deploy on-premise

One host, Docker Compose, reached over plain HTTP at an IP address. Everything
the application needs runs here: the API, the web app, PostgreSQL, Redis, and a
reverse proxy in front of all of it.

## What this gets you, and what it does not

**One origin.** Caddy listens on port 80 and decides what is behind each path:
`/v1/*`, `/health` and `/openapi*` go to the API, everything else to the web
app. Only that one port is published; PostgreSQL and Redis are reachable from
inside the compose network and nowhere else.

Single-origin is not cosmetic. It means there is no CORS allowlist to keep in
step with the server's address, session cookies need no `SameSite` exception,
and there is one firewall rule instead of two.

**No TLS.** This was a deliberate choice to get running, and it has a cost you
should be able to state out loud: at login, the password crosses the network in
clear text, and a session cookie can be copied off the wire and replayed by
anyone on the same network. That is survivable on a closed LAN with a handful
of known accounts. It is not survivable once real payroll-adjacent accounts
exist. See "Opening the installation to the internet" near the end. It adds
HTTPS on the LAN and the way in from outside together.

## Before you start

On the server:

- Linux with Docker Engine 24+ and the Compose plugin (`docker compose
version` must work — the old `docker-compose` binary is not enough).
- A fixed IPv4 address. DHCP is fine only with a reservation: the address is
  baked into the web bundle, so a changed lease breaks every request in a way
  that looks like the app is down rather than misconfigured.
- Port 80 free — or pick another with `HTTP_PORT`. Check before you start:

  ```sh
  ss -ltn '( sport = :80 )'
  ```

  If something already answers there, set `HTTP_PORT` **and** put the same port
  in `PUBLIC_ORIGIN`. Those two are easy to change independently and doing so
  is silent: the site loads on the new port and every request fails, because
  the bundle was built pointing at the old one.

- ~20 GB disk.
- **Memory: 4 GB comfortably, 2 GB with swap.** The peak is `next build`, not
  the running application — the build alone wants upwards of 2 GB, and when it
  cannot get it the OOM killer takes it and Docker reports a bare
  `exit code 137` with no explanation. On a small host, add swap before the
  first build:

  ```sh
  sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
  sudo mkswap /swapfile && sudo swapon /swapfile
  echo "/swapfile none swap sw 0 0" | sudo tee -a /etc/fstab   # survive reboot
  ```

  Swap is the right tool here rather than a workaround: the demand is a short
  spike during a build, which is exactly what it is for. If the host is too
  small even for that, build the images on a larger machine and move them over
  with `docker save` / `docker load`.

## 1. Get the code onto the server

```sh
git clone <your-remote> universe-app
cd universe-app/deploy
cp .env.example .env
```

## 2. Fill in `.env`

Every blank in `.env.example` has to be filled. Two of them are worth care:

```sh
openssl rand -base64 24   # POSTGRES_PASSWORD
openssl rand -base64 24   # REDIS_PASSWORD
```

`PUBLIC_ORIGIN` is the address people will type, with the scheme and **no
trailing slash** — for example `http://192.168.1.50`. If you changed
`HTTP_PORT`, include the port: `http://192.168.1.50:8080`.

`SUPERADMIN_PASSWORD` must be at least `PASSWORD_MIN_LENGTH` characters (8 by
default). The bootstrap refuses to create a superadmin weaker than the policy
that account enforces on everyone else.

`ATTENDANCE_SOURCE_URL` and `FTW_SOURCE_URL` point at the two external
databases. Both are opened strictly read-only — every session sets
`default_transaction_read_only` — but they still belong in `.env` and nowhere
else. `.env` is git-ignored; keep it that way.

`ROSTER_SOURCE_URL` and `ROSTER_SOURCE_SC` are the third source, unggul_att,
reached over HTTP. The API **refuses to start** without them, deliberately: a
default would point the roster at another site's schedule, and a wrong roster
raises no error — its symptom is an operator who is never picked. Ask the
unggul_att administrators for the key, and do not copy it out of an API
collection into the repository. Only the standing key goes in `.env`; the JWT
it buys lives an hour and is fetched per run.

`OPS_PASSWORD_HASH` is optional and turns on the Operations Center at
`/ops` — a read-only monitoring page opened with one shared password rather
than an account. Leave it out and the page does not exist. To set it, build
first (step 3), then run `docker compose run --rm api bun run ops:hash`, type
the password, and paste the printed hash into `.env` **in single quotes**. The
hash is full of `$`, and unquoted Compose reads those as variables and mangles
it without a word — the symptom is a password that is never accepted.

Its login locks an address out after five wrong tries, which assumes Caddy
sees each client's real address. With Docker's userland proxy (rootless
Docker, Docker Desktop) every client can arrive as one gateway address, and
then one person's typos lock everyone out for fifteen minutes. After the
first login, check that the API log's `[ops] session opened from …` line
shows the browser's own address.

## 3. Build and start

```sh
docker compose build
docker compose up -d
```

The first build takes a while: two Bun images, a full dependency install, and a
Next.js production build. Afterwards Docker's layer cache makes rebuilds much
faster as long as `package.json` and `bun.lock` have not changed.

Startup order is enforced, not hoped for: `migrate` runs to completion before
the API starts, so the API never serves against a schema it does not expect.

## 4. Create the first account

```sh
docker compose run --rm api bun run db:bootstrap
```

This writes the six roles and their grants, the superadmin from `.env`, and the
two kiosks that have no admin UI. Nothing else.

**Do not run `db:seed` here.** That is the development seed: besides the roles
and the superadmin it inserts sample master data and an invented workforce, and
those fictional employees would then sit in the same register as your real
ones. `db:bootstrap` exists precisely so you never have to make that trade.

The bootstrap is idempotent — running it again reconciles the locked superadmin
role and leaves the editable roles as an administrator left them.

## 5. Check it

```sh
curl -s http://<server-ip>/health
docker compose ps
```

`/health` reports the database, Redis, and each upload directory as writable. A
directory reported unwritable means a volume did not mount, and it is much
better to learn that here than at the first photo upload.

Then open `http://<server-ip>` in a browser and log in as the superadmin.
**Change that password immediately** — it is sitting in a file on the server.

## Day-to-day

```sh
docker compose logs -f api           # follow the API
docker compose ps                    # what is up
docker compose restart api           # restart one service
docker compose down                  # stop everything (volumes survive)
```

### Deploying a new version

```sh
git pull
docker compose build
docker compose up -d
```

The proxy is a built image too (`deploy/caddy/`, Caddy plus its Cloudflare DNS
module), and its build fetches Go modules. On a network where that hangs, the
same remedy as for `bun install` below applies:
`docker build --network=host -t universe-proxy:latest deploy/caddy`. Built
once, it only needs rebuilding when `deploy/caddy/Dockerfile` changes. Until
the switch to HTTPS below, the proxy's 443 is bound to loopback only
(`127.0.0.1:8443`), so a host where something else owns 443 is unaffected.

`migrate` runs again automatically and applies anything new. If the release
changed `PUBLIC_ORIGIN`, the web image must be rebuilt — see the next section.

**A release can add a required variable, and the API will not start without
it.** `migrate` carries only `DATABASE_URL`, so migrations still run and the
failure surfaces one service later, as an API that restarts in a loop. Check
`docs/deploy.md` and `deploy/.env.example` against your own `.env` before
building — `git diff HEAD@{1} -- deploy/.env.example` names anything the
release added.

Two more things a release can ask for that a build does not supply:

- **Timeline stages.** A new scheduled action is code; the row that fires it is
  data, and `db:seed` does not run in production — so a release that adds an
  action leaves it unused until somebody adds the rows in the Timeline menu.
  `roster-ingest` needs one stage per shift, or the roster mirrors only when
  somebody presses Sync. `shift-start` needs one per shift too, but its absence
  is harmless rather than silent: the walls go on turning over at `ftw-ingest`,
  exactly as before the stage existed. Add it when you want the screens to
  change over at a different moment than the FTW pull begins.
- **The first roster pull's timing.** A month is taken over by the mirror only
  when the pull covers the whole of it, which is true for the current month
  only in its first eight days. Deploy later than that and the current month
  stays with whatever spreadsheet holds it; the mirror starts with the next
  one. Raising `ROSTER_SYNC_DAYS_BACK` for a single pull is the way round it.

### Uploading employee photos in bulk

The employee page uploads one photo at a time, which is right for a correction
and wrong for a new site arriving with a thousand portraits. `photos:upload`
sends a whole folder through the same endpoint the form uses, so the same rules
apply — scope, 5 MB ceiling, `.jpg` / `.jpeg` / `.png` / `.webp` only.

Each file is matched to a person by its own name: `504264267.jpg` is that NIK's
photo. Check the folder first, which sends nothing:

```sh
cd apps/api
API_URL=http://192.168.151.23:8081 bun run photos:upload -- /path/foto --dry-run
```

Then, with an account that can manage employees:

```sh
API_URL=http://192.168.151.23:8081 \
API_IDENTIFIER=superadmin@example.com API_PASSWORD='...' \
  bun run photos:upload -- /path/foto
```

The password comes from the environment because an argument would land in the
shell history and in `ps` for everyone else on the box. Failures are listed per
NIK at the end and re-running is safe: an upload replaces whatever the person
had, so fix the names and send only the folder that failed.

### Changing the address

`NEXT_PUBLIC_API_URL` is read at **build** time and baked into the browser
bundle; it cannot be supplied as a runtime variable. Changing where the server
answers therefore means a rebuild, not a restart:

```sh
# edit PUBLIC_ORIGIN in .env, then
docker compose build web
docker compose up -d web
```

A container started with the right value but built with the wrong one boots
perfectly and fails every request. If the app loads but nothing works, this is
the first thing to check.

### The other API address

`NEXT_PUBLIC_API_URL` is the address a **browser** uses. Server Components
render inside the `web` container, and from there that address means leaving for
the host's published port and coming back in through the proxy — a route the
compose network need not have. Server-side renders therefore use
`INTERNAL_API_URL` (`http://api:3001`), set on the `web` service. It is read at
runtime, so redirecting server-to-server traffic never requires rebuilding the
browser bundle.

The symptom when this is missing is specific and misleading: login succeeds —
the POST returns 200 and sets the cookie — and then the button sits on
"Checking..." forever, because the navigation to `/dashboard` issues an RSC
request whose server-side session read never completes. Nothing in the API log
looks wrong, because the API was never reached.

## Backups

The database and the uploaded files are separate, and a backup of one without
the other is not a backup. A photo lives on disk while the row that names it
lives in Postgres — restore only the database and every employee claims a photo
that cannot be served.

```sh
# database
docker compose exec -T db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
  | gzip > "backup-$(date +%F).sql.gz"

# uploads (sounds, photos, imports)
docker run --rm -v universe_apidata:/data -v "$PWD:/out" alpine \
  tar czf "/out/uploads-$(date +%F).tar.gz" -C /data .
```

Take both in the same run, keep them together, and restore them together.

## What plain HTTP costs the card scanner

**Scan ID Card cannot use a phone camera over plain HTTP.** Browsers refuse
`getUserMedia` outside a secure origin, and no application change can lift
that: Chrome on Android can be told to trust one origin per device, and Safari
cannot be told at all. The screen detects this and says so, and its manual NIK
field works regardless — a QR reader typing the number into it is a complete
workaround at a desk.

Serving the domain over HTTPS (_Opening the installation to the internet_,
below) is what makes the camera work. Nothing in the application changes.

## Opening the installation to the internet

Owner's decision (2026-10-17, `docs/prd.md` → _Network: reaching the API from
a phone_): everything is reachable from outside the site, so the mobile app
works off site and the installation can be watched from home. The way in is a
**Cloudflare Tunnel** to a domain: the server opens an outbound connection,
the site opens no port and publishes no address. On site, **split DNS** keeps
the same domain on the LAN, so walls and booths never depend on the site's
internet uplink.

```
off site:  phone ── https ── Cloudflare ── tunnel ── cloudflared ── proxy:8080 ─┐
on site:   PC/TV ── https (split DNS → server's LAN IP) ──────────── proxy:443 ─┴─ api / web
```

Both arrive at Caddy (`deploy/Caddyfile`), and each listener writes the
client's real address into `X-Forwarded-For`: the LAN listener the peer, the
tunnel listener Cloudflare's `CF-Connecting-IP`. The API keys three things on
that address: the login lockouts, the first-login rule (below), and the
integration allow-list. A request reaching `:8080` without `CF-Connecting-IP`
is refused, and `:8080` is never published on the host.

**What the application enforces once outsiders can reach it:**

- **Login is throttled.** 10 failed attempts per address per 15 minutes,
  everywhere, and 10 per account per 15 minutes from outside the site. A
  successful login costs nothing, so many people behind one public address
  can all log in. An account worn out from outside still logs in on site.
  The price, accepted: whoever knows a NIK can keep that person's off-site
  login refused, 15 minutes at a time. NIKs are printed on ID cards.
- **A first login happens on site.** An account still on the issued password,
  after provisioning or after an administrator's reset, is refused from
  outside with "Login pertama harus dari jaringan site", and login creates no
  account from outside. "The site" is `SITE_NETWORKS`, by default the private
  ranges and loopback.

### Before the switch

Pick an hour outside both musters: every TV is re-paired at the new address.

1. **The domain is on Cloudflare** (its nameservers point there).
2. **Port 443 on the server is free for Caddy:** `ss -ltn '( sport = :443 )'`.
   It must be the real 443, not another port. The LAN and the tunnel have to
   be one origin, and Cloudflare serves the domain on 443.
3. **Caddy sees each LAN client's own address.** From two PCs on site, open
   the app, then compare `docker compose logs proxy`: each request shows its
   PC's address. If both show one `172.x` address, Docker is masking sources
   (userland proxy, rootless Docker), every PC on site shares one login
   budget, and nothing on site reads as the site. Fix Docker first.
4. **Strong passwords.** Change the superadmin's password (`/change-password`), and set a
   new `OPS_PASSWORD_HASH` (`bun run ops:hash`) if the Operations Center is
   on. Both were chosen for a closed LAN. The integration tokens are random
   and need nothing.
5. **Tell people.** Accounts that have never logged in, and accounts reset
   by an administrator, can only make their first login on site.

### In the Cloudflare dashboard

1. **API token** (My Profile → API Tokens): template _Edit zone DNS_,
   restricted to this one zone. It goes in `CLOUDFLARE_API_TOKEN`; Caddy uses
   it only to prove it owns the domain for the certificate.
2. **Tunnel** (Zero Trust → Networks → Tunnels → Create, type _Cloudflared_).
   Copy its token into `TUNNEL_TOKEN`. Add a **public hostname**: the domain,
   service `HTTP`, URL `proxy:8080`.
3. **SSL/TLS → Edge Certificates:** _Always Use HTTPS_ on. The tunnel listener
   tells the app the browser used HTTPS, which is only true with this on.
4. **Security → WAF → Rate limiting rules:** one rule for
   `URI Path equals /v1/auth/login` (and `/v1/ops/session`, the Operations Center's), 20 requests per
   minute per IP, action _Block_ for 10 minutes. It drops a flood at the edge
   before it costs the server an argon2 verify per request.

### On the site network

**Split DNS:** in the DNS server the site's machines use (the router, or the
office domain controller), add an A record for the domain pointing at the
server's LAN address. Check from a PC on site: `nslookup <domain>` answers the
LAN address. Off site, it answers Cloudflare. Without this, every screen on
site goes out to the internet and back, and the walls go dark when the
uplink does.

### On the server

In `deploy/.env`:

```sh
PUBLIC_ORIGIN=https://universe.example.co.id
SITE_ADDRESS=universe.example.co.id
SITE_TLS=cloudflare
COOKIE_SECURE=true
HTTPS_PORT=443
CLOUDFLARE_API_TOKEN=...
TUNNEL_TOKEN=...
# SITE_NETWORKS=192.168.0.0/16   # only if the default private ranges are wrong
```

Then rebuild the web bundle (it carries `PUBLIC_ORIGIN`) and the proxy, and
start with the tunnel:

```sh
docker build --network=host -t universe-proxy:latest deploy/caddy
docker build --network=host -f apps/web/Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL=https://universe.example.co.id \
  -t universe-web:latest .
cd deploy && docker compose --profile tunnel up -d
```

`COOKIE_SECURE=true` goes with `SITE_TLS=cloudflare` and never before it: a
browser silently discards a `Secure` cookie sent over plain HTTP, and login
then fails with no error message anywhere. That is why the flag is explicit
configuration instead of something derived from `NODE_ENV`.

### Check it

- `docker compose logs proxy | grep -i certificate` shows the certificate
  obtained. The first one can take a minute.
- On site, `https://<domain>` opens with a valid padlock, and login works.
- Off site, on mobile data, the same. Then log into the Operations Center
  from each: the API log's `[ops] session opened from …` line shows the LAN
  address on site and your public address off site. If it shows one fixed
  `172.x` address for both, the forwarded address is not getting through,
  and the lockouts would lock everybody out at once. Stop and fix that first.
- An account still on the issued password is refused off site and accepted
  on site.
- **Re-pair every TV** at `https://<domain>`. The old `http://<IP>` address no
  longer answers, and a TV's pairing belonged to that origin. An old TV
  browser that does not trust Let's Encrypt's root shows a certificate
  error; that box needs a newer browser.

### Going back

Set `SITE_ADDRESS`, `SITE_TLS` and `COOKIE_SECURE` back (or delete them),
`PUBLIC_ORIGIN` back to the `http://` address, rebuild the web image, and
`docker compose up -d` without the profile. Then
`docker compose stop tunnel`, or delete the tunnel in the dashboard.

## If `bun install` hangs during the build

Seen on a developer machine, not expected on a Linux server, but the symptom is
distinctive enough to name: the build sits at `Resolving dependencies` and
eventually times out. It means the build container cannot reach the npm
registry — most often because DNS returns only IPv6 addresses for it while
Docker's bridge network has no IPv6 route.

Confirm it in one command:

```sh
docker run --rm oven/bun:1.3.14 bun -e \
  'try{const r=await fetch("https://registry.npmjs.org/bun",{signal:AbortSignal.timeout(20000)});console.log("OK",r.status)}catch(e){console.log("FAIL",String(e))}'
```

If that fails, build with the host's network instead — it affects only the
`RUN` steps, not how the containers run afterwards:

```sh
docker compose build --build-arg BUILDKIT_INLINE_CACHE=1
# or, per image:
docker build --network=host -f apps/api/Dockerfile -t universe-api:latest .
```

The durable fix is on the Docker daemon (enable IPv6, or set a DNS server that
returns A records), not in this repository.

## Known sharp edges

- **`TZ` is not optional.** Shift boundaries, roster dates and every scheduler
  stage are compared against the container's local clock, which defaults to UTC.
  Leave it unset on a WITA site and the wall shows the wrong shift for eight
  hours of every day, and the stages that generate boards fire at the wrong
  hour — neither of which reports an error, because nothing is malformed. It is
  set on `api` and `web` from `TZ` in `.env`.

- **Redis holds the sessions.** It has a password here, but it is still a
  single point of failure: flush it and everyone is logged out. That is
  recoverable — people log in again — but do not point another project at the
  same instance.
- **`SEED_FRESH=1` empties the workforce.** It refuses to run with
  `NODE_ENV=production`, which `.env.example` sets. Leave it set.
- **`next build` and the dev server do not mix.** Irrelevant on the server, but
  on a developer's machine never run a build while `bun run dev` is running —
  it corrupts `apps/web/.next` and every route starts returning 500.
