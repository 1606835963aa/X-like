[简体中文](README.md) | **English**

<div align="center">
  <img src="public/icon.svg" width="88" height="88" alt="Shizang logo" />
  <h1>Shizang · 拾藏</h1>
  <p><strong>Keep what matters. Find it again.</strong></p>
  <p>A personal library for your X / Twitter bookmarks and likes.<br />Use it on your computer without a NAS. Add a shared library when you need one.</p>
  <p><a href="#features">Features</a> · <a href="#quick-start">Quick start</a> · <a href="docs/shared-library.en.md">Shared library</a> · <a href="#building">Building</a></p>
  <p><code>macOS</code> <code>Windows</code> <code>Android</code> <code>Docker / NAS</code></p>
</div>

<p align="center"><img src="docs/assets/readme-cover.en.png" alt="Shizang: browsing, searching and organizing a personal library" width="1200" /></p>

## Why Shizang

A saved post is only useful if you can find it later. Shizang turns your bookmarks and likes into a library you can search, filter and organize.

**The desktop app works on its own.** Bookmarks, likes, tags, notes, indexes and videos you explicitly save are managed in the local library by default. No NAS, Docker or separate server is required.

Remote storage is optional. If you configure it, you can use a library hosted on a cloud server, an ordinary computer, a home server or your own NAS. Connect your devices to the same library when you want to share it.

## Features

| Find | Organize | Use on your devices |
|---|---|---|
| Search text, authors, tags, notes and quoted posts | Add tags, folders and notes | Sync from macOS or Windows |
| Combine keywords, source, media and date filters | Mark as read, pin, archive and restore | Use a local desktop library |
| Automatically index post hashtags | Merge duplicate posts while preserving both sources | Host a shared library on a computer, server or NAS |
| Author and tag suggestions and directories | Export JSON backups and CSV | Browse and organize on Android |

- **Incremental sync.** Sync new bookmarks, likes or both. Reading stops when a full page is already in the library.
- **Find videos by author.** Author cards show post and video counts. Author and tag directories use a responsive grid with continuous browsing and full-directory search.
- **Save videos when you choose.** Images and unsaved videos load directly from X on the viewing device. The desktop app can explicitly save selected videos to the current library.
- **Bring existing data.** Import Shizang JSON backups, X `like.js` files, tweet JSON and CSV files containing post IDs or original links.

## Screenshots

### Browse and search

![Desktop library](docs/assets/library-desktop.png)

<details>
<summary>Author directory, tag directory and dark mode</summary>

![Author directory](docs/assets/authors-desktop.png)

![Tag directory](docs/assets/tags-desktop.png)

![Dark mode](docs/assets/library-dark.png)

</details>

### Browse the same library on your phone

<p align="center"><img src="docs/assets/library-mobile.png" alt="Mobile library" width="300" />
<img src="docs/assets/tags-mobile.png" alt="Mobile tag directory" width="300" /></p>

Screenshots use a separate demonstration library. The application interface is currently in Simplified Chinese.

## Quick start

### Desktop, without a NAS

Requires **Node.js 24** and Git.

```sh
git clone https://github.com/1606835963aa/X-like.git
cd X-like
npm ci --cache ./tmp/npm-cache
npm run build
npm start
```

1. Open Shizang. It uses a local library on this computer by default.
2. Connect your X account through the official X page opened by the desktop app.
3. Start a sync for new bookmarks, likes or both.
4. Search your library and organize posts with tags, folders and notes.

Sync on startup is off by default and can be enabled in Settings. Rate limits, expired sessions and account verification stop the sync. Rate-limit waiting periods survive a restart; you can sync manually once the wait ends.

### Share with your phone, using an ordinary computer

Start the library service from the project directory:

```sh
npm run server
```

The service prints a pairing code and stores data in the project's `data/` directory.

1. Connect the desktop app to `http://127.0.0.1:5368` and enter the pairing code.
2. Connect your phone to `http://<computer-LAN-address>:5368` with the same code.
3. Sync new posts from the desktop app; browse and organize the same library on your phone.

Keep the service computer running and make sure the devices can reach it. See the [shared-library guide](docs/shared-library.en.md) for configuration, migration and backups.

### NAS or home server

The same service can run continuously on a NAS or another server. Docker and ARM64 offline deployment are covered in the [shared-library guide](docs/shared-library.en.md#docker-and-nas).

To move existing local data, export a JSON backup, switch to the shared library and import the backup. Switching libraries does not move data automatically.

## Local by default, remote storage optional

| Content | Location |
|---|---|
| X login session | The computer where you sign in |
| Text, authors, sources, tags and organization | The selected local or shared library |
| Images and unsaved videos | Loaded directly from X by the viewing device |
| Videos explicitly saved from the desktop app | The selected library |
| Mobile library connection | A device access credential |

The shared service receives no X login cookies and does not download media from X. Devices access it using its address and a device credential.

JSON backups preserve content, sources, tags, notes and organization. Back up the full service data directory to preserve saved media and device connections as well.

Local desktop data lives in the `library` folder inside the system’s Shizang application-data directory. Quit the app before copying that folder for a full local backup. Use JSON export and import to move records between libraries.

## Platform status

| Platform | Status |
|---|---|
| macOS · Apple Silicon | Built and runtime-verified, including login, sync and NAS access |
| Windows · x64 | Installer built; real-device acceptance testing pending |
| Android | APK built; real-device acceptance testing pending |
| NAS · Linux ARM64 | Docker offline deployment and shared-library access verified |
| iOS | Project prepared; no installation package built yet |

## Building

Desktop installers are written to `release/`:

```sh
npm run package:mac
npm run package:win
```

For Android, use JDK 21, Android SDK 36 and Build Tools 35:

```sh
npm run build
npx --cache ./tmp/npm-cache cap sync android
node scripts/android-build.mjs
```

The Android signing key and its configuration are stored under `private/`. Keep the same key for subsequent updates.

Checks and icon generation:

```sh
npm test
npm run test:collector
node scripts/icons.mjs
```

The frontend uses React, desktop uses Electron, mobile uses Capacitor and the service uses Node.js built-in SQLite. Devices communicate with the library over HTTP.

- [Shared-library deployment](docs/shared-library.en.md)
- [Development guide, Chinese](docs/开发.md)
- [Design guidelines, Chinese](design/DESIGN.md)
- [Brand assets, Chinese](design/品牌.md)
- [Report an issue](https://github.com/1606835963aa/X-like/issues)

The organization of the self-hosted library was informed by [Karakeep](https://github.com/karakeep-app/karakeep).

## License

Licensed under the [GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`).
