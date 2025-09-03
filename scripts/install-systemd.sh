#!/usr/bin/env bash
set -euo pipefail

# Minimal installer for the Wireless KFB Next.js server systemd unit
# Usage (run as root or with sudo):
#   sudo bash scripts/install-systemd.sh \
#     --workdir /opt/wireless-kfb \
#     --envfile /etc/wireless-kfb.env \
#     --user wirelesskfb \
#     --port 3000 \
#     --service wireless-kfb

WORKDIR=""
ENVFILE="/etc/wireless-kfb.env"
USER_NAME=""
PORT="3000"
SERVICE="wireless-kfb"
NODE_PATH="/usr/bin/node"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --workdir) WORKDIR="$2"; shift 2 ;;
    --envfile) ENVFILE="$2"; shift 2 ;;
    --user) USER_NAME="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --service) SERVICE="$2"; shift 2 ;;
    --node) NODE_PATH="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [[ -z "$WORKDIR" ]]; then
  echo "--workdir is required (path to repo on server)" >&2
  exit 2
fi

if [[ ! -x "$NODE_PATH" ]]; then
  echo "Node not found at $NODE_PATH. Pass --node \
$(command -v node >/dev/null 2>&1 && echo "$(command -v node)")" >&2
  exit 3
fi

UNIT_PATH="/etc/systemd/system/${SERVICE}.service"
echo "Installing systemd unit to $UNIT_PATH"

cat > "$UNIT_PATH" <<EOF
[Unit]
Description=Wireless KFB Next.js server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${WORKDIR}
ExecStart=${NODE_PATH} dist-server/server.js
Environment=PORT=${PORT}
Environment=NODE_ENV=production
EnvironmentFile=-${ENVFILE}
Restart=on-failure
RestartSec=2
$( [[ -n "$USER_NAME" ]] && echo "User=${USER_NAME}" )

[Install]
WantedBy=multi-user.target
EOF

echo "Reloading systemd daemon"
systemctl daemon-reload

echo "Enabling and starting ${SERVICE}"
systemctl enable --now "${SERVICE}"

echo "Done. Tail logs with: journalctl -u ${SERVICE} -f --no-pager"

