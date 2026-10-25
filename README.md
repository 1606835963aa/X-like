# 拾藏

管理自己的 X 收藏和点赞。桌面软件负责登录与同步，NAS 保存资料，安卓访问同一份资料库。

## 直接使用

- Mac：解压 `release/Shizang-0.1.0-macOS-arm64.zip`，打开“拾藏”；本机也可以直接打开 `release/mac-arm64/拾藏.app`。
- 安卓：安装 `release/Shizang-0.1.0-Android.apk`。
- Windows：安装 `release/Shizang-0.1.0-Windows-x64.exe`。

安装包也保存在 NAS 的 `电脑远程盘/X-like/安装包` 目录。

NAS 地址为 `http://192.168.1.100:5368`。Mac 已保存 NAS 连接；安卓首次打开时，填写这个地址，再输入电脑软件“设置 → 资料库 → 显示连接码”中的连接码。

手机和 NAS 在同一网络时可以直接连接。其他网络使用能够访问 NAS 的私网地址连接。

## 日常操作

打开软件时自动同步默认关闭。需要更新时，点击“同步”选择收藏、点赞或两者，只收录对应账号与来源的新增内容；遇到整页已收录资料就结束读取。自动同步可在“设置 → 同步”中主动开启。

桌面同步与界面共用系统网络和代理设置。同步先检查资料库连接，无法连接时在读取 X 前停止，并显示资料库连接、超时或凭证失效的具体提示。

同步遇到限流、登录失效或账号验证时停止，不自动重试，也不继续读取另一种来源。限流时按 X 返回的等待时间暂停；没有提供等待时间时暂停 15 分钟，重启软件仍保留暂停时间，到期后由用户手动同步。采集网页在同步结束后关闭，X 登录状态保留。同步只保存正文、作者、来源、标签和媒体地址，不自动下载图片、头像或视频。

搜索支持正文、作者、标签、备注、文件夹与引用内容。多个关键词用空格分隔，结果需要同时包含这些关键词。筛选可组合来源、图片或视频、阅读状态、作者、账号与日期。

帖子自带的 `#话题标签` 会自动加入标签索引，已有资料也会从保存的正文中补齐。输入 `#AI` 可以精确搜索该标签，`#AI #猫咪` 可以同时匹配两个标签；大小写和全角形式统一识别。左侧“标签”入口提供可搜索的完整目录，卡片和详情中的标签可点击筛选。筛选面板中的标签和作者输入框在输入后显示最多 8 条联想建议。帖子标签与自己添加的标签分开保存，并共同用于搜索。

点击资料卡片可查看完整正文、整理标签与备注、放入文件夹、标为已读、置顶或归档。同一条推文同时收藏和点赞时只保存一份正文，并保留两个来源标记。归档内容可以移回资料库。

左侧“作者”目录按用户名去重，显示每位作者的资料、视频、收藏和点赞数量。同一帖子同时收藏、点赞时只计一条资料。同名、不同用户名的作者分开列出；点击作者可查看资料，点击视频数量可只查看该作者的视频。归档内容不计入普通目录，恢复后重新计入。

作者和标签目录在宽屏上每行三列，手机上每行两列，极窄屏自动改为单列。全部匹配项连续展示，可以直接滚动浏览，无需翻页；搜索覆盖完整目录。

图片、头像和未保存的视频由当前设备直接读取 X；播放失败只显示重试入口，不向 NAS 转存。打开详情不预读视频内容。需要保留视频时，在电脑的资料详情中手动点击“保存视频到 NAS”，由电脑获取后上传 NAS；完成后，手机可以读取已经保存的视频。本机资料库对应的按钮为“保存视频到本机资料库”。在线媒体需要当前设备能够访问 X 的媒体服务器。

导入支持拾藏 JSON 备份、X 的 `like.js`、推文 JSON，以及包含推文编号或原文链接的 CSV。X 存档中只有短正文的条目会按文件实际包含的内容导入。JSON 备份包含来源、手动标签、帖子标签、备注、归档和首次收录时间；CSV 的“标签”和“帖子标签”两列分别保存这两类标签，导出后可重新导入。

## 资料位置

| 内容 | 位置 |
|---|---|
| 项目源码与构建产物 | 本项目目录 |
| NAS 运行文件 | 共享文件夹 `电脑远程盘/X-like` |
| NAS 正文、整理信息与连接设置 | NAS 项目的 `data` 目录 |
| NAS 手动保存的视频与现存媒体文件 | NAS 项目的 `data/media` 目录 |
| 桌面连接、主题与本机资料库 | 系统的“拾藏”应用数据目录 |
| 安卓发布签名 | 本项目的 `private` 目录 |

X 登录状态保存在登录的电脑上。NAS 接收收藏资料和用户手动保存的视频，不主动向 X 下载媒体，也不接收 X 登录 Cookie。手机通过设备连接凭证访问 NAS。

`private` 中的安卓签名文件用于安装后续更新，需要保留。`private`、`data`、`release`、`tmp` 和系统生成文件均在 Git 忽略范围内。

## NAS 部署与备份

部署方法见 [NAS 部署说明](docs/NAS部署.md)。现有部署的 Docker 项目名为 `x-like`，服务端口为 `5368`。

在软件设置中导出 JSON 可以备份正文与整理信息。备份原始媒体时，先停止 `x-like` 容器，复制完整 `data` 目录，再启动容器。恢复时将完整目录放回相同位置后启动。

## 从源码运行

需要 Node.js 24。

```sh
npm ci --cache ./tmp/npm-cache
electron_config_cache="$PWD/tmp/electron-cache" node node_modules/electron/install.js
npm run build
npm start
```

测试与打包：

```sh
npm test
npm run test:collector
npm run package:mac
npm run package:win
```

安卓构建需要 JDK 21、Android SDK 36 与 Build Tools。配置好 `JAVA_HOME` 和 `ANDROID_HOME` 后运行：

```sh
npm run build
npx --cache ./tmp/npm-cache cap sync android
node scripts/android-build.mjs
```

安卓脚本使用 `private` 中的签名，首次构建时自动创建。iPhone 工程位于 `ios`，iPhone 安装包尚未构建。

## 实现与参考

前端使用 React 和普通 CSS，桌面使用 Electron，手机使用 Capacitor。NAS 服务使用 Node.js 内置 SQLite；所有设备通过 HTTP 接口访问资料库。

自托管资料库的组织方式参考 [Karakeep](https://github.com/karakeep-app/karakeep)。侧栏、材质与控件层次参考 Apple 的 [Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars) 和 [Materials](https://developer.apple.com/design/human-interface-guidelines/materials) 指南。界面规范见 [设计说明](design/DESIGN.md)。

源码仓库：[X-like](https://github.com/1606835963aa/X-like)，为 GitHub 私有仓库，开发分支为 `main`。

安装包与功能的检查范围见 [验收记录](docs/验收记录.md)。
