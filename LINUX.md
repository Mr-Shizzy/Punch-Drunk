# Linux and Steam Deck (experimental)

These were only tested in WSL (Ubuntu 24.04 on Windows). Nobody has played on a real Linux PC or Steam Deck yet, and
Doc Louis's hasn't been built on Linux. Please report what happens.

Both AppImages keep everything beside themselves, so give each its own folder and make it executable
(`chmod +x Punch-Drunk.AppImage`).

Unlike the Windows version, the first build needs internet: it downloads WiiCompiled and its libraries while building
(the Windows download carries them). The build files are removed again afterwards. The update notice is only a link to
the download page; replace the AppImage by hand.

## Steam Deck

Use `Punch-Drunk-SteamDeck.AppImage` in Desktop Mode. Nothing needs installing: setup downloads the build tools
(about 550 MB, Ubuntu's from Ubuntu and .NET from Microsoft) into the launcher's own folder. SteamOS isn't changed,
and the tools are removed after a build, so a later rebuild downloads them again.

## Linux

Use `Punch-Drunk.AppImage`. The build needs some packages first. On Ubuntu or Debian:

```
sudo apt install git cmake ninja-build clang lld llvm make pkg-config curl libfuse2t64 libicu74 libx11-dev libxext-dev libxrandr-dev libxcursor-dev libxfixes-dev libxi-dev libxss-dev libxtst-dev libxinerama-dev libxkbcommon-dev libwayland-dev wayland-protocols libdecor-0-dev libegl-dev libgl-dev libgles-dev libdrm-dev libgbm-dev libvulkan-dev libpulse-dev libpipewire-0.3-dev libasound2-dev libudev-dev libdbus-1-dev
curl -sSL https://dot.net/v1/dotnet-install.sh | bash -s -- --channel 8.0
```

The second line installs a recent .NET, because Ubuntu's own is too old.
