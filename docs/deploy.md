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
docker compose up -d
```

`up -d` without a service name recreates the API too. The API reads the same
value as `CORS_ORIGINS`, and a TV's pairing link sends it on to the first of
those origins. With only `web` restarted, pairing lands on the old address.

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
6. **List everything that calls the old address.** The old `http://<IP>`
   stops serving the application (_Keeping the old address as a redirect_,
   below, softens that for people, not for programs):
   - **Integration clients.** Each one's base URL changes to the domain:
     ```sh
     docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
     select name, allowed_ips, last_used_at from integration_clients where revoked_at is null;
     SQL
     ```
     An allow-list holding a LAN address stops matching while site traffic
     still comes in through the tunnel (_On the site network_, below): the
     request then carries the site's public address.
   - **Monitors on the server itself**, such as a cron job that checks
     `/health` or logs in to read the Operations Center. Point them at
     `https://<domain>`, not `http://`: once `COOKIE_SECURE=true`, a session
     cookie is never sent back over plain HTTP. Then add
     `127.0.0.1 <domain>` to the server's `/etc/hosts`, so the check stays
     local instead of going out to Cloudflare and back.

### In the Cloudflare dashboard

Everything below except the tunnel itself belongs to the domain's zone.
Moving to another domain means doing each of these again on the new zone.

1. **API token** (My Profile → API Tokens → Create Token → _Create Custom
   Token_). Two permissions, both needed: **Zone → DNS → Edit** and **Zone →
   Zone → Read**. Limit _Zone Resources_ to this one zone. The _Edit zone
   DNS_ template gives only the first. Without the second, the Cloudflare
   module cannot look the zone up, and the certificate is never obtained.
   Leave _Client IP Address Filtering_ empty unless the server's public
   address is fixed. The token goes in `CLOUDFLARE_API_TOKEN`, and Caddy uses
   it only to prove it owns the domain. Check it from the server without
   leaving it in the shell history:
   ```sh
   read -rsp "Token: " CF; echo
   curl -s -H "Authorization: Bearer $CF" \
     "https://api.cloudflare.com/client/v4/zones?name=<domain>" \
     | grep -oE '"name":"<domain>"|"status":"active"|"success":(true|false)'
   unset CF
   ```
   It should print three lines: the zone's name, `"status":"active"` and
   `"success":true`.
2. **Tunnel** (Networks → Tunnels → _Create a tunnel_, type _Cloudflared_;
   older dashboards: Zero Trust → Networks → Tunnels). Copy the `eyJ…` token
   from the install command into `TUNNEL_TOKEN`. On the tunnel's **Routes**
   tab, _Add route → Published application_: the domain, service
   `http://proxy:8080`. If a DNS record for the domain already exists,
   Cloudflare will not replace it. A fresh domain often carries the
   registrar's parking `A` record. Delete it first, or turn it into a proxied
   `CNAME` to `<tunnel-id>.cfargotunnel.com`. Remove the route of any
   hostname you stop using: the tunnel listener does not check the host, so
   a leftover route would serve the application on an origin the API
   refuses.
3. **`www`, when the domain is the apex.** If `www` reaches the tunnel too,
   redirect it: Rules → Redirect Rules → template _Redirect from WWW to
   root_, 301, preserve the query string. Without the redirect, `www.` serves
   the application on an origin the API does not accept, and login fails.
4. **SSL/TLS → Edge Certificates:** _Always Use HTTPS_ on. The tunnel listener
   tells the app the browser used HTTPS, which is only true with this on.
5. **Rate limiting** (Security → Security rules → _Create rule_ → _Rate
   limiting rule_; older dashboards: Security → WAF). Use one rule for
   `URI Path is in {/v1/auth/login /v1/ops/session}`, counted per IP, 20
   requests per 10 seconds, action _Block_ for 10 seconds. The free plan
   offers only that period and duration. A paid plan can count per minute
   and block for longer. The rule drops a flood at the edge before each
   request costs the server an argon2 verify. Do not set it below 20: when
   site traffic comes in through the tunnel, every device behind one of the
   site's public addresses counts against one budget.

### On the site network

**Split DNS:** in the DNS server the site's machines use (the router, or the
office domain controller), add an A record for the domain pointing at the
server's LAN address. Check from a PC on site: `nslookup <domain>` answers the
LAN address. Off site, it answers Cloudflare. Without this, every screen on
site goes out to the internet and back, and the walls go dark when the
uplink does.

The server's certificate is valid on the LAN as well. Before the record
exists, check that the LAN path will work:
`curl --resolve <domain>:443:<server LAN IP> https://<domain>/health`
should answer `200`. A firewall between the client networks and the server
must allow 443, not only the old HTTP port.

