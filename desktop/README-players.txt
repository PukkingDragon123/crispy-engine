dustUP
======

A voxel sandboarding bullet-hell bounty hunt through a mythic Egyptian desert.

Starting the game
-----------------
Windows: unzip the whole folder anywhere (Desktop, Documents, a games folder), open it and
double-click dustUP.exe. Keep every file in the folder next to dustUP.exe.

Linux: unzip, then run ./dustUP.sh (or ./dustUP).

Windows SmartScreen warning
---------------------------
This build is not code-signed yet, so Windows may show "Windows protected your PC" the first
time you start it. Click "More info", then "Run anyway". Windows remembers the choice.
Copies installed through Steam do not show this warning.

Window and display
------------------
- The game starts fullscreen. Esc belongs to the game (pause, back).
- F11 or Alt+Enter switches between fullscreen and a normal window you can move, resize and
  close. The game remembers the last mode and window size.
- To start in a window once, launch with:   dustUP.exe --windowed
- Alt+F4 quits from anywhere.

Saves
-----
Progress is saved automatically and kept between launches and updates:
- Windows: %APPDATA%\dustUP
- Linux:   ~/.config/dustUP
Deleting that folder resets all progress.

Troubleshooting
---------------
- Black screen or very low frame rate: update your graphics driver. On laptops with two GPUs,
  set dustUP.exe to "High performance" in Windows Settings > System > Display > Graphics.
- Steam overlay problems: launch with --no-steam-overlay.
