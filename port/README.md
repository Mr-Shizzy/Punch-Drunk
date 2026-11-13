# port/

- `punchout_region.patch`: every change to WiiCompiled (base commit `0d5c402`) that makes Punch-Out!! (USA, R7PE01)
  and Doc Louis's Punch-Out!! (USA, WPCE01) run: the region support, hooks, menus, controller prompts, difficulty
  modes, the Archipelago client, and Doc Louis's channel title support (its contents served through ES) and
  scheduler fix. Applied by `launcher/scripts/build_port.sh` for either game.
- `projects/punchout/recomp.yml`, `MAP.txt`: Punch-Out!!'s translator project (memory layout, entry point, the
  game's function start addresses).
- `projects/doclouis/recomp.yml`, `MAP.txt`: Doc Louis's (its game code is the title's content 1).

No game code or data: the build reads the game code and files from the player's own extracted disc, or for Doc
Louis's from their own WAD, unpacked by the launcher.
Licensed GPL-3.0, like WiiCompiled (see LICENSE).