**Before split DNS exists**, or for a device that brings its own DNS (a
phone with Android's _Private DNS_, a browser with DNS over HTTPS), site
traffic comes in through the tunnel. It then carries the address the site
goes out to the internet with, not a private one:

- **Add those addresses to `SITE_NETWORKS`**, or nobody on site can make a
  first login. Open `https://www.cloudflare.com/cdn-cgi/trace` once from
  each network (every Wi-Fi SSID, every wired segment) and read its `ip=`
  line. A site with several uplinks has several addresses. `SITE_NETWORKS`
  replaces the default rather than adding to it, so list the private ranges
  too:
  ```sh
  SITE_NETWORKS=10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,127.0.0.0/8,::1/128,fc00::/7,203.0.113.10/32,198.51.100.7/32
  ```
  List only addresses that are fixed and belong to the site alone. A
  carrier-grade NAT address is shared with strangers, and it would let them
  make first logins. Ask whoever runs the network, and ask about failover
  uplinks too.
- **Every device behind one address shares one login budget**: 10 failed
  attempts in 15 minutes, from anyone on that network, refuse login to all of
  them until the window passes. Split DNS ends this for the LAN. Phones that
  bypass it keep sharing.

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
# SITE_NETWORKS=...   # the site's public addresses until split DNS: see above
```

Paste the two tokens with an editor, not on a command line that the shell
history keeps. Then check that each key appears once. A second copy further
down the file is the one that counts:

```sh
for k in PUBLIC_ORIGIN SITE_ADDRESS SITE_TLS COOKIE_SECURE HTTPS_PORT SITE_NETWORKS CLOUDFLARE_API_TOKEN TUNNEL_TOKEN; do
  echo "$k: $(grep -c "^$k=" .env)x"
done
```

Then rebuild the web bundle, which carries `PUBLIC_ORIGIN`, and the proxy,
which carries the Cloudflare module. Start with the tunnel:

```sh
docker tag universe-web:latest universe-web:pre-domain   # for going back
docker compose build web proxy
docker compose --profile tunnel up -d
```

If the build hangs at `Resolving dependencies`, see _If `bun install` hangs_,
below.

`COOKIE_SECURE=true` goes with `SITE_TLS=cloudflare` and never before it: a
browser silently discards a `Secure` cookie sent over plain HTTP, and login
then fails with no error message anywhere. That is why the flag is explicit
configuration instead of something derived from `NODE_ENV`.

### Keeping the old address as a redirect

This step is optional. Bookmarks, TVs and scripts still open
`http://<IP>:<HTTP_PORT>`. Instead of leaving them to a dead address, move
Caddy's plain-HTTP port to loopback (`HTTP_PORT=127.0.0.1:18081`), since it
only redirects to HTTPS once the domain is served. Then let a web server on
the host answer the old port. With nginx:

```nginx
# /etc/nginx/sites-available/universe-old-address.conf, linked into sites-enabled
server {
    listen 8081 default_server;   # the old HTTP_PORT
    server_name _;
    return 302 https://<domain>$request_uri;
}
```

Enable it after `docker compose up -d` has released the port. Use 302 until
the switch has settled: a browser keeps a 301 even after going back. The
host's firewall applies to nginx, though it never applied to the port Docker
published, so open the port to the site's networks with
`sudo ufw allow from 192.168.0.0/16 to any port 8081 proto tcp`. The path is
kept, so an old wall link lands on the same wall. Programs are another
matter: many HTTP clients drop the `Authorization` header when they are
redirected to another host, so an integration still needs its base URL
changed.

### Check it

- `docker compose logs proxy | grep -i certificate` shows the certificate
  obtained. The first one can take a minute.
- From the server, both ways in answer:
  ```sh
  curl -s -o /dev/null -w 'local          %{http_code}\n' https://<domain>/health
  curl -s -o /dev/null -w 'via Cloudflare %{http_code}\n' \
    --resolve <domain>:443:$(dig +short @1.1.1.1 <domain> | head -1) https://<domain>/health
  docker compose logs --tail 20 tunnel | grep 'Registered tunnel connection'
  ```
  The first `curl` relies on the `/etc/hosts` entry from _Before the switch_.
  It verifies the certificate as well.
- On site, `https://<domain>` opens with a valid padlock, and login works.
- Off site, on mobile data, the same. Then log into the Operations Center
  from each: the API log's `[ops] session opened from …` line shows the LAN
  address on site and your public address off site. If it shows one fixed
  `172.x` address for both, the forwarded address is not getting through,
  and the lockouts would lock everybody out at once. Stop and fix that first.
- An account still on the issued password is refused off site and accepted
  on site.
- **Re-pair every TV** at `https://<domain>`. The old `http://<IP>` address no
  longer serves the application (at most it redirects), and a TV's pairing
  belonged to that origin. An old TV
  browser that does not trust Let's Encrypt's root shows a certificate
  error; that box needs a newer browser.

### Going back

Keep a copy of `.env` from before the switch (`cp .env .env.bak-pre-domain`).
Going back is then mostly undoing:

```sh
sudo rm /etc/nginx/sites-enabled/universe-old-address.conf   # if you made it
sudo systemctl reload nginx                                  # frees the old port first
docker compose stop tunnel
cp .env.bak-pre-domain .env
docker tag universe-web:pre-domain universe-web:latest       # the old bundle, no rebuild
docker compose up -d
sudo sed -i '/<domain>/d' /etc/hosts
```

Point any monitor you moved back at the old address too. The tunnel can stay
in the dashboard. With cloudflared stopped, the domain answers 530.

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
