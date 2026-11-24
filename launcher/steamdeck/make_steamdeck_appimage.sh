#!/usr/bin/env bash
# Builds dist/Punch-Drunk-SteamDeck.AppImage: the normal Linux launcher plus its own build tools (an Ubuntu 24.04 tree,
# resources/buildroot.tar.xz) so SteamOS needs nothing installed. Run on Linux (or WSL) with podman or docker,
# Node.js 22+ and `npm ci` already done:   bash steamdeck/make_steamdeck_appimage.sh
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=build-steamdeck
mkdir -p "$OUT"

if command -v podman > /dev/null; then ENGINE=podman; elif command -v docker > /dev/null; then ENGINE=docker
else echo "Needs podman or docker."; exit 1; fi

IMAGE=punchdrunk-buildroot
"$ENGINE" build -t "$IMAGE" -f steamdeck/Containerfile steamdeck
id=$("$ENGINE" create "$IMAGE" /bin/true)
trap '"$ENGINE" rm -f "$id" > /dev/null 2>&1 || true' EXIT
"$ENGINE" export "$id" | xz -T0 -6 > "$OUT/buildroot.tar.xz"
# The launcher unpacks the tree again only when this changes.
printf '%s-%s\n' "$(sha256sum steamdeck/Containerfile | cut -c1-12)" "$(date +%Y%m%d)" > "$OUT/buildroot.version"

npx electron-builder --config electron-builder.steamdeck.json --linux AppImage
ls -la dist/Punch-Drunk-SteamDeck.AppImage
