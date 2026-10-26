const [major, minor] = process.versions.node.split('.').map(Number);
if (major !== 24 || minor < 22) {
  console.error(`拾藏源码构建需要 Node.js 24.22.0 或更新的 24.x；当前为 ${process.version}。安装版本见 .node-version。`);
  process.exit(1);
}
