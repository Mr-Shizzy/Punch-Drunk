# What this fork changes

Punch-Drunk is a fork of [POW: Recompiled](https://gitlab.com/fist-in/POW-Recompiled). The game itself is the original project's work. This fork is about three things: **easier setup**, **fully portable**, and **a few quality-of-life improvements**.

You bring your own copies of the games. No game files are included.

## Easier setup

- **Doc Louis's Punch-Out!! installs straight from your own WAD file.** No Dolphin or any other emulator is needed. The launcher unpacks the WAD itself.
  - It needs the Wii common key from your own console (the `keys.bin` from a BootMii backup, or the key pasted in). The launcher uses it once and never saves it.
- **Punch-Out!! installs from your own disc image**, the same two-step setup.
- **One launcher for both games.** Set up, play and settings are all in one program.
- **"Update game" button.** When a newer version of the game is waiting, the card's button says so. One click rebuilds it.
- **Builds work on external drives** that don't keep file owners (such as exFAT SSDs).
- **The Visual C++ runtime is included**, so nothing needs installing first. If Windows has a newer copy, that one is used.

## Fully portable

- It's a zip: unzip it and run it. There is no installer.
- Everything the program makes (settings, the games it builds, logs, temp files) stays in its own folder. Nothing goes in AppData or the registry.
- You can move the folder to another drive and it keeps working (tested by moving it to an external SSD).

## Quality of life

- **Escape opens the Exit box with the mouse free**, so you can click Quit. Enter also confirms.
- **Show frame rate** switch in Settings (off by default).
- **Anti-aliasing** setting: Off or 4×.
- **Clearer resolution labels:** each choice shows its pixel height (Native 480p, 720p, 960p, 1440p, 1920p, 2880p, 3840p), plus a line spelling out the exact size.
- **Lock aspect ratio is on by default** for new setups. On larger or wider monitors the picture keeps its aspect ratio, with black bars on each side, instead of stretching. You can turn it off in Settings. (It doesn't add extra scenery on the sides.)
- **Cheats** for Punch-Out!! (Settings > Cheats, all off by default): Invincible Little Mac, Unlimited stars, and Unlock all fighters. They switch themselves off while Archipelago is on. Unlock all fighters changes your save for good, so the launcher makes a backup copy first.
- **Archipelago** now has a short explanation in Settings. It's optional and only for people joining a randomizer group.

## Look

- A new look called **Punch-Drunk**, with its own name and icon.
- **Home screen:** two full-height panels, one per game, with each game's own logo and a still from its videos.
  - These pictures are made on your own computer from your own copy of the games the first time you run the launcher. They are never included in the download and never uploaded anywhere.
  - Without your game files the panels are plain dark with the game's name.

## Not changed

- The fight HUD stays where the original game puts it in 16:9. The original game does the same.
- Frame interpolation was looked at and left out (it needs a display faster than 60 Hz to be worth it).

## What has been tested

All of the above works on the author's own Windows PC. Not tested: other graphics cards, other Windows versions, and the Linux/Steam Deck builds of the launcher.
