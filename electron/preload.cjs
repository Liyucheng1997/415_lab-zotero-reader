// 向页面暴露少量桌面能力
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mzDesktop', {
  platform: process.platform,
  setTheme: (dark) => ipcRenderer.send('mz:theme', !!dark),
});
