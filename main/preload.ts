import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  send: (channel: string, data: any) => ipcRenderer.send(channel, data),
  receive: (channel: string, fn: Function) => {
    ipcRenderer.on(channel, (_event, ...args) => fn(...args));
  },
});
