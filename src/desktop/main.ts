import { app, BrowserWindow, dialog, ipcMain, Menu, net, safeStorage, shell } from 'electron';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { startService } from '../server/service';
import { Collector } from './collector';
import { loadPreferences, validPreference } from './preferences';
import { LibraryConnections, validConnection } from './connections';
import type { Connection } from '../shared/types';

if(process.env.SHIZANG_USER_DATA)app.setPath('userData',process.env.SHIZANG_USER_DATA);
app.setName('拾藏');
if(!app.requestSingleInstanceLock())app.quit();
let main:BrowserWindow|null=null;let collector:Collector;let local:Awaited<ReturnType<typeof startService>>;let connection:Connection;
async function createWindow(){
  main=new BrowserWindow({width:1400,height:920,minWidth:800,minHeight:600,title:'拾藏',backgroundColor:'#fdfdf6',titleBarStyle:process.platform==='darwin'?'hiddenInset':'default',webPreferences:{preload:join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  main.webContents.setWindowOpenHandler(({url})=>{if(/^https?:\/\//.test(url))void shell.openExternal(url);return{action:'deny'};});
  main.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==`http://127.0.0.1:${local.port}`)event.preventDefault();});
  await main.loadURL(`http://127.0.0.1:${local.port}`);
  main.on('closed',()=>{main=null;});
}
void app.whenReady().then(async()=>{
  app.setAccessibilitySupportEnabled(true);
  const dataDir=join(app.getPath('userData'),'library');
  local=await startService({dataDir,uiDir:join(__dirname,'../ui'),host:'127.0.0.1',port:0,name:'拾藏 · 本机'});
  const localTokenFile=join(app.getPath('userData'),'local-device');
  const localToken=existsSync(localTokenFile)?readFileSync(localTokenFile,'utf8'):local.createDevice('这台电脑');
  if(!existsSync(localTokenFile))writeFileSync(localTokenFile,localToken,{mode:0o600});
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
    {role:'windowMenu',label:'窗口'}
  ]));
  app.on('second-instance',()=>{main?.show();main?.focus();});
  await createWindow();
  app.on('activate',()=>{if(!main)void createWindow();});
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
app.on('before-quit',()=>{collector?.stop();collector?.window?.destroy();local?.server.close();});
