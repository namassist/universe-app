# Caddy with the Cloudflare DNS module, so it can prove it owns the domain
# through a DNS record rather than through an inbound port the site does not
# open. That is what lets the LAN be served HTTPS on the public name while the
# only way in from the internet is the tunnel (docs/deploy.md, "Opening the
# installation to the internet").
#
# Versions pinned: a proxy that rebuilds into a different Caddy is a change
# nobody reviewed.
FROM caddy:2.10.2-builder AS build
RUN xcaddy build --with github.com/caddy-dns/cloudflare@v0.2.4

FROM caddy:2.10.2-alpine
COPY --from=build /usr/bin/caddy /usr/bin/caddy
