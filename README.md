100% coded with AI. Extensive testing by me.

# Fist-In!!

### A Punch-Out!! (Wii, 2009) PC recompilation

A fan-made PC port of **Punch-Out!!** (Wii, 2009), built with the [WiiCompiled](https://github.com/patchzyy/wiicompiled) static
recompiler. Play with a controller, at any resolution, with built-in [Archipelago](https://archipelago.gg) multiworld
support.

> **Not affiliated with or endorsed by Nintendo.** This is a non-commercial fan project. Punch-Out!! and Nintendo are
> trademarks of Nintendo; the game and its content are © Nintendo.

**Bring your own disc.** Nothing from the game is included here or in the downloads. The launcher builds the port on
your computer from your own copy of Punch-Out!! (USA).

## Download

Get the launcher from the [latest release](../../releases/latest):

| Your computer | Download |
| --- | --- |
| Linux (x86-64) | `Fist-In-Launcher.AppImage` |
| Windows 10/11 (x64) | `Fist-In-Launcher-Setup.exe` |

## Play

1. Open the launcher.
   - Linux: make the AppImage executable, then run it.
   - Windows: run the installer. Windows may say "Windows protected your PC" because the installer isn't
     code-signed; click **More info**, then **Run anyway**.
2. Follow the three setup steps: get the build tools (Linux: install the packages it lists; Windows: press
   **Download build tools**), choose your disc (ISO, WBFS or RVZ), and press **Build**. The first build takes a while;
   after that it's just **Play**.

You need: a clean (unpatched) Punch-Out!! (USA) disc image made from your own disc, about 10 GB of free space for the build (more on
Windows, where the compiler is downloaded too), and 64-bit Linux or Windows 10/11.

## Features

- Controller support (Xbox and PlayStation button prompts), full D-pad menu navigation, keyboard and mouse.
- Graphics: any render resolution, 16:9 or 4:3, windowed or fullscreen (launcher Settings, or F10 in the game).
- Difficulty modes: Hard (no restarting or quitting mid-fight) and Insane (one knockdown and you're out).
- Archipelago: connect from the launcher or in the game (F10). Items, traps, death link and the in-game message panel
  are built in; no separate client needed. Generate with the Punch-Out Wii apworld (released separately), version
  1.6.1 or newer; older versions work too if you choose the seed's .appunchout file in the launcher's Archipelago page.

## What's in this repository

| Folder | What it is | License |
| --- | --- | --- |
| `launcher/` | The launcher (Electron) | MIT |
| `port/` | The changes to WiiCompiled for Punch-Out!! (`punchout_region.patch`) and the translator project (`projects/punchout`) | GPL-3.0 (as WiiCompiled) |

To run the launcher from source: `cd launcher && npm install && npm start`. To build the Linux AppImage: `npm run dist`;
the Windows installer: `npm run dist:win` (works on Linux too).

## Credits

WiiCompiled (GPL-3.0); SMS Launcher by Chase Myers (MIT), this launcher's starting point; controller glyphs by Arks
(@ScissorMarks), CC BY 4.0; Open Sans (SIL OFL 1.1); nod by Luke Street (MIT/Apache-2.0); nlohmann/json (MIT);
Archipelago.

Punch-Out!! is © Nintendo. Fist-In!! is a fan project, not affiliated with or endorsed by Nintendo.
