# NAS 部署

NAS 是可选的共享资料库。Mac 和 Windows 负责登录 X、同步、查询与整理，也可以只使用默认本机资料库。手机端不在当前交付范围。

## 从源码部署

需要 Node.js 24.22.0 或更新的 24.x、Docker 和 Docker Compose。

```sh
npm ci --cache ./tmp/npm-cache
npm run build
npm run setup:shared
docker compose up -d --build
```

Compose 将 `./dist` 只读加载为程序目录，默认将 `./data` 作为持久资料目录。`setup:shared` 生成 `.env`，按资料目录拥有者填写运行用户与组，已有设置会保留。默认服务端口为 `5368`。

| `.env` 变量 | 用途 |
|---|---|
| `SHIZANG_UID` / `SHIZANG_GID` | 资料目录拥有者的用户与组编号，必须填写 |
| `SHIZANG_PORT` | 对外端口，默认 `5368` |
| `SHIZANG_BIND` | 对外监听地址，默认 `0.0.0.0` |
| `SHIZANG_DATA_PATH` | 资料目录，默认 `./data` |
| `SHIZANG_VERSION` | 镜像标签，源码构建默认 `local`，离线包使用包内版本 |

没有 Node.js 的图形界面部署，复制 `.env.example` 为 `.env`，填写实际 UID/GID。可在 NAS 终端用 `id -u`、`id -g` 查看当前用户；已有 `data` 时应使用目录拥有者的编号。配置缺失时 Compose 会提示所缺变量，不会套用其他机器的编号。已有目录权限不会被服务强制改写。

打开 `http://<NAS地址>:5368/api/health`，响应包含 `ok: true` 即表示服务已启动。

## ARM64 离线部署

离线包为 `Shizang-<版本>-NAS-arm64.zip`，包含镜像、Compose、程序、配置示例、恢复命令和许可文件。

```sh
docker load -i x-like-<版本>-arm64.tar
docker compose -f compose.offline.yaml up -d
```

在绿联等提供 Docker 图形界面的 NAS 上：

1. 将离线包解压到一个用于拾藏的共享目录。
2. 在 Docker 中导入包内的 `x-like-<版本>-arm64.tar` 镜像。
3. 复制包内 `.env.example` 为 `.env`，保留镜像版本，填写资料目录 UID/GID。
4. 以该目录创建项目，使用包内的 `docker-compose.yaml`，确认工具加载同目录的 `.env`；不支持读取时在项目变量中填写同样内容。
5. 启动项目，检查 `/api/health`。

离线镜像已包含运行所需文件，无需在创建项目时拉取最新镜像。

## 连接设备

服务首次启动会在 `data/pairing-key` 生成连接码。

- 电脑：在“设置 → 资料库”中填写 `http://<NAS地址>:5368` 和连接码。
- 另一台电脑：填写同一个地址和连接码。
- 已连接的电脑：可在“设置 → 资料库 → 显示连接码”中查看连接码。

其他电脑连接只需要资料库地址和连接码；同步时在执行同步的电脑登录 X。局域网使用 NAS 的局域网地址；跨网络使用私网连接或 HTTPS 反向代理。

## 更新程序

服务程序更新时，停止 `x-like`，替换 `dist` 中的程序文件，再启动容器。静态界面更新后，刷新页面或重新打开软件即可加载。

`data` 目录独立保存资料，更新程序时继续使用同一个目录。

## 备份和恢复

停止容器后，备份完整 `data` 目录。该目录包含 SQLite 数据库、手动保存的视频、现存媒体文件、连接码与设备凭证。

恢复时停止容器，将备份放回 `data`，确认运行用户与组有读写权限，再启动容器。

软件导出的 JSON 可用于恢复正文、来源、标签、备注和整理状态。媒体和设备连接信息通过完整 `data` 目录备份恢复。

数据库结构升级前自动生成并校验 SQLite 备份，失败时停止升级，迁移失败时回滚。服务停止后可运行容器镜像内的 `node /app/server/recovery-cli.cjs --data-dir /data --list` 查看备份，指定 `--backup /data/backups/<备份文件>` 恢复。恢复前的数据库和 WAL 会另外保留，媒体文件不变。命令应在只挂载该资料目录的一次性容器中运行；恢复完成后再启动主服务。
