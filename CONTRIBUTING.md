# 参与贡献 / Contributing

## 反馈与讨论

- [报告功能错误](https://github.com/1606835963aa/X-like/issues/new?template=bug_report.yml)：提供版本、系统、复现步骤和预期结果。
- [提出功能建议](https://github.com/1606835963aa/X-like/issues/new?template=feature_request.yml)：描述使用场景与希望完成的操作。
- 安全问题使用 [安全反馈](SECURITY.md) 中的私密渠道。

反馈与日志整理方法见 [反馈与诊断](docs/反馈与诊断.md)。

## 本地开发

使用 `.node-version` 指定的 Node.js 24.x 版本。安装依赖时遵循锁文件：

```sh
npm ci --cache ./tmp/npm-cache
npm test
npm run build
npm run release:check
npm audit --audit-level=moderate
```

桌面同步、网络、会话或视频保存相关改动还需运行 `npm run test:collector`。它使用模拟 X 响应和独立测试资料，无需个人账号。

当前范围为 Mac Apple Silicon、Windows x64 和可选共享资料库。Android 与 iOS 工程保留，当前不扩展手机功能。

## 代码与文档

- 使用现有 React、Electron、Node.js SQLite 结构；用户数据默认保存在本机。
- 改动数据库结构时保留升级前备份、失败回滚与恢复能力。
- 测试使用演示资料，不包含个人账号、Cookie、正文备份或真实服务地址。
- 临时文件放在项目 `tmp`，完成后清理；安装包和验收结果放在 Git 忽略的 `release`。
- 文档和注释描述当前行为；README 中英文版本保持一致。
- 依赖变更同时更新 `package-lock.json` 并重新审计。`xcode` 的 `uuid` 使用支持 CommonJS 的 11.1.1，兼容检查覆盖项目解析、标识生成和写入后重新解析。

提交拉取请求时说明解决的问题、最终行为和实际检查结果。Windows 真机结果与 Mac 侧构建结果分别记录；平台验收见 [Windows 验收](docs/Windows验收.md)。

本项目采用 AGPL-3.0-only。贡献内容应具有可按该许可分发的权利；第三方素材与代码保留所需的署名和许可。

## English

Use the [bug form](https://github.com/1606835963aa/X-like/issues/new?template=bug_report.yml) or [feature form](https://github.com/1606835963aa/X-like/issues/new?template=feature_request.yml). Report security issues through [SECURITY.md](SECURITY.md).

Use the Node.js version in `.node-version`, run `npm ci`, tests, build, release checks and the dependency audit shown above. Run `npm run test:collector` for desktop sync, session, network or media changes. Use demonstration data; keep temporary files in `tmp` and remove them when finished.

The current scope is macOS Apple Silicon, Windows x64 and the optional shared-library service. Keep both README languages aligned and describe actual validation in pull requests. Contributions are distributed under AGPL-3.0-only, with required third-party attribution retained.
