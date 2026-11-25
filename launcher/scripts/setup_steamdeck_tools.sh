#!/usr/bin/env bash
# Punch-Drunk, Steam Deck: sets up the build tools on this device. SteamOS's system is read-only and has no build
# tools, so they go into a folder of their own: Ubuntu's official base system, the packages below from Ubuntu's own
# servers, and Microsoft's .NET SDK. None of it comes inside the Punch-Drunk download, and nothing in SteamOS changes.
# Ubuntu 24.04's glibc (2.39) is older than SteamOS's, so the game built there runs on SteamOS itself.
#
#   setup_steamdeck_tools.sh <empty folder> <ubuntu-base .tar.gz> <dotnet sdk .tar.gz>
# (The launcher downloads both archives and checks their checksums first.)
#
# No administrator password: "unshare" gives a private space in which this user counts as root, only there.
set -euo pipefail
ROOT=${1:?the folder to set the tools up in}
UBUNTU_BASE=${2:?the Ubuntu base archive}
DOTNET_SDK=${3:?the .NET SDK archive}

PACKAGES=(
    bash coreutils ca-certificates curl git xz-utils bubblewrap file
    clang lld llvm g++ libc6-dev cmake ninja-build make pkg-config python3
    libicu74 libssl3t64 zlib1g
    libx11-dev libxext-dev libxrandr-dev libxcursor-dev libxfixes-dev libxi-dev libxss-dev libxtst-dev
    libxinerama-dev libxkbcommon-dev libwayland-dev wayland-protocols libdecor-0-dev
    libegl-dev libgl-dev libgles-dev libdrm-dev libgbm-dev libvulkan-dev
    libpulse-dev libpipewire-0.3-dev libasound2-dev libudev-dev libdbus-1-dev
)

fail() { echo "SETUP FAILED: $*"; exit 1; }
for tool in unshare mount chroot tar readlink; do
    command -v "$tool" > /dev/null || fail "this system has no '$tool' command"
done
unshare --user --map-root-user true 2> /dev/null || fail "this system doesn't allow private user spaces"

# Stopping the launcher stops whatever is running inside too.
job=
trap '[[ -n $job ]] && kill -KILL "$job" 2> /dev/null; exit 130' INT TERM

# Runs a command inside the tools folder. The mounts are private to it and disappear when it ends.
inside() {
    unshare --user --map-root-user --mount --pid --fork --kill-child bash -c '
        set -e; R=$1; shift
        mount --rbind /dev "$R/dev"
        mount -t proc proc "$R/proc"
        mount --rbind /sys "$R/sys"
        mount -t tmpfs tmpfs "$R/tmp"
        mount --bind "$(readlink -f /etc/resolv.conf)" "$R/etc/resolv.conf"
        exec chroot "$R" /usr/bin/env -i HOME=/root TERM=dumb LANG=C.UTF-8 DEBIAN_FRONTEND=noninteractive \
            PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin "$@"
    ' _ "$ROOT" "$@" &
    job=$!
    local status=0
    wait "$job" || status=$?
    job=
    return "$status"
}
# APT can't switch to its own download user in there, so it stays the one user there is.
apt() { inside apt-get -o APT::Sandbox::User=root -o Acquire::Retries=3 "$@"; }

echo "@@STEP Unpacking Ubuntu"
tar -xzf "$UBUNTU_BASE" -C "$ROOT" --no-same-owner --exclude='./dev/*' --exclude='dev/*' || fail "couldn't unpack Ubuntu"
mkdir -p "$ROOT/dev" "$ROOT/proc" "$ROOT/sys" "$ROOT/tmp"
rm -f "$ROOT/etc/resolv.conf"
: > "$ROOT/etc/resolv.conf"   # the system's own DNS settings are laid over this while it runs

echo "@@STEP Asking Ubuntu's servers what's current"
apt update || fail "couldn't reach Ubuntu's servers"
# apt-get update only warns when a server can't be reached.
inside bash -c 'compgen -G "/var/lib/apt/lists/*noble*Packages*" > /dev/null' || fail "couldn't reach Ubuntu's servers"

echo "@@STEP Downloading the build tools from Ubuntu"
apt install -y --no-install-recommends "${PACKAGES[@]}" || fail "couldn't install the build tools"
apt clean
inside bash -c 'rm -rf /var/lib/apt/lists/*'

echo "@@STEP Adding .NET from Microsoft"
mkdir -p "$ROOT/opt/dotnet" "$ROOT/usr/local/bin"
tar -xzf "$DOTNET_SDK" -C "$ROOT/opt/dotnet" --no-same-owner || fail "couldn't unpack .NET"
ln -sf /opt/dotnet/dotnet "$ROOT/usr/local/bin/dotnet"
# The build binds home folders and SD cards over these.
mkdir -p "$ROOT/home" "$ROOT/run/media" "$ROOT/media" "$ROOT/mnt"

echo "@@STEP Checking the build tools"
inside bash -c 'set -e; clang --version; cmake --version; ninja --version; git --version; ld.lld --version
    DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1 DOTNET_ROOT=/opt/dotnet dotnet --list-sdks' || fail "the build tools don't run"
echo "SETUP OK"
