#!/usr/bin/env bash
# POW: Recompiled!! Steam Deck launcher: runs build_port.sh (its path is the first argument) inside the launcher's own
# build environment (PO_BUILDROOT: an Ubuntu 24.04 tree with the compiler, CMake, Ninja, Git and .NET 8, which the
# launcher sets up on this device) through bubblewrap. SteamOS needs nothing installed, and the game built there (against Ubuntu 24.04's
# glibc) runs on SteamOS itself. The build's folders (PO_WORK, PO_DATA, PO_PORT, PO_LOGS, PO_SRC, PO_SEED) and the
# home folder are the same paths inside as outside.
set -uo pipefail
: "${PO_BUILDROOT:?}" "${PO_SRC:?}" "${PO_WORK:?}" "${PO_DATA:?}" "${PO_PORT:?}" "${PO_LOGS:?}"
INNER=${1:?the path of build_port.sh}
ROOT=$PO_BUILDROOT
[[ -x "$ROOT/usr/bin/bash" ]] || { echo "BUILD FAILED: the build tools aren't set up ($ROOT)"; exit 1; }
mkdir -p "$PO_WORK" "$PO_PORT" "$PO_LOGS"

# bubblewrap: SteamOS's own (Flatpak uses it), or else the tree's, through the tree's own loader.
if command -v bwrap > /dev/null; then
    BWRAP=(bwrap)
else
    BWRAP=("$ROOT/usr/lib64/ld-linux-x86-64.so.2" --library-path "$ROOT/usr/lib/x86_64-linux-gnu" "$ROOT/usr/bin/bwrap")
fi

args=(--bind "$ROOT" / --dev /dev --proc /proc --ro-bind /sys /sys --tmpfs /tmp --tmpfs /var/tmp
      --ro-bind-try /etc/hosts /etc/hosts --share-net --die-with-parent)
resolv=$(realpath /etc/resolv.conf 2>/dev/null) && [[ -f $resolv ]] && args+=(--ro-bind "$resolv" /etc/resolv.conf)
args+=(--bind "$HOME" "$HOME")
# The build's folders outside the home folder (an SD card, the AppImage's own mount for PO_SRC and this script),
# including the launcher's temp folder and the build tools' own home: without the temp folder, .NET can't start a build.
for dir in "$PO_WORK" "$PO_DATA" "$PO_PORT" "$PO_LOGS" "${PO_SEED:-}" "${TMPDIR:-}" "${DOTNET_CLI_HOME:-}"; do
    [[ -n $dir && -d $dir && $dir != "$HOME"/* ]] && args+=(--bind "$dir" "$dir")
done
for dir in "$PO_SRC" "$(dirname "$INNER")"; do
    [[ -d $dir && $dir != "$HOME"/* ]] && args+=(--ro-bind "$dir" "$dir")
done
args+=(--unsetenv LD_LIBRARY_PATH --unsetenv LD_PRELOAD --unsetenv PYTHONHOME --unsetenv PYTHONPATH
       --setenv PATH /usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
       --setenv DOTNET_ROOT /opt/dotnet --setenv DOTNET_CLI_TELEMETRY_OPTOUT 1 --setenv DOTNET_NOLOGO 1
       --setenv HOME "$HOME" --chdir "$HOME")

exec "${BWRAP[@]}" "${args[@]}" /usr/bin/bash "$INNER"
