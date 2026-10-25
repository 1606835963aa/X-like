# NAS 部署

NAS 负责保存和共享资料库，电脑负责登录 X 与同步，手机查询和整理已保存资料。电脑也可以只使用本机资料库。

## 从源码部署

需要 Node.js 24、Docker 和 Docker Compose。

```sh
npm ci --cache ./tmp/npm-cache
npm run build
docker compose up -d --build
```

Compose 将 `./dist` 只读加载为程序目录，将 `./data` 作为持久资料目录。服务端口为 `5368`。

仓库中的 Compose 默认使用 `1000:10` 作为用户与组。请按 NAS 上运行目录的实际权限调整 `user`，使其能够读写 `data`。

打开 `http://<NAS地址>:5368/api/health`，响应包含 `ok: true` 即表示服务已启动。

## ARM64 离线部署

离线包为 `Shizang-0.1.0-NAS-arm64.zip`，包含镜像、Compose 配置与程序文件。

```sh
docker load -i x-like-0.1.0-arm64.tar
docker compose -f compose.offline.yaml up -d
```

在绿联等提供 Docker 图形界面的 NAS 上：

1. 将离线包解压到一个用于拾藏的共享目录。
2. 在 Docker 中导入包内的 `x-like-0.1.0-arm64.tar` 镜像。
3. 以该目录创建项目，使用包内的 `docker-compose.yaml`。
4. 启动项目，检查 `/api/health`。

离线镜像已包含运行所需文件，无需在创建项目时拉取最新镜像。

## 连接设备

服务首次启动会在 `data/pairing-key` 生成连接码。

- 电脑：在“设置 → 资料库”中填写 `http://<NAS地址>:5368` 和连接码。
- Android：填写同一个地址和连接码。
- 已连接的电脑：可在“设置 → 资料库 → 显示连接码”中查看连接码。

手机连接只需要资料库地址和连接码，不需要登录 X。局域网内使用 NAS 局域网地址；其他网络使用已经接入 NAS 私网的地址。

## 更新程序

服务程序更新时，停止 `x-like`，替换 `dist` 中的程序文件，再启动容器。静态界面更新后，刷新页面或重新打开软件即可加载。

`data` 目录独立保存资料，更新程序时继续使用同一个目录。

## 备份和恢复

停止容器后，备份完整 `data` 目录。该目录包含 SQLite 数据库、手动保存的视频、现存媒体文件、连接码与设备凭证。

恢复时停止容器，将备份放回 `data`，确认运行用户与组有读写权限，再启动容器。

软件导出的 JSON 可用于恢复正文、来源、标签、备注和整理状态。媒体和设备连接信息通过完整 `data` 目录备份恢复。
