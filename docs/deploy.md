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
exist. See "Adding TLS later" at the end — the change is small, and everything
here was built so it stays small.

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

`migrate` runs again automatically and applies anything new. If the release
changed `PUBLIC_ORIGIN`, the web image must be rebuilt — see the next section.

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

## Adding TLS later

Everything here was arranged so this stays a small change:

1. Give the server a hostname and a certificate — an internal CA is enough on a
   closed network, and Caddy will do Let's Encrypt on its own if the host is
   publicly resolvable.
2. In `deploy/Caddyfile`, replace `:80` with that hostname; Caddy handles the
   redirect and, for a public name, the certificate.
3. Set `COOKIE_SECURE=true` on the `api` service, and publish 443 as well as 80.
4. Update `PUBLIC_ORIGIN` to `https://…` and **rebuild the web image**.

Step 3 matters and is easy to get backwards: a browser silently discards a
`Secure` cookie sent over plain HTTP. Turning that flag on before TLS actually
terminates in front of the API breaks login with no error message anywhere —
which is why the flag is explicit configuration instead of something derived
from `NODE_ENV`.

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

- **Redis holds the sessions.** It has a password here, but it is still a
  single point of failure: flush it and everyone is logged out. That is
  recoverable — people log in again — but do not point another project at the
  same instance.
- **`SEED_FRESH=1` empties the workforce.** It refuses to run with
  `NODE_ENV=production`, which `.env.example` sets. Leave it set.
- **`next build` and the dev server do not mix.** Irrelevant on the server, but
  on a developer's machine never run a build while `bun run dev` is running —
  it corrupts `apps/web/.next` and every route starts returning 500.
