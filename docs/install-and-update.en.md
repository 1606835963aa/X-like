# Install, update and back up

Desktop packages include their runtime and use a local library by default. A single computer needs no Node.js, Docker or NAS setup.

## Install

Download from [Releases](https://github.com/1606835963aa/X-like/releases):

| Computer | File | Install |
|---|---|---|
| Apple Silicon Mac, macOS 13+ | `Shizang-<version>-macOS-arm64.zip` | Extract and move 拾藏.app to Applications |
| Windows x64 | `Shizang-<version>-Windows-x64.exe` | Run the installation wizard |

Mac builds use an ad-hoc signature; Windows builds have no publisher signature. After checking the download source, an unverified-developer prompt on Mac can be handled through System Settings → Privacy & Security → Open Anyway. See [Apple's instructions](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unknown-developer-mh40616/mac).

For a Windows SmartScreen prompt, use More info → Run anyway after checking the source. Organization-managed policies may restrict this option; see [Microsoft's explanation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation).

The release's `SHA256SUMS-<version>.txt` lists file hashes. Use `shasum -a 256 <file>` on Mac or `Get-FileHash <file> -Algorithm SHA256` in PowerShell.

## Use and update

Open Shizang, sign in through the official X page opened by the app, and manually sync new bookmarks or likes. Shared libraries are optional; see the [shared-library guide](shared-library.en.md).

To update:

1. Export JSON from Settings. Copy the full local library as described below if saved videos are needed too.
2. Finish or stop sync and video-save tasks, then quit the app. On Mac, use the application's Quit command.
3. Replace the app in Applications on Mac, or run the new Windows installer under the same system user.
4. Reopen and check the version, selected library and existing records.

Updates are downloaded manually. Application data is stored separately from the program and is retained when replacing the program.

## Back up and move data

The application menu 资料库 → 打开本机资料目录 opens the local `library` folder. Quit the app before copying the whole folder; it includes the database, organization metadata and explicitly saved videos.

The application-data directory is normally `~/Library/Application Support/拾藏` on Mac and `%APPDATA%\拾藏` on Windows. JSON export and import moves records and organization between libraries; full-folder backup also preserves videos.

Remote connection credentials are protected by the current OS user, and X sessions belong to the signed-in device. Connect and sign in separately on another computer.

Startup failure dialogs provide logs, retry and backup recovery. The 资料库 menu also provides backup access and restore. Database schema upgrades create validated backups before migration; a new app version does not necessarily change the schema. Restore retains the previous database separately and preserves saved media.

For feedback, follow the [diagnostics guide](feedback-and-diagnostics.en.md).
