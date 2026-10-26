import { app, BrowserWindow, dialog, ipcMain, Menu, net, safeStorage, shell } from 'electron';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { startService } from '../server/service';
import { Collector } from './collector';
import { loadPreferences, validPreference } from './preferences';
import { LibraryConnections, validConnection } from './connections';
import type { Connection } from '../shared/types';
import { APP_VERSION } from '../shared/version';
import { startupExplanation, writeDiagnostic } from '../shared/diagnostics';
import { inspectBackup } from '../server/database-recovery';
import { localDeviceToken } from './local-device';
import { restoreLocalLibrary } from './local-recovery';

if(process.env.SHIZANG_USER_DATA)app.setPath('userData',process.env.SHIZANG_USER_DATA);
app.setName('拾藏');
app.setAppLogsPath(join(app.getPath('userData'), 'logs'));
app.setAboutPanelOptions({ applicationName: '拾藏', applicationVersion: APP_VERSION });
const singleInstance = app.requestSingleInstanceLock();
if(!singleInstance)app.quit();
let main:BrowserWindow|null=null;let collector:Collector;let local:Awaited<ReturnType<typeof startService>>;let connection:Connection;let startupFailed=false;
const libraryDirectory = join(app.getPath('userData'), 'library');
function restart(restore = false) {
  app.relaunch({ args: process.argv.slice(1).filter(arg => arg !== '--restore-library').concat(restore ? ['--restore-library'] : []) });
  app.quit();
}
async function openDirectory(directory: string) {
  try {
    mkdirSync(directory, { recursive: true });
    const error = await shell.openPath(directory);
    if (error) dialog.showErrorBox('无法打开目录', error);
  } catch (error) { dialog.showErrorBox('无法打开目录', startupExplanation(error)); }
}
async function chooseBackup() {
  const result = await dialog.showOpenDialog({ title: '选择本机资料库备份', defaultPath: join(libraryDirectory, 'backups'), properties: ['openFile'], filters: [{ name: 'SQLite 资料库', extensions: ['sqlite', 'db'] }] });
  if (result.canceled || !result.filePaths[0]) return false;
  const backup = result.filePaths[0];
  const info = inspectBackup(backup);
  const confirmation = await dialog.showMessageBox({ type: 'question', title: '恢复本机资料库', message: `将备份中的 ${info.posts} 条资料恢复到本机？`, detail: '当前本机数据库会另外保留在 backups 目录。已保存的视频保持原样；恢复后打开本机资料库，远程连接信息保留。', buttons: ['恢复并重新打开', '取消'], defaultId: 1, cancelId: 1 });
  if (confirmation.response !== 0) return false;
  restoreLocalLibrary(app.getPath('userData'), backup);
  return true;
}
async function handleStartupFailure(error: unknown) {
  startupFailed=true;
  collector?.stop(); collector?.window?.destroy(); main?.destroy();
  await local?.close();
  const logfile = writeDiagnostic(app.getPath('logs'), error, APP_VERSION);
  for (;;) {
    const result = await dialog.showMessageBox({ type: 'error', title: '拾藏无法启动', message: startupExplanation(error), detail: logfile ? `启动日志：${logfile}` : '启动日志无法写入，请先检查资料目录权限和磁盘空间。', buttons: ['重试启动', '打开资料目录', '打开日志目录', '从备份恢复…', '退出'], defaultId: 0, cancelId: 4 });
    if (result.response === 0) { restart(); return; }
    if (result.response === 1) await openDirectory(libraryDirectory);
    if (result.response === 2) await openDirectory(app.getPath('logs'));
    if (result.response === 3) {
      try { if (await chooseBackup()) { restart(); return; } }
      catch (failure) { writeDiagnostic(app.getPath('logs'), failure, APP_VERSION); dialog.showErrorBox('恢复未完成', failure instanceof Error ? failure.message : '请选择完整的拾藏资料库备份'); }
    }
    if (result.response === 4) { app.quit(); return; }
  }
}
async function createWindow(){
  main=new BrowserWindow({width:1400,height:920,minWidth:800,minHeight:600,title:'拾藏',backgroundColor:'#fdfdf6',titleBarStyle:process.platform==='darwin'?'hiddenInset':'default',webPreferences:{preload:join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  main.webContents.setWindowOpenHandler(({url})=>{if(/^https?:\/\//.test(url))void shell.openExternal(url);return{action:'deny'};});
  main.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==`http://127.0.0.1:${local.port}`)event.preventDefault();});
  await main.loadURL(`http://127.0.0.1:${local.port}`);
  main.on('closed',()=>{main=null;});
}
if(singleInstance)void app.whenReady().then(async()=>{
  app.setAccessibilitySupportEnabled(true);
  const dataDir=libraryDirectory;
  if (process.argv.includes('--restore-library')) await chooseBackup();
  local=await startService({dataDir,uiDir:join(__dirname,'../ui'),host:'127.0.0.1',port:0,name:'拾藏 · 本机'});
  const localTokenFile=join(app.getPath('userData'),'local-device');
  const localToken=localDeviceToken(localTokenFile,local);
  const localConnection:Connection={url:`http://127.0.0.1:${local.port}`,token:localToken,name:'本机资料库',local:true};
  const connections=new LibraryConnections(app.getPath('userData'),localConnection,safeStorage);
  connection=connections.current();
  if(process.env.SHIZANG_CONNECTION_FILE){
    const setup=validConnection(JSON.parse(readFileSync(process.env.SHIZANG_CONNECTION_FILE,'utf8')));
    const verified=await net.fetch(setup.url+'/api/stats',{credentials:'omit',headers:{Authorization:'Bearer '+setup.token},signal:AbortSignal.timeout(10000)});
    if(!verified.ok)throw new Error('资料库连接配置无法保存');
    connection=connections.select(setup);unlinkSync(process.env.SHIZANG_CONNECTION_FILE);
  }
  collector=new Collector(s=>{main?.webContents.send('sync',s);});
  const preferencesFile=join(app.getPath('userData'),'preferences.json');let rawPreferences:unknown;
  try{rawPreferences=JSON.parse(readFileSync(preferencesFile,'utf8'));}catch{}
  const preferences=loadPreferences(rawPreferences);
  writeFileSync(preferencesFile,JSON.stringify(preferences),{mode:0o600});
  ipcMain.on('preferences:get',event=>{event.returnValue={...preferences};});
  ipcMain.handle('preferences:save',(_,key:string,value:string)=>{if(!validPreference(key,value))throw new Error('设置值无效');if(preferences[key]===value)return;preferences[key]=value;writeFileSync(preferencesFile,JSON.stringify(preferences),{mode:0o600});});
  ipcMain.handle('connection:get',()=>connection);
  ipcMain.handle('connection:saved-remote',()=>connections.savedRemote());
  ipcMain.handle('connection:save',(_,c:Connection|null)=>{
    if(collector.running)throw new Error('请先完成或停止当前任务，再切换资料库');
    connection=connections.select(c);
    return connection;
  });
  ipcMain.handle('x:login',()=>collector.open());ipcMain.handle('x:status',()=>collector.status());
  ipcMain.handle('x:logout',()=>collector.logout());ipcMain.handle('x:stop',()=>collector.stop());
  ipcMain.handle('x:sync',(_,options)=>{
    if(collector.running)throw new Error('已有同步任务');
    if(options?.mode!=='recent')throw new Error('仅支持同步新增收藏和点赞');
    if(!Array.isArray(options.sources)||!options.sources.length||options.sources.some((s:unknown)=>s!=='bookmark'&&s!=='like'))throw new Error('请选择收藏或点赞');
    if(options.automatic&&preferences.autoSync!=='true')throw new Error('打开软件时同步已关闭');
    options.connection=validConnection(options.connection);void collector.sync(options);
  });
  ipcMain.handle('videos:save',(_,ids:string[])=>{
    if(!Array.isArray(ids)||!ids.length||ids.length>1000||ids.some(id=>typeof id!=='string'||!/^\d{1,25}$/.test(id)))throw new Error('请选择需要保存的视频');
    return collector.cacheVideos(connection,ids);
  });
  ipcMain.handle('external',(_,url:string)=>{if(!/^https?:\/\//.test(url))throw new Error('链接格式不正确');return shell.openExternal(url);});
  ipcMain.handle('file:save',async(_,options:{name:string;data:string;encoding?:'utf8'|'base64'})=>{
    const result=await dialog.showSaveDialog(main!,{defaultPath:options.name});if(result.canceled||!result.filePath)return false;
    writeFileSync(result.filePath,options.data,options.encoding??'utf8');return true;
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {label:'拾藏',submenu:[{role:'about'},{type:'separator'},{role:'hide'},{role:'hideOthers'},{type:'separator'},{role:'quit'}]},
    {label:'编辑',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
    {label:'显示',submenu:[{role:'reload'},{role:'togglefullscreen'}]},
    {label:'资料库',submenu:[
      {label:'打开本机资料目录',click:()=>{void openDirectory(libraryDirectory);}},
      {label:'查看升级前备份',click:()=>{void openDirectory(join(libraryDirectory,'backups'));}},
      {label:'打开启动日志目录',click:()=>{void openDirectory(app.getPath('logs'));}},
      {type:'separator'},
      {label:'重启并恢复本机资料库…',click:()=>{if(collector.running)dialog.showErrorBox('任务正在进行', '请先完成或停止同步和视频保存，再恢复资料库。');else restart(true);}}
    ]},
    {role:'windowMenu',label:'窗口'}
  ]));
  app.on('second-instance',()=>{main?.show();main?.focus();});
  await createWindow();
  app.on('activate',()=>{if(!main)void createWindow();});
}).catch(handleStartupFailure);
app.on('window-all-closed',()=>{if(process.platform!=='darwin'&&!startupFailed)app.quit();});
let quitting=false;
app.on('before-quit',event=>{
  if(quitting)return;
  event.preventDefault();quitting=true;
  const sessions=new Set([collector?.session,main&&!main.isDestroyed()?main.webContents.session:undefined]);
  collector?.stop();collector?.window?.destroy();
  const pending=[Promise.resolve(local?.close()),...[...sessions].filter(s=>!!s).map(async s=>{s.flushStorageData();await s.cookies.flushStore();})];
  void Promise.allSettled(pending).then(results=>{
    const failures=results.filter(result=>result.status==='rejected');
    for(const failure of failures)writeDiagnostic(app.getPath('logs'),failure.reason,APP_VERSION);
    app.exit(failures.length?1:0);
  });
});
