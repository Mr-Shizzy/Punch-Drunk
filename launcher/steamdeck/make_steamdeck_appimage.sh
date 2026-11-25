#!/usr/bin/env bash
# Builds dist/Punch-Drunk-SteamDeck.AppImage: the normal Linux launcher plus the two Steam Deck scripts. The build tools
# aren't in it: the Deck downloads them during setup (scripts/setup_steamdeck_tools.sh). Run on Linux (or WSL) with
# Node.js 22+ and `npm ci` already done:   bash steamdeck/make_steamdeck_appimage.sh
set -euo pipefail
cd "$(dirname "$0")/.."
node packaging/build_linux.js electron-builder.steamdeck.json
ls -la dist/Punch-Drunk-SteamDeck.AppImage
