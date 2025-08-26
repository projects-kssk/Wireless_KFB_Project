#!/usr/bin/env bash
set -euo pipefail

# --- Config ---------------------------------------------------------------
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTAINER_NAME="${CONTAINER_NAME:-kfb-redis}"
REDIS_IMAGE="${REDIS_IMAGE:-redis/redis-stack-server:latest}"  # has ReJSON
REDIS_PORT_HOST="${REDIS_PORT_HOST:-6379}"
REDIS_PORT_CONT="${REDIS_PORT_CONT:-6379}"
REDIS_VOLUME="${REDIS_VOLUME:-kfb-redis-data}"
ENV_FILE="${ENV_FILE:-.env.local}"
REDIS_URL="${REDIS_URL:-redis://127.0.0.1:${REDIS_PORT_HOST}}"
NODE_REQUIRED_MAJOR=20

# --- Helpers --------------------------------------------------------------
need() { command -v "$1" >/dev/null 2>&1; }

ensure_pkg() {
  if need apt-get; then
    sudo apt-get update -y
    sudo apt-get install -y "$@"
  elif need dnf; then
    sudo dnf install -y "$@"
  elif need yum; then
    sudo yum install -y "$@"
  else
    echo "⚠️  Install the following manually: $*"; return 1
  fi
}

ensure_docker() {
  if need docker; then return 0; fi
  echo "🐳 Installing Docker (community distro package)…"
  if need apt-get; then
    ensure_pkg apt-transport-https ca-certificates curl gnupg lsb-release
    curl -fsSL https://get.docker.com | sh
  else
    echo "⚠️  Docker not found. Please install Docker, then re-run."; exit 1
  fi
  sudo usermod -aG docker "$USER" || true
}

ensure_node() {
  if need node; then
    local vmajor
    vmajor=$(node -v | sed -E 's/^v([0-9]+).*/\1/')
    if [[ "${vmajor}" -ge "${NODE_REQUIRED_MAJOR}" ]]; then return 0; fi
    echo "🔁 Updating Node to >= ${NODE_REQUIRED_MAJOR}…"
  else
    echo "⬇️  Installing Node ${NODE_REQUIRED_MAJOR} LTS…"
  fi

  if need apt-get; then
    # NodeSource LTS
    curl -fsSL https://deb.nodesource.com/setup_${NODE_REQUIRED_MAJOR}.x | sudo -E bash -
    sudo apt-get install -y nodejs
  else
    echo "⚠️  Install Node ${NODE_REQUIRED_MAJOR}+ manually, then re-run."; exit 1
  fi
}

ensure_env_line() {
  local key="$1" value="$2" file="$3"
  touch "$file"
  if grep -qE "^${key}=" "$file"; then
    sed -i.bak -E "s|^${key}=.*$|${key}=${value}|" "$file"
  else
    echo "${key}=${value}" >> "$file"
  fi
}

start_redis_container() {
  if docker ps -a --format '{{.Names}}' | grep -qx "${CONTAINER_NAME}"; then
    echo "♻️  Container ${CONTAINER_NAME} already exists. Ensuring it's running…"
    docker start "${CONTAINER_NAME}" >/dev/null || true
  else
    echo "🚀 Starting Redis (${REDIS_IMAGE}) on port ${REDIS_PORT_HOST}…"
    docker run -d \
      --name "${CONTAINER_NAME}" \
      --restart unless-stopped \
      -p "${REDIS_PORT_HOST}:${REDIS_PORT_CONT}" \
      -v "${REDIS_VOLUME}:/data" \
      "${REDIS_IMAGE}"
  fi
}

# --- Run -------------------------------------------------------------------
cd "$APP_DIR"

echo "==> Step 1: prerequisites"
ensure_pkg curl ca-certificates git
ensure_docker
start_redis_container

echo "==> Step 2: Node & npm"
ensure_node
echo "Node: $(node -v)"
echo "npm:  $(npm -v)"

echo "==> Step 3: project deps"
# prefer clean install if package-lock.json exists
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi

echo "==> Step 4: environment"
ensure_env_line "REDIS_URL" "${REDIS_URL}" "${ENV_FILE}"
echo "Wrote ${ENV_FILE}: REDIS_URL=${REDIS_URL}"

echo
echo "✅ All set."
echo "Redis container: ${CONTAINER_NAME}  (port ${REDIS_PORT_HOST})"
echo "Manage it with:"
echo "  docker logs -f ${CONTAINER_NAME}"
echo "  docker stop ${CONTAINER_NAME} && docker start ${CONTAINER_NAME}"
echo
echo "Next steps:"
echo "  npm run dev   # start server/next/electron in dev mode"
echo "  npm start     # electron (after building your app as needed)"
