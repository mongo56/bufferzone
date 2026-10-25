# Buffer Zone

> Fork of [dkrb56/bufferzone](https://github.com/dkrb56/bufferzone) by Dani, with fixes for the LG webOS TV app:
> faster remote response while the home screen loads, and Back from Subtitle style returns to the video.

A clean player for a friend's Plex server: Windows, Android TV and LG webOS TVs.

## Download

Get the newest build from [Releases](https://github.com/dkrb56/bufferzone/releases/latest):

- `BufferZone-<version>-portable.exe` — Windows, no installation.
- `BufferZone-tv-<version>.apk` — Android TV and Google TV.
- `com.dkrb56.bufferzone_<version>_all.ipk` — LG webOS TV 5 or newer (2020+). See [webos/INSTALL.md](webos/INSTALL.md).

## Start

Double-click `Start Buffer Zone.bat`, or run `npm start` in this folder.

First start: click **Sign in with Plex**. Your browser opens plex.tv. Sign in there. The app gets a token and never sees your password.

## Features

- Icon rail navigation: Home, Search, Movies, Series, Kids, Watchlist, Multi-view, pinned items and Settings.
- Home shows only the server you choose: Continue Watching and Next Up on the left, your watchlist on the right. Tabs filter by library, folder chips filter the watchlist. ↑/↓ and Space play from the list.
- Watchlist folders: make your own folders and put titles in them. Drag a title onto a folder, or use the folder button on a title. A title can be in more than one folder. Select one or more folder chips to filter: the selection applies to the watchlist page and to both columns of home (an episode counts for its series), and the app keeps it after a restart. Folders are saved on this computer, because Plex has no watchlist folders.
- Library pages: sort, genre filter, "unwatched only", grid or list view, collections and an A–Z letter rail. The app remembers the filter per library.
- Search palette (Ctrl+F or /) for movies, series and episodes. Enter opens, Ctrl+Enter plays.
- Watchlist from your Plex account, matched to titles on the server. Add or remove titles from detail pages.
- Pin series, movies or collections to the sidebar.
- Multi-view: up to four streams at once. Click a tile to move the audio to it.
- Plex Home profiles ("Who's watching?") with parental controls per managed profile: rating limit, unrated titles, libraries, PIN to leave and Multi-view.
- Quality: Direct Play (original file) or a fixed bitrate. If a file cannot play directly, the app switches to a converted stream.
- Audio and subtitle selection in the player. The app remembers your choice per series.
- Subtitle style: size, color, background and position (Settings).
- Skip intro / skip credits buttons (optional automatic skip).
- Next-episode countdown and auto-play.
- Watch progress and watched status sync to the server.

## Player keys

| Key | Action |
| --- | --- |
| Space / K | Play / pause |
| ← / → | Back 10 s / forward 30 s |
| ↑ / ↓ | Volume |
| F | Fullscreen |
| M | Mute |
| S | Skip intro / credits |
| N | Next episode |
| Esc | Leave fullscreen, then leave the player |

## Android TV

The `android/` folder holds a native Android TV version (Kotlin, Compose, ExoPlayer) with the same features and design.

- Sign-in: the TV shows a code; type it at **plex.tv/link** on a phone or computer.
- Playback: Direct Play through ExoPlayer, so MKV, HEVC, AC3/EAC3 (or passthrough to a soundbar) and embedded subtitles play without conversion when the TV supports them. Otherwise the app switches to a converted stream.
- Remote: OK = play/pause, left/right = back 10 s / forward 30 s, up/down = controls, Back = close.
- Watchlist folders and settings are saved on the TV.

Build (needs the Android SDK and Android Studio's Java):

```
cd android
gradlew assembleDebug
```

The APK is `android/app/build/outputs/apk/debug/app-debug.apk`. Install it with `adb install` (developer options and USB or network debugging on the TV), or copy it to a USB stick and open it with a file manager on the TV.

## Share as a portable exe

Run `npm run dist`. It builds `dist\BufferZone-<version>-portable.exe`: one file that runs without installation on 64-bit Windows.

- The exe has no personal data. Each person signs in with their own Plex account and needs access to a Plex server.
- The exe is not code-signed, so Windows SmartScreen can warn on the first start. Click **More info**, then **Run anyway**.
- Each start unpacks the app to a temporary folder, so it starts a few seconds slower than the installed version.

## LG webOS

The `webos/` folder builds the shared app (`renderer/`) into a webOS package with a remote-control layer and a small JS service that sends the Plex requests (the Plex server does not allow browser requests from a TV app). Build: `cd webos && npm install && npm run build`. Install: [webos/INSTALL.md](webos/INSTALL.md).

## Build all platforms

`npm run build:all` builds the Windows exe, the Android TV APK and the webOS package into `dist/`. All three take their version from `package.json`.

## Development

- Icons are Lucide SVGs, built into `renderer/js/icons.js` by `node scripts/build-icons.js`. Add a name to the list in that script to use a new icon.
- Colors and sizes are CSS variables at the top of `renderer/styles.css`.

## Files

- Settings and token: `%APPDATA%\Buffer Zone\` (token is encrypted with Windows DPAPI).
- Log for troubleshooting: `%APPDATA%\Buffer Zone\buffer-zone.log`. Tokens are masked.
