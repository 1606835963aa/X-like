import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, shell } from 'electron';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { startService } from '../server/service';
import { Collector } from './collector';
import type { Connection } from '../shared/types';

if(process.env.SHIZANG_USER_DATA)app.setPath('userData',process.env.SHIZANG_USER_DATA);
app.setName('拾藏');
if(!app.requestSingleInstanceLock())app.quit();
let main:BrowserWindow|null=null;let collector:Collector;let local:Awaited<ReturnType<typeof startService>>;let connection:Connection;
const validConnection=(c:Connection)=>{const u=new URL(c.url);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw new Error('请输入资料库的 HTTP 或 HTTPS 地址');c.url=u.origin;if(c.token.length<20)throw new Error('连接凭证不完整');return c;};
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
  const connectionFile=join(app.getPath('userData'),'connection.enc');
  connection=localConnection;
  if(existsSync(connectionFile)&&safeStorage.isEncryptionAvailable()){try{const saved=validConnection(JSON.parse(safeStorage.decryptString(readFileSync(connectionFile))));connection=saved.local||(saved.name==='本机资料库'&&new URL(saved.url).hostname==='127.0.0.1')?localConnection:saved;}catch{}}
  if(process.env.SHIZANG_CONNECTION_FILE){
    const setup=validConnection(JSON.parse(readFileSync(process.env.SHIZANG_CONNECTION_FILE,'utf8')));
    const verified=await fetch(setup.url+'/api/stats',{headers:{Authorization:'Bearer '+setup.token},signal:AbortSignal.timeout(10000)});
    if(!verified.ok||!safeStorage.isEncryptionAvailable())throw new Error('资料库连接配置无法保存');
    connection=setup;writeFileSync(connectionFile,safeStorage.encryptString(JSON.stringify(setup)),{mode:0o600});unlinkSync(process.env.SHIZANG_CONNECTION_FILE);
  }
  collector=new Collector(s=>{main?.webContents.send('sync',s);});
  const preferencesFile=join(app.getPath('userData'),'preferences.json');let preferences:Record<string,string>={};
  const allowedPreferences:Record<string,string[]>={theme:['light','dark'],layout:['grid','list'],autoSync:['true','false']};
  try{const raw=JSON.parse(readFileSync(preferencesFile,'utf8'));for(const key of Object.keys(allowedPreferences))if(allowedPreferences[key].includes(raw[key]))preferences[key]=raw[key];}catch{}
  ipcMain.on('preferences:get',event=>{event.returnValue={...preferences};});
  ipcMain.handle('preferences:save',(_,key:string,value:string)=>{if(!allowedPreferences[key]?.includes(value))throw new Error('设置值无效');if(preferences[key]===value)return;preferences[key]=value;writeFileSync(preferencesFile,JSON.stringify(preferences),{mode:0o600});});
  ipcMain.handle('connection:get',()=>connection);
  ipcMain.handle('connection:save',(_,c:Connection|null)=>{
    connection=c?validConnection(c):localConnection;
    if(connection.local){if(existsSync(connectionFile))unlinkSync(connectionFile);}else if(safeStorage.isEncryptionAvailable())writeFileSync(connectionFile,safeStorage.encryptString(JSON.stringify(connection)),{mode:0o600});
    return connection;
  });
  ipcMain.handle('x:login',()=>collector.open());ipcMain.handle('x:status',()=>collector.status());
  ipcMain.handle('x:logout',()=>collector.logout());ipcMain.handle('x:stop',()=>collector.stop());
  ipcMain.handle('x:sync',(_,options)=>{if(collector.running)throw new Error('已有同步任务');validConnection(options.connection);void collector.sync(options);});
  ipcMain.handle('media:save',(_,ids?:string[],originals=false)=>collector.cache(connection,ids,originals));
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
