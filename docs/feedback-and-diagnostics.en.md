# Feedback and diagnostics

Use the [bug form](https://github.com/1606835963aa/X-like/issues/new?template=bug_report.yml) for functional problems, the [feature form](https://github.com/1606835963aa/X-like/issues/new?template=feature_request.yml) for suggestions, and [SECURITY.md](../SECURITY.md) for private security reporting.

Private-repository forms require repository access. GitHub's private vulnerability entry requires the maintainer to enable it on a public repository; the security policy provides a contact-request fallback.

## What to include

- App version from Settings and the OS version.
- Local or remote library mode. Describe a remote connection as LAN or cross-network, with placeholders for addresses.
- Reproduction steps, actual result and expected result, using demonstration data.
- A cropped screenshot or relevant error excerpt. Hide accounts, personal posts and addresses.

For sync problems, include the source selection and any rate-limit, login-verification or timeout message. For display or input issues, include system scale and input method.

## Logs

The application menu 资料库 → 打开启动日志目录 opens `logs/startup.log` and its rotated `startup.previous.log`.

资料库 → 打开本机资料目录 opens `library`. Its parent directory contains `connection.log` and `connection.previous.log`. Connection diagnostics initialize when the app starts. Logs retain connection modes, operation stages, HTTP statuses and error codes. Existing logs are sanitized on the process's first write, and log size is limited.

Share only relevant excerpts after checking their contents. Cookies, pairing codes, device tokens, login profiles, full databases and personal posts are not issue attachments. Use placeholders in private security reports too.

For startup failures, keep the data directory and use the startup dialog's logs or recovery options. For remote-service failures, switch to the local library and check the service and network. For X verification or rate limits, handle the official prompt and sync manually after the waiting period.

See [installation and updates](install-and-update.en.md) for backup and update steps.
