# port/

- `punchout_region.patch`: every change to WiiCompiled (base commit `0d5c402`) that makes Punch-Out!! (USA, R7PE01)
  run: the region support, hooks, menus, controller prompts, difficulty modes and the Archipelago client. Applied by
  `launcher/scripts/build_port.sh`.
- `projects/punchout/recomp.yml`, `MAP.txt`: the translator project (memory layout, entry point, the game's function
  start addresses).

No game code or data: the build reads `main.dol` and the game's files from the player's own extracted disc.
Licensed GPL-3.0, like WiiCompiled (see LICENSE).
