# Shared library

Run the shared-library service on an ordinary computer, a cloud server, a home server or a NAS. For use on a single computer, the desktop app's default local library needs no separate service.

## Ordinary computer

Requires Node.js 24. From the project directory:

```sh
npm ci --cache ./tmp/npm-cache
npm run build
npm run server
```

The default port is `5368`. The service prints a pairing code.

- Desktop app on the same computer: connect to `http://127.0.0.1:5368`.
- Phone or another computer: connect using the service computer's LAN address, such as `http://192.168.1.100:5368`.
- Enter the same pairing code on both devices. An already connected desktop app can also display the code in Settings.

Keep the service computer running. Devices must be able to reach it, and the computer must allow access to port `5368`. For access across networks, use an already connected private network.

## Moving a local library

The desktop app's local data is stored in the system's Shizang application-data directory. The standalone service stores data in the project's `data/` directory by default. These are separate libraries.

Export a JSON backup from the local library, switch to the shared library, then import that backup. Both desktop and phone should then connect to the shared service. Switching the connection does not move existing data automatically.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `SHIZANG_DATA_DIR` | `data` | Persistent data directory |
| `SHIZANG_NAME` | `拾藏 · 共享资料库` | Display name |
| `HOST` | `0.0.0.0` | Listen address |
| `PORT` | `5368` | Service port |

## Docker and NAS

From the source tree:

```sh
npm run build
docker compose up -d --build
```

The Compose configuration mounts `./dist` read-only as the program directory and persists data in `./data`. Its default user and group are `1000:10`; set `user` to an identity that can read and write your data directory.

For an ARM64 offline bundle:

```sh
docker load -i x-like-0.1.0-arm64.tar
docker compose -f compose.offline.yaml up -d
```

On a NAS with a Docker GUI, import the image, create a project in the extracted bundle directory and use its `docker-compose.yaml`. An offline deployment does not need to pull the image again.

Check `http://<service-address>:5368/api/health`; a response containing `ok: true` means the service is running. The pairing code is stored in `data/pairing-key`.

## Updates and backups

For a server-program update, stop the service, replace `dist`, then start it using the same data directory. Static interface updates load after a refresh or reopening the app.

To back up everything, stop the service, copy the complete data directory and start it again. Restore that directory while the service is stopped and ensure the service user can write to it. JSON exports preserve content and organization; the full data directory also preserves saved media and device connections.
