#!/usr/bin/env bash
set -euo pipefail

NAME=${REDIS_CONTAINER_NAME:-redis}
PORT=${REDIS_PORT:-6379}

# If the container exists…
if docker inspect "$NAME" >/dev/null 2>&1; then
  # …start it if not running
  if [ "$(docker inspect -f '{{.State.Running}}' "$NAME")" != "true" ]; then
    echo "Starting $NAME…"
    docker start "$NAME" >/dev/null
  fi
else
  # …or create a new one
  echo "Creating $NAME…"
  docker run -d --name "$NAME" -p ${PORT}:6379 -v redis-data:/data redis:7-alpine >/dev/null
fi

# Optional: wait until the port is open (no redis-cli needed)
for i in {1..30}; do
  (echo > /dev/tcp/127.0.0.1/${PORT}) >/dev/null 2>&1 && { echo "Redis ready on :${PORT}"; exit 0; }
  sleep 0.5
done

echo "Redis didn't become ready in time." >&2
exit 1
