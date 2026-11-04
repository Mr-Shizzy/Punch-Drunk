100% coded with AI. Extensive testing by me.

# Re-Punched!!

### A Punch-Out!! (Wii, 2009) PC recompilation

A fan-made PC port of **Punch-Out!!** (Wii, 2009) and **Doc Louis's Punch-Out!!** (WiiWare, 2009), built with the
[WiiCompiled](https://github.com/patchzyy/wiicompiled) static recompiler. Play with a controller or the keyboard, at any
resolution, with built-in [Archipelago](https://archipelago.gg) multiworld support (Punch-Out!!).

> **Not affiliated with or endorsed by Nintendo.** This is a non-commercial fan project. Punch-Out!! and Nintendo are
> trademarks of Nintendo; the games and their content are © Nintendo.

**Bring your own copy.** Nothing from the games is included here or in the downloads. The launcher builds the port on
your computer from your own copy of Punch-Out!! (USA) and, if you have it, Doc Louis's Punch-Out!! (USA).

## Download

Get the launcher from the [latest release](https://gitlab.com/fist-in/Re-Punched/-/releases/permalink/latest):

| Your computer | Download (all parts) | You get |
| --- | --- | --- |
| Linux (x86-64) | `Re-Punched-Launcher.7z.001`, `Re-Punched-Launcher.7z.002` | `Re-Punched-Launcher.AppImage` |
| Windows 10/11 (x64) | `Re-Punched-Launcher-Setup.7z.001`, `Re-Punched-Launcher-Setup.7z.002` | `Re-Punched-Launcher-Setup.exe` |

**Each download comes in two parts**, because the release page limits each file to 100 MB. To put them back
together:

1. Download **both** parts for your system into the same folder.
2. Extract the `.001` part. Your archive app reads the `.002` part by itself.
   - Linux: open it with Ark, File Roller or PeaZip, or in a terminal run `7z x Re-Punched-Launcher.7z.001` (from the
     `7zip` or `p7zip` package).
   - Windows: install [7-Zip](https://www.7-zip.org/), right-click `Re-Punched-Launcher-Setup.7z.001` and choose
     **7-Zip → Extract Here**. Windows' built-in extractor can't join split archives.
3. You get the launcher file shown in the table. You can delete the parts afterwards.

If a part is missing or only partly downloaded, the archive app reports an error. Download that part again.

## Play

1. Open the launcher.
   - Linux: make the AppImage executable, then run it.
   - Windows: run the installer. Windows may say "Windows protected your PC" because the installer isn't
     code-signed; click **More info**, then **Run anyway**.
2. Follow the three setup steps: get the build tools (Linux: install the packages it lists; Windows: press
   **Download build tools**), choose your disc (ISO, WBFS or RVZ), and press **Build**. The first build takes a while;
   after that it's just **Play**.
3. Doc Louis's Punch-Out!!: pick its tile at the top of the launcher. Install your copy in
   [Dolphin](https://dolphin-emu.org) first (**Tools → Install WAD…**); the launcher finds it there (the normal and
   Flatpak Dolphin on Linux, Dolphin on Windows) or you choose Dolphin's Wii folder. Then **Build** and **Play**,
   like Punch-Out!!. Both games use the same controls and settings.

You need: a clean (unpatched) Punch-Out!! (USA) disc image made from your own disc, about 10 GB of free space for the build (more on
Windows, where the compiler is downloaded too), and 64-bit Linux or Windows 10/11. For Doc Louis's Punch-Out!!: your
copy (USA, WPCE01) installed in Dolphin, and about as much space again.

## Features

- Controller or keyboard: WASD or the arrows to move, J and K to punch, L or Space for the star punch, Enter to pause.
  In menus, J chooses, K goes back, and Q and E turn pages (a controller's bumpers); the mouse works too (left click
  chooses, right click goes back). Change any key or button on the launcher's Controls page or in the game (F10 →
  Controller settings). The game's button prompts show your own keys or buttons, Xbox or PlayStation style.
- Graphics: any render resolution, 16:9 or 4:3, windowed or fullscreen (launcher Settings, or F10 in the game).
- Difficulty modes (Punch-Out!!): Hard (no restarting or quitting mid-fight) and Insane (one knockdown and you're out).
- Doc Louis's Punch-Out!!: the whole game, at a steady 60 fps, with the same controls, D-pad menus and settings.
- Archipelago: connect from the launcher or in the game (F10). Items, traps, death link and the in-game message panel
  are built in; no separate client needed. Generate with the [Punch-Out Wii apworld](https://gitlab.com/fist-in/punchout-apworld), version
  1.6.1 or newer; older versions work too if you choose the seed's .appunchout file in the launcher's Archipelago page.

## What's in this repository

| Folder | What it is | License |
| --- | --- | --- |
| `launcher/` | The launcher (Electron) | MIT |
| `port/` | The changes to WiiCompiled for both games (`punchout_region.patch`) and the translator projects (`projects/punchout`, `projects/doclouis`) | GPL-3.0 (as WiiCompiled) |

To run the launcher from source: `cd launcher && npm install && npm start`. To build the Linux AppImage: `npm run dist`;
the Windows installer: `npm run dist:win` (works on Linux too).

## Credits

WiiCompiled (GPL-3.0); SMS Launcher by Chase Myers (MIT), this launcher's starting point; controller glyphs by Arks
(@ScissorMarks), CC BY 4.0; Open Sans (SIL OFL 1.1); nod by Luke Street (MIT/Apache-2.0); nlohmann/json (MIT);
Archipelago.

Punch-Out!! is © Nintendo. Re-Punched!! is a fan project, not affiliated with or endorsed by Nintendo.
