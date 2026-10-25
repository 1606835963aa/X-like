import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
await viteBuild();
const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node24', sourcemap: false, external: ['electron'], logLevel: 'info' };
await build({ ...common, entryPoints: ['src/server/entry.ts'], outfile: 'dist/server/entry.cjs' });
await build({ ...common, entryPoints: ['src/desktop/main.ts'], outfile: 'dist/desktop/main.cjs' });
await build({ ...common, entryPoints: ['src/desktop/preload.ts'], outfile: 'dist/desktop/preload.cjs' });
