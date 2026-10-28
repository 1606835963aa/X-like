# 安全反馈 / Security

## 报告入口

安全问题优先通过 GitHub 的 [Report a vulnerability](https://github.com/1606835963aa/X-like/security/advisories/new) 私密提交。此入口需要仓库开启 Private vulnerability reporting；GitHub 为公开仓库提供这项功能。

入口不可用时，使用 [请求私密反馈渠道](https://github.com/1606835963aa/X-like/issues/new?template=security_contact.yml)。该表单只请求联系渠道，不填写漏洞细节。维护者安排好私密渠道后，再提交复现信息。

普通功能错误使用 [Bug 反馈](https://github.com/1606835963aa/X-like/issues/new?template=bug_report.yml)。

## 报告内容

私密报告包含软件版本、操作系统、复现步骤、影响范围，以及使用演示资料重现的方法。凭证泄漏、越权读取、任意文件访问和执行代码属于安全问题。

报告使用替代值描述 Cookie、连接码、设备凭证、代理地址和账号。真实凭证、登录会话目录、完整资料库与私人收藏不作为报告附件。

## 数据边界

- X 登录会话保存在登录设备，共享资料库不接收 X Cookie。
- 正文、标签、备注和手动保存的视频保存在用户当前选择的资料库。
- 连接日志隐藏代理、服务地址与凭证；软件启动时初始化连接诊断，首次写入时一起处理旧连接日志。
- 启动日志隐藏地址、个人路径与凭证。提交日志时只选取与错误有关的片段。
- 共享资料库是供用户自己的设备共用的一份资料，不提供多用户之间的资料隔离。跨网络使用私网连接或 HTTPS。

当前维护范围为 macOS Apple Silicon 与 Windows x64 桌面版的 0.1.x 系列。手机端不在当前发行范围。

## English

Use GitHub's [private vulnerability report](https://github.com/1606835963aa/X-like/security/advisories/new) when it is available. This requires Private vulnerability reporting to be enabled on a public repository. If the entry is unavailable, open the [private contact request](https://github.com/1606835963aa/X-like/issues/new?template=security_contact.yml), without vulnerability details, and wait for a private channel.

Include the app version, OS, reproduction steps, impact and a demonstration-data example. Replace credentials and personal information with placeholders. Cookies, pairing codes, device tokens, login profiles and complete personal libraries are not report attachments.

The supported security-maintenance scope is the 0.1.x desktop series for macOS Apple Silicon and Windows x64. X sessions stay on the signed-in device; the shared service receives no X cookies. A shared library is one library for the user's devices, without separate user-level data isolation. Use a private network or HTTPS for remote access.
