import { join, resolve } from 'node:path';
import { startService } from './service';
import { APP_VERSION } from '../shared/version';
import { redactDiagnostic, startupExplanation, writeDiagnostic } from '../shared/diagnostics';
const dataDir=resolve(process.env.SHIZANG_DATA_DIR??'data');
const uiDir=resolve(__dirname,'../ui');
void startService({dataDir,uiDir,host:process.env.HOST??'0.0.0.0',port:Number(process.env.PORT??5368),name:process.env.SHIZANG_NAME??'拾藏 · 共享资料库',pairingKey:process.env.SHIZANG_PAIRING_KEY}).then(service=>{
  console.log(`拾藏已启动：http://0.0.0.0:${service.port}\n连接码：${service.pairingKey}`);
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{void service.close().then(()=>process.exit(0));});
}).catch(error=>{
  const logfile=writeDiagnostic(join(dataDir,'logs'),error,APP_VERSION);
  console.error(startupExplanation(error));
  console.error(logfile?`启动日志：${logfile}`:redactDiagnostic(error instanceof Error?error.message:String(error)));
  process.exitCode=1;
});
