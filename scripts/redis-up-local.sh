#!/usr/bin/env bash
set -euo pipefail

HOST=${REDIS_HOST:-127.0.0.1}
PORT=${REDIS_PORT:-6379}
PASS=${REDIS_PASSWORD:-}      # if you set requirepass in redis.conf, export this

_ping() {
  if [ -n "$PASS" ]; then
    redis-cli -h "$HOST" -p "$PORT" -a "$PASS" ping >/dev/null 2>&1
  else
    redis-cli -h "$HOST" -p "$PORT" ping >/dev/null 2>&1
  fi
}

if _ping; then
  echo "Redis already running on $HOST:$PORT"
  exit 0
fi

if systemctl list-unit-files | grep -q '^redis-server.service'; then
  echo "Starting redis-server via systemd…"
  sudo systemctl start redis-server
  sleep 0.3
  if _ping; then exit 0; fi
fi

echo "Starting standalone redis-server…"
# Respect config if present; otherwise default
CONF=/etc/redis/redis.conf
if [ -f "$CONF" ]; then
  redis-server "$CONF" --daemonize yes
else
  redis-server --port "$PORT" --daemonize yes
fi

# Wait for ready
for i in {1..20}; do
  if _ping; then exit 0; fi
  sleep 0.2
done

echo "Redis failed to start" >&2
exit 1
