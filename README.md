# Punch-Drunk: Punch-Out (Wii) Recomp

A portable Windows launcher for **Punch-Out!!** (Wii, 2009) and **Doc Louis's Punch-Out!!** (WiiWare, 2009) on PC.

This is a fork of [POW: Recompiled](https://gitlab.com/fist-in/POW-Recompiled) by fist-in. The original author did great
work on the port itself, but the install process could be troublesome. This fork makes it a simple unzip-and-run
program, adds a few cheats, and fixes building and loading from external SSDs.

> **Unofficial fan project. Not affiliated with or endorsed by Nintendo.** It includes no game files. You bring your own
> disc image and WAD. Punch-Out!! and Doc Louis's Punch-Out!! are © Nintendo.

![Home screen](docs/screenshots/home.png)

## What's different from the original

- **Portable.** Unzip it and run it. No installer. Everything stays in its own folder.
- **Easier setup.** One launcher for both games. Doc Louis's installs straight from your own WAD file, with no emulator.
  The build tools are fetched for you, and the Visual C++ runtime is included.
- **Works on external drives**, including exFAT SSDs.
- **Cheats** (all off by default): Invincible Little Mac, Unlimited stars, Unlock all fighters, Unlock the gallery.
- **Small extras:** anti-aliasing, clearer resolution labels, aspect ratio locked by default, a frame-rate switch,
  and Escape opens the Exit box.

The full list is in [FORK_CHANGES.md](FORK_CHANGES.md).

![Settings](docs/screenshots/settings.png)

## How to use it

1. Download the zip from [Releases](../../releases/latest) and unzip it to a folder with a plain path (letters,
   numbers, spaces), for example `C:\Games\Punch-Drunk`.
2. Run `Punch-Drunk.exe`.
3. Press **Set up** on a game, pick your disc image (Punch-Out!!) or your WAD (Doc Louis's), and let it build. The first
   build takes a while and needs about 10 GB of free space. After that it's just **Play**.

Doc Louis's needs the Wii common key from your own console (the `keys.bin` from a BootMii backup, or paste the key).
It is used once to unpack the WAD and is never saved.

Controls: arrow keys or WASD to move, J and K to punch, L or Space for the star punch, Enter to pause. Controllers work
too, and everything can be changed in the launcher.

## Status

- Tested only on the author's own Windows 11 PC. Other graphics cards and Windows versions are untested.
- The program is not code-signed, so Windows SmartScreen or your antivirus may warn the first time you run it.
- The two unlock cheats change your save file for good. The launcher makes a backup copy first.
- The Linux and Steam Deck parts of the original launcher are still in the source, but they are untested here and
  not part of the release.

## Credits

- [POW: Recompiled](https://gitlab.com/fist-in/POW-Recompiled) by fist-in: the port, the launcher and the Archipelago support.
- [WiiCompiled](https://github.com/patchzyy/wiicompiled), the recompiler the port is built on.
- SMS Launcher by Chase Myers, the launcher's starting point. Controller glyphs by Arks (CC BY 4.0). Open Sans (SIL OFL).
  nod by Luke Street. Full list in `THIRD_PARTY_NOTICES.txt`.
- Built with help from Claude (Anthropic); designed and tested by Mr-Shizzy.

## License

Copyright (C) 2026 Mr-Shizzy for the changes in this fork. GPL-3.0, see [LICENSE](LICENSE). The original launcher code
stays under its MIT license, see [launcher/LICENSE](launcher/LICENSE).
