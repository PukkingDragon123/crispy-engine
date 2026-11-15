# dustUP on Steam: build and upload

## 1. Build the depot folders

```
npm run desktop:steam -- --out=/path/to/release --steam-appid=<AppID> --depot-windows=<DepotID> --depot-linux=<DepotID>
```

The command rebuilds the game and packages Electron for Windows x64 and Linux x64. The result
lands in `<out>/steam/`, with nothing zipped:

| Path | Contents |
| --- | --- |
| `content/windows/` | Windows depot content root (`dustUP.exe` at the top) |
| `content/linux/` | Linux depot content root (`dustUP.sh`, `dustUP`) |
| `scripts/app_build.vdf` | SteamPipe app build, tokens filled from the flags |
| `scripts/depot_build_windows.vdf`, `scripts/depot_build_linux.vdf` | Depot builds |
| `output/` | SteamCMD build logs and cache |

Without the id flags, the scripts keep `@APP_ID@`, `@DEPOT_WINDOWS@` and `@DEPOT_LINUX@`
placeholders. Edit those in by hand before uploading. The templates live in `desktop/steam/`.

Each content folder also gets a `steam_appid.txt` for local testing. It holds the `--steam-appid`
value, or 480 (Spacewar, Valve's public test app) when no id is given. The depot scripts exclude
this file, so it is never uploaded. A game launched by Steam receives its app id from the client
through the `SteamAppId` environment variable.

## 2. Test locally before uploading

1. Start the Steam client and log in.
2. Run `content/windows/dustUP.exe`. The game reads `steam_appid.txt` and initialises Steam.
3. Check the overlay: Shift+Tab should open it.
4. Check achievements from the devtools console. Launch with `--dev`, press F12, then run
   `await steam.unlock('ACH_ID')`.

Achievements only exist once they are defined for the app id in use. Spacewar (480) has
`ACH_WIN_ONE_GAME`, `ACH_WIN_100_GAMES`, `ACH_TRAVEL_FAR_ACCUM` and `ACH_TRAVEL_FAR_SINGLE`.

Without Steam, or without any app id, the game runs normally and `steam.isAvailable()` is false.

## 3. Upload with SteamCMD

1. Get SteamCMD.
   - Windows: unzip `steamcmd.zip` from the Steamworks SDK `tools/ContentBuilder/builder/`, or
     from Valve's download.
   - Linux: install the `steamcmd` package, or the tarball from Valve.
2. Use a dedicated build account with "Edit App Metadata" and "Publish App Changes To Steam"
   permissions. Log in once interactively so Steam Guard is satisfied:
   ```
   steamcmd +login <build_account> +quit
   ```
3. Upload. Use an absolute path to the script:
   ```
   steamcmd +login <build_account> +run_app_build /path/to/release/steam/scripts/app_build.vdf +quit
   ```
   On Windows: `steamcmd.exe +login <build_account> +run_app_build C:\path\to\release\steam\scripts\app_build.vdf +quit`
4. On the partner site, open **SteamPipe > Builds**. Find the new build by its description,
   `dustUP <version>`, and set it live on a beta branch to test, then on `default`.
   You can set `"SetLive" "beta"` in `app_build.vdf` to put builds on a beta branch automatically.
   The default branch cannot be set live from a script.

## 4. Partner site settings

### Installation > General Installation

- **Install folder:** `dustUP`.
- **Launch options:**

  | # | Executable | Arguments | Description | Operating system | CPU architecture |
  | --- | --- | --- | --- | --- | --- |
  | 1 | `dustUP.exe` | (none) | Play dustUP | Windows | 64-bit only |
  | 2 | `dustUP.exe` | `--windowed` | Play dustUP (windowed) | Windows | 64-bit only |
  | 3 | `dustUP.sh` | (none) | Play dustUP | Linux + SteamOS | 64-bit only |

  - Option 1 starts fullscreen. F11 or Alt+Enter toggles windowed, and the game remembers the choice.
  - Option 2 is optional.
  - For option 3, `dustUP.sh` adds `--no-sandbox` when the Chromium sandbox cannot start, which is
    common inside the Steam Linux Runtime.

### Depots

- Create one Windows depot (OS: Windows, 64-bit) and one Linux depot (OS: Linux).
- Add both depots to the base package and to any test packages.
- Their ids are the `--depot-windows` and `--depot-linux` values.

### Steam Cloud (Auto-Cloud)

The game saves through Chromium's localStorage, inside the Electron profile.

| Platform | Location |
| --- | --- |
| Windows | `%APPDATA%/dustUP` (`C:\Users\<name>\AppData\Roaming\dustUP`) |
| Linux | `~/.config/dustUP` |

The save itself is the LevelDB folder `Local Storage/leveldb` inside that profile. Sync only that
folder, not the caches next to it:

1. **Byte quota:** 10 MB per user. **Number of files:** 100.
2. **Root paths:**
   - Root: `WinAppDataRoaming`.
   - Subdirectory: `dustUP/Local Storage/leveldb`.
   - Pattern: `*`.
   - OS: Windows.
   - Recursive: on.
3. **Root override for Linux:**
   - Original root: `WinAppDataRoaming`.
   - OS: Linux + SteamOS.
   - New root: `LinuxHome`.
   - Add/replace path: `.config/`.
   - Result: `~/.config/dustUP/Local Storage/leveldb`. Confirm the root names offered in the
     partner UI.

Steam syncs after the game exits, so the LevelDB files are consistent. The app is single-instance,
so two copies never write the folder at the same time.

### Achievements

- Define them under **Stats & Achievements**, then publish.
- From the game, call `window.steam?.unlock('<API name>')`. The call is safe without Steam.
- No achievement calls are wired into the game yet. Suggested API names:

| API name | Unlocks when |
| --- | --- |
| `ACH_FIRST_RIDE` | first run started (after the intro) |
| `ACH_FIRST_BOUNTY` | first bounty collected |
| `ACH_WAVE_10` | wave 10 reached |
| `ACH_WAVE_50` | wave 50 reached |
| `ACH_WAVE_100` | wave 100 reached |
| `ACH_BEAT_SPHINX` | the Sphinx defeated |
| `ACH_BEAT_NILE_FLEET` | the Nile warship fleet sunk |
| `ACH_BEAT_CLEOPATRA` | Cleopatra defeated |
| `ACH_BEAT_KHONSU` | Khonsu defeated |
| `ACH_BEAT_RA` | Ra, the wave-100 sun god, defeated |
| `ACH_THOTH_FIRST_ENTRY` | first creature recorded in Thoth's Hall |
| `ACH_THOTH_COMPLETE` | every creature recorded in Thoth's Hall |
| `ACH_FULL_ARSENAL` | every gun part unlocked |

## Bridge reference (`desktop/preload.cjs`)

```ts
declare global {
  interface Window {
    steam?: {
      isAvailable(): boolean;
      unlock(id: string): Promise<boolean>;
      isUnlocked(id: string): Promise<boolean>;
      playerName(): Promise<string | null>;
      setRichPresence(key: string, value: string | null): Promise<boolean>;
    };
  }
}
```

- `window.steam` exists only in the desktop build. In the browser it is undefined, so use `?.`.
- Achievement ids must match `[A-Za-z0-9_.-]{1,128}`.

## Steam-related command-line flags

| Flag | Effect |
| --- | --- |
| `--steam-appid=N` | Override the app id source |
| `--no-steam` | Never load Steam |
| `--no-steam-overlay` | Skip the overlay switches |

The overlay needs `in-process-gpu` and `disable-direct-composition`. These are set through
steamworks.js `electronEnableSteamOverlay()`, and only when Steam initialised.
