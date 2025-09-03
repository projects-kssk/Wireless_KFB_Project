#!/usr/bin/env bash
set -euo pipefail

# Update or install the Wireless KFB AppImage system-wide.
#
# Usage examples:
#   scripts/update-appimage.sh --from-dist            # pick newest ./dist/*.AppImage
#   scripts/update-appimage.sh ./dist/Wireless\ KFB-1.0.1-arm64.AppImage
#   scripts/update-appimage.sh --appdir /opt/WirelessKFB --keep 3
#
# What it does:
# - Ensures /opt/WirelessKFB exists
# - Copies the AppImage there (versioned filename)
# - Makes it executable
# - Creates stable symlinks:
#     /opt/WirelessKFB/WirelessKFB.AppImage  (no space)
#     /opt/WirelessKFB/Wireless KFB.AppImage (with space)
# - Creates/updates a global launcher symlink: /usr/local/bin/wirelesskfb
# - Optionally updates /usr/share/applications/wirelesskfb.desktop to use the launcher symlink
# - Prunes older versions beyond --keep (default 3)

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "[update-appimage] Re-running with sudo..." >&2
  exec sudo -E bash "$0" "$@"
fi

APPDIR="/opt/WirelessKFB"
KEEP=3
SRC=""
FROM_DIST=0
UPDATE_DESKTOP=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --appdir)
      APPDIR="$2"; shift 2;;
    --keep)
      KEEP="$2"; shift 2;;
    --from-dist)
      FROM_DIST=1; shift;;
    --no-desktop)
      UPDATE_DESKTOP=0; shift;;
    -h|--help)
      echo "Usage: $0 [--from-dist | <path-to-AppImage>] [--appdir /opt/WirelessKFB] [--keep N] [--no-desktop]";
      exit 0;;
    *)
      SRC="$1"; shift;;
  esac
done

if [[ $FROM_DIST -eq 1 && -z "$SRC" ]]; then
  if ls dist/*.AppImage >/dev/null 2>&1; then
    SRC=$(ls -1t dist/*.AppImage | head -n1)
  else
    echo "[update-appimage] No AppImage found under ./dist" >&2
    exit 1
  fi
fi

if [[ -z "$SRC" ]]; then
  echo "[update-appimage] Provide an AppImage path or use --from-dist" >&2
  exit 1
fi

if [[ ! -f "$SRC" ]]; then
  echo "[update-appimage] File not found: $SRC" >&2
  exit 1
fi

mkdir -p "$APPDIR"

BASENAME=$(basename -- "$SRC")
TARGET="$APPDIR/$BASENAME"

echo "[update-appimage] Installing $SRC -> $TARGET"
install -m 0755 "$SRC" "$TARGET"

# Stable symlinks
STABLE_NO_SPACE="$APPDIR/WirelessKFB.AppImage"
STABLE_WITH_SPACE="$APPDIR/Wireless KFB.AppImage"
ln -sfn "$TARGET" "$STABLE_NO_SPACE"
ln -sfn "$TARGET" "$STABLE_WITH_SPACE"

# Global launcher
ln -sfn "$STABLE_NO_SPACE" /usr/local/bin/wirelesskfb
chmod 755 /usr/local/bin/wirelesskfb || true

# Optionally update desktop entry to use the stable launcher path
if [[ $UPDATE_DESKTOP -eq 1 && -f /usr/share/applications/wirelesskfb.desktop ]]; then
  echo "[update-appimage] Updating desktop entry Exec= to /usr/local/bin/wirelesskfb"
  sed -i -E 's|^Exec=.*$|Exec=/usr/local/bin/wirelesskfb|' /usr/share/applications/wirelesskfb.desktop || true
fi

# Prune old versions beyond KEEP
if [[ "$KEEP" =~ ^[0-9]+$ && "$KEEP" -ge 0 ]]; then
  mapfile -t FILES < <(ls -1t "$APPDIR"/*.AppImage 2>/dev/null || true)
  COUNT=${#FILES[@]}
  if [[ $COUNT -gt $KEEP ]]; then
    echo "[update-appimage] Pruning old versions, keeping $KEEP"
    for ((i=KEEP; i<COUNT; i++)); do
      f="${FILES[$i]}"
      if [[ -f "$f" && ! -L "$f" ]]; then
        echo "  removing $f"
        rm -f -- "$f" || true
      fi
    done
  fi
fi

echo "[update-appimage] Done. Launch via: wirelesskfb"

