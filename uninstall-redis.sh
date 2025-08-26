#!/usr/bin/env bash
set -euo pipefail
CONTAINER_NAME="${CONTAINER_NAME:-kfb-redis}"
REDIS_VOLUME="${REDIS_VOLUME:-kfb-redis-data}"
docker rm -f "${CONTAINER_NAME}" || true
docker volume rm "${REDIS_VOLUME}" || true
echo "🗑️  Removed ${CONTAINER_NAME} and volume ${REDIS_VOLUME}"
