# The front proxy: stock Caddy with this deployment's routes baked in. See the
# `proxy` service in docker-compose.yml for why it is not a bind mount.
FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
