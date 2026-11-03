import { startService } from '../../src/server/service';

const service = await startService({ dataDir: process.argv[2], host: '127.0.0.1', port: 0 });
const shutdown = () => { void service.close().then(() => process.exit(0)); };
process.once('SIGTERM', shutdown);
process.once('disconnect', shutdown);
process.send?.({ port: service.port });
