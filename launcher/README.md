# Punch-Drunk launcher (fork of POW: Recompiled!! Launcher)

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

1. Checks the build tools. On Linux (git, .NET 8 SDK, cmake, ninja, clang) it shows the install command for your
   distribution; the Windows and Steam Deck versions set up their own.
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

Windows, Linux and Steam Deck. Packaging: `npm run dist` (Linux AppImage), `bash steamdeck/make_steamdeck_appimage.sh`
(Steam Deck AppImage; its build tools are downloaded on the Deck by `scripts/setup_steamdeck_tools.sh`),
`npm run dist:win` (the portable Windows zip, `packaging/build_release.js`). Portable on Windows: settings.json, data and temp beside the exe, nothing in AppData;
build tools get a home inside data for their caches. The Windows download carries a build kit (`packaging/fetch_buildkit.js`
makes it: Git, WiiCompiled's source, the compiler, CMake, Ninja, the libraries, and the translator already built from that
source plus `port/punchout_region.patch`), so setup needs no internet and the .NET SDK is never shipped (Microsoft's terms don't
allow it). A build unpacks what it needs into the data folder and removes it afterwards. `scripts/build_port.ps1` runs it all
(through WiiCompiled's own pinned Windows scripts for the compiler, CMake and Ninja). Microsoft's Visual C++ runtime isn't
shipped either (its license doesn't allow that): if Windows lacks it, the launcher downloads Microsoft's own installer from
Microsoft and runs it, with Windows' permission prompt, before the game starts.

## Changing the icon

`build/icon.svg` is the drawing. `npx electron packaging/render_icon.js` makes `build/icon.png` (the packaged app's
icon) and `src/assets/icon.png` (the window's) from it.
