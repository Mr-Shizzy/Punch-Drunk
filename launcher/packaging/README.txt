Punch-Drunk: Punch-Out (Wii) Recomp
===================================

Unofficial fan project. Not affiliated with or endorsed by Nintendo. Includes no game content:
bring your own Punch-Out!! (Wii, USA) disc image and, for Doc Louis's Punch-Out!!, your own
WAD and your own console's Wii common key.

Run "Punch-Drunk.exe". Nothing to install. Press "Set up" on a game and pick your disc image or WAD.
Setting up a game needs no internet. If your PC doesn't have Microsoft's Visual C++ runtime (most do),
the launcher gets it from Microsoft before the game starts, and Windows asks for permission once.

Updates: the launcher checks GitHub for a newer version and asks before installing one. You can
switch the check off in Settings.

Portable: everything stays in this folder.
  settings.json   the launcher's settings
  data\           your unpacked games, the built games, saves and logs (build files are removed
                  after a build)
  temp\           temporary files (cleared automatically)
Move or rename the folder whenever you like. To remove it, delete the folder.

Keep the folder's path plain (letters, numbers, spaces, dots, dashes, underscores),
for example C:\Games\Punch-Drunk. The game's build can't use other characters.

The program isn't code-signed, so Windows SmartScreen or antivirus may warn the first time.

Check this copy: run  Punch-Drunk.exe --selftest  and read selftest_result.txt.

A fork of POW: Recompiled!! (https://gitlab.com/fist-in/POW-Recompiled).
Credits and licences: THIRD_PARTY_NOTICES.txt.
