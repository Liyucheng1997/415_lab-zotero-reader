// 向页面暴露少量桌面能力
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mzDesktop', {
  platform: process.platform,
  setTheme: (dark) => ipcRenderer.send('mz:theme', !!dark),
  update: {
    state: () => ipcRenderer.invoke('mz:update-state'),
    check: () => ipcRenderer.invoke('mz:update-check'),
    download: () => ipcRenderer.invoke('mz:update-download'),
    install: () => ipcRenderer.invoke('mz:update-install'),
    onChange: (fn) => {
      const h = (e, s) => fn(s);
      ipcRenderer.on('mz:update', h);
      return () => ipcRenderer.removeListener('mz:update', h);
    },
  },
});
