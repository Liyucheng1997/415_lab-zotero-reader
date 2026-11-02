// 桌面版入口：在主进程内启动本地服务，再打开窗口
import { app, BrowserWindow, shell, ipcMain, Menu, nativeTheme } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const DESKTOP_PORT = 5418; // 固定端口：localStorage 按端口区分，换端口会丢失界面设置

// 用户数据统一放在 %APPDATA%\MyZotero（否则会按 npm 包名落到 my-zotero）
app.setName('MyZotero');
app.setPath('userData', path.join(app.getPath('appData'), 'MyZotero'));

if (!app.requestSingleInstanceLock()) app.quit();

// 打包后数据放在用户目录；开发时沿用项目里的 data/
process.env.MYZOTERO_DATA ||= app.isPackaged ? path.join(app.getPath('userData'), 'data') : path.join(ROOT, 'data');
fs.mkdirSync(process.env.MYZOTERO_DATA, { recursive: true });

const THEMES = {
  light: { color: '#f5f5f7', symbolColor: '#1d1d1f' },
  dark: { color: '#000000', symbolColor: '#f5f5f7' },
};

let win;
let origin;

async function startServer() {
  const { start } = await import('../server/index.js');
  try {
    return await start(DESKTOP_PORT);
  } catch {
    return start(0); // 端口被占用时退而求其次
  }
}

function createWindow() {
  const dark = nativeTheme.shouldUseDarkColors;
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: '我的 Zotero',
    show: false,
    backgroundColor: dark ? '#000000' : '#f5f5f7',
    icon: path.join(ROOT, 'build', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { ...THEMES[dark ? 'dark' : 'light'], height: 52 },
    webPreferences: { preload: path.join(here, 'preload.cjs'), spellcheck: false },
  });
  win.once('ready-to-show', () => win.show());
  win.loadURL(origin);
  // 自检截图：MZ_SNAPSHOT=输出路径 时，加载完成后保存窗口截图
  if (process.env.MZ_SNAPSHOT) {
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      fs.writeFileSync(process.env.MZ_SNAPSHOT, (await win.webContents.capturePage()).toPNG());
    }, 4000));
  }

  // 站内地址（附件等）开新窗口，外部链接交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(origin)) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, icon: path.join(ROOT, 'build', 'icon.png') } };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(origin)) { e.preventDefault(); shell.openExternal(url); }
  });

  // 输入框与选中文字的右键菜单（应用自己的右键菜单会阻止默认事件，不会冲突）
  win.webContents.on('context-menu', (e, p) => {
    if (!p.isEditable && !p.selectionText) return;
    Menu.buildFromTemplate(p.isEditable
      ? [{ role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' }, { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' }]
      : [{ role: 'copy', label: '复制' }]).popup();
  });

  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12') win.webContents.toggleDevTools();
    if (input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r' && input.shift)) win.webContents.reloadIgnoringCache();
  });
}

ipcMain.on('mz:theme', (e, dark) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  try { w?.setTitleBarOverlay(THEMES[dark ? 'dark' : 'light']); } catch { /* 无覆盖层的窗口 */ }
  w?.setBackgroundColor(dark ? '#000000' : '#f5f5f7');
});

app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  const port = await startServer();
  origin = `http://localhost:${port}`;
  createWindow();
});

app.on('window-all-closed', () => app.quit());
