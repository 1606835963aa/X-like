import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge } from '../shared/types';
const bridge: DesktopBridge = {
  preferences:ipcRenderer.sendSync('preferences:get'),savePreference:(key,value)=>ipcRenderer.invoke('preferences:save',key,value),
  platform: process.platform,
  connection: () => ipcRenderer.invoke('connection:get'), saveConnection: c => ipcRenderer.invoke('connection:save',c),
  xStatus: () => ipcRenderer.invoke('x:status'), loginX: () => ipcRenderer.invoke('x:login'),
  sync: options => ipcRenderer.invoke('x:sync',options), stopSync: () => ipcRenderer.invoke('x:stop'),
  logoutX: () => ipcRenderer.invoke('x:logout'),
  saveVideos: ids => ipcRenderer.invoke('videos:save',ids),
  openExternal: url => ipcRenderer.invoke('external',url), saveFile: options => ipcRenderer.invoke('file:save',options),
  onSync: callback => { const handler=(_:unknown,data:any)=>callback(data);ipcRenderer.on('sync',handler);return()=>ipcRenderer.removeListener('sync',handler); }
};
contextBridge.exposeInMainWorld('shizang',bridge);
