# NAS 部署

运行目录包含 `docker-compose.yaml`、`dist/server`、`dist/ui` 与 `data`。容器只读加载程序文件，将资料写入 `data`。桌面和安卓连接同一个服务地址。

## 绿联 NAS

1. 将 NAS 包解压到共享文件夹中的 `X-like` 目录。
2. 在 Docker 的“镜像 → 本地镜像 → 添加镜像 → 从 NAS 导入”中导入包内的镜像文件。
3. 在“项目”中创建 `x-like`，存放路径选择 `电脑远程盘/X-like`。
4. 使用包内的 `docker-compose.yaml`，创建并运行项目。已有项目可以在 Compose 配置页重新部署，无需勾选拉取最新镜像。
5. 打开 `http://NAS地址:5368/api/health`，显示 `ok: true` 代表服务已经启动。

服务会在 `data/pairing-key` 生成连接码。已连接的电脑可以在设置中显示连接码，供手机配对。

当前用户和组为 `1000:10`，对应这台 NAS 的文件权限。迁移到其他 NAS 时，将 Compose 的 `user` 改成有权访问运行目录的用户与组。

## Docker 命令

使用预构建 ARM64 镜像：

```sh
docker load -i x-like-0.1.0-arm64.tar
docker compose -f compose.offline.yaml up -d
```

从源码构建镜像时，先在项目目录执行 `npm run build`，再运行：

```sh
docker compose up -d --build
```

## 更新程序

停止 `x-like`，更新 `dist` 中的程序文件，再启动容器。静态界面更新后，重新打开软件或刷新页面即可加载。`data` 目录独立保存资料。

## 备份和恢复

停止容器后，备份完整 `data` 目录。该目录包含 SQLite 数据库、媒体缓存、连接码和设备凭证。

恢复时停止容器，将完整备份放回 `data`，确认用户与组具有读写权限，再启动。使用软件导出的 JSON 可以恢复正文与整理内容；媒体文件通过完整目录备份恢复。

## 连接方式

局域网使用 `http://NAS局域网地址:5368`。外出时，使用已接入 NAS 私网的地址。手机连接只需要服务地址和连接码，不需要登录 X。
