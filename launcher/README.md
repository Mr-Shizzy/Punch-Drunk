# Fist-In!! Launcher

Not affiliated with or endorsed by Nintendo. Punch-Out!! is a trademark of Nintendo.

Sets up and plays Fist-In!!, the Punch-Out!! (Wii, USA) PC port. Bring your own disc: the port is built on your computer from
your own copy of the game; no game code or data is included.

## Run (development)

    npm install
    npm start

The port's files (the WiiCompiled patch + the Punch-Out!! project) come from `../port` (the repository layout; packaged
into the AppImage), `../recomp_wip` (development), a folder chosen in Settings > Advanced, or `$PUNCHOUT_PORT_SOURCE`.

## What it does

1. Checks the build tools (git, .NET 8 SDK, cmake, ninja, clang) and shows the install command for your distribution.
2. Checks your disc with nodtool (downloaded and checksum-verified on first use) and extracts it; an already extracted
   disc folder (sys/main.dol + files/) works too.
3. Builds the port with `scripts/build_port.sh` (WiiCompiled at a pinned commit + the Punch-Out!! patch).
4. Play, Archipelago (server / slot / password; the logo lights up when the game is connected), Controls, Settings
   (difficulty, wrist-strap skip). Settings are written to the port's own `UserData/Config.toml`.

Linux and Windows. Packaging: `npm run dist` (Linux AppImage), `npm run dist:win` (Windows installer; builds on
Linux too). On Windows the launcher downloads its own Git (MinGit) and .NET 8 SDK into its tools folder, offers
Microsoft's Visual C++ runtime installer if it's missing, and `scripts/build_port.ps1` gets the compiler, CMake and
Ninja through WiiCompiled's own pinned Windows scripts.

## Changing the logo

The glove in the top left is `src/assets/logo.png` (drawn from `src/assets/logo.svg`). The window uses the same file,
and the AppImage's app icon is `build/icon.png` (512×512). To use your own logo, replace those two PNGs with square
images of the same names and rebuild the AppImage. Transparent backgrounds look best.
