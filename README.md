100% coded with AI. Extensive testing by me.

# POW: Recompiled!!

### A Punch-Out!! and Doc Louis's Punch-Out!! PC recompilation

**POW** stands for **P**unch-**O**ut!! **W**ii. A fan-made PC port of **Punch-Out!!** (Wii, 2009) and **Doc Louis's
Punch-Out!!** (WiiWare, 2009), built with the [WiiCompiled](https://github.com/patchzyy/wiicompiled) static
recompiler. Play with a controller or the keyboard, at any resolution, with built-in
[Archipelago](https://archipelago.gg) multiworld support (Punch-Out!!).

> **Not affiliated with or endorsed by Nintendo.** This is a non-commercial fan project. Punch-Out!! and Nintendo are
> trademarks of Nintendo; the games and their content are © Nintendo.

**Bring your own copy.** Nothing from the games is included here or in the downloads. The launcher builds the port on
your computer from your own copy of Punch-Out!! (USA) and, if you have it, Doc Louis's Punch-Out!! (USA).

*This project was called Re-Punched!! before version 0.3.1. The new launcher keeps your saves, settings and build
folder from the old one; it just asks you to update the build once.*

## Download

Get the launcher from the [latest release](https://gitlab.com/fist-in/POW-Recompiled/-/releases/permalink/latest):

| Your computer | Download |
| --- | --- |
| Linux (x86-64) | `POW-Recompiled-Launcher.AppImage` |
| Steam Deck (SteamOS) | `POW-Recompiled-Launcher-SteamDeck.AppImage` |
| Windows 10/11 (x64) | `POW-Recompiled-Launcher-Setup.exe` |

They're listed under **Packages** on the release. The Steam Deck launcher is the Linux one with its own build tools
inside, so it's a bigger download, but SteamOS needs nothing installed.

## Play

1. Open the launcher.
   - Linux and Steam Deck: make the AppImage executable, then run it (on the Steam Deck, in Desktop Mode).
   - Windows: run the installer. Windows may say "Windows protected your PC" because the installer isn't
     code-signed; click **More info**, then **Run anyway**.
2. Follow the three setup steps: get the build tools (Linux: install the packages it lists; Windows: press
   **Download build tools**; Steam Deck: they come with the launcher), choose your disc (ISO, WBFS or RVZ), and press
   **Build**. The first build takes a while; after that it's just **Play**.
3. Doc Louis's Punch-Out!!: pick its tile at the top of the launcher, press **Choose WAD…** and pick your WAD. To
   unpack it, the launcher needs the Wii common key from your own console: choose the `keys.bin` from your BootMii
   backup, or paste the key. It's used once to unpack the WAD and is never saved, and none is included with the
   launcher. Then **Build** and **Play**, like Punch-Out!!. Both games use the same controls and settings.

You need: a clean (unpatched) Punch-Out!! (USA) disc image made from your own disc, about 10 GB of free space for the build (more on
Windows, where the compiler is downloaded too), and 64-bit Linux, SteamOS or Windows 10/11. For Doc Louis's
Punch-Out!!: a WAD of your own copy (USA, WPCE01), your console's Wii common key, and about as much space again.

## Features

- Controller or keyboard: WASD or the arrows to move, J and K to punch, L or Space for the star punch, Enter to pause.
  In menus, J chooses, K goes back, and Q and E turn pages (a controller's bumpers); the mouse works too (left click
  chooses, right click goes back). Change any key or button on the launcher's Controls page or in the game (F10 →
  Controller settings). The game's button prompts show your own keys or buttons, Xbox or PlayStation style. With
  several controllers, pick player 1's on the Controls page.
- Graphics: any render resolution, 16:9 or 4:3, windowed or fullscreen (launcher Settings, or F10 in the game). On
  weaker hardware, **Effects at native resolution** renders the game's screen effects at the Wii's resolution.
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

Punch-Out!! is © Nintendo. POW: Recompiled!! is a fan project, not affiliated with or endorsed by Nintendo.
