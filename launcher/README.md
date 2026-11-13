# POW: Recompiled!! Launcher

Not affiliated with or endorsed by Nintendo. Punch-Out!! is a trademark of Nintendo; the games are © Nintendo.

Sets up and plays POW: Recompiled!! (POW = Punch-Out!! Wii; formerly Re-Punched!!), the PC port of Punch-Out!! (Wii, USA) and Doc Louis's Punch-Out!! (WiiWare, USA). Bring
your own copies: the port is built on your computer from your own copies of the games; no game code or data is
included.

## Run (development)

    npm install
    npm start

The port's files (the WiiCompiled patch + the two games' projects) come from `../port` (the repository layout; packaged
into the AppImage), `../recomp_wip` (development), a folder chosen in Settings > Advanced, or `$PUNCHOUT_PORT_SOURCE`.

## What it does

1. Checks the build tools (git, .NET 8 SDK, cmake, ninja, clang) and shows the install command for your distribution.
2. Punch-Out!!: checks your disc with nodtool (downloaded and checksum-verified on first use) and extracts it; an
   already extracted disc folder (sys/main.dol + files/) works too.
   Doc Louis's Punch-Out!!: unpacks your WAD (`src/wad.js`) with the Wii common key you supply (your BootMii
   `keys.bin`, or pasted). The key is used for that one unpack, then wiped from memory; it is never saved or logged,
   and none ships with the launcher. Each content is checked against the title's own hashes (a wrong key fails
   there) and written into the launcher's folder. Tests: `npm test`.
3. Builds the chosen game with `scripts/build_port.sh` (WiiCompiled at a pinned commit + the patch; `PO_GAME`
   picks the game). Each game has its own build folders, so building one doesn't undo the other.
4. Play, Archipelago (server / slot / password; the logo lights up when the game is connected), Controls, Settings
   (difficulty, wrist-strap skip). Settings are written to Punch-Out!!'s `port/UserData/Config.toml`; Doc Louis's
   reads the shared ones (controls, mouse lock, graphics, sound, button prompts) from there. Difficulty and
   Archipelago are Punch-Out!!'s only.

Linux and Windows. Packaging: `npm run dist` (Linux AppImage), `npm run dist:win` (the portable Windows zip,
`packaging/build_release.js`). Portable on Windows: settings.json, data and temp beside the exe, nothing in AppData;
build tools get a home inside data for their caches. The launcher downloads its own Git (MinGit) and .NET 8 SDK into its tools folder, and
ships Microsoft's Visual C++ runtime DLLs (`packaging/fetch_vcruntime.js`, from Microsoft's signed redistributable):
before a game starts they go beside it only if Windows' own copy is missing or older, so nothing is installed. And `scripts/build_port.ps1` gets the compiler, CMake and
Ninja through WiiCompiled's own pinned Windows scripts.

## Changing the logo

The glove in the top left is `src/assets/logo.png` (drawn from `src/assets/logo.svg`). The window uses the same file,
and the AppImage's app icon is `build/icon.png` (512×512). To use your own logo, replace those two PNGs with square
images of the same names and rebuild the AppImage. Transparent backgrounds look best.
