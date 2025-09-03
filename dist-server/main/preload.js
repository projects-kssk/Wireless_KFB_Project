import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('electronAPI', {
    send: (channel, data) => ipcRenderer.send(channel, data),
    receive: (channel, fn) => {
        ipcRenderer.on(channel, (_event, ...args) => fn(...args));
    },
});
