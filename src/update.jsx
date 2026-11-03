// 软件更新（仅桌面版）：主进程负责检查与下载，这里负责提示
import { create } from 'zustand';
import { ArrowDownToLine, RotateCw } from 'lucide-react';
import { Modal, openDialog, toast } from './ui/overlay.jsx';
import { useStore } from './store.js';

const bridge = window.mzDesktop?.update;
export const useUpdate = create(() => ({ status: 'unsupported' }));

let manual = false; // 手动检查时才提示「已是最新版本」和错误
let dialogOpen = false;
let prompted = null; // 本次运行已弹过提示的版本

export function openUpdateDialog() {
  if (dialogOpen) return;
  dialogOpen = true;
  openDialog(UpdateDialog).then(() => { dialogOpen = false; });
}

export function checkForUpdates(isManual = true) {
  if (!bridge) return;
  manual = isManual;
  bridge.check();
}

let inited = false;
export function initUpdater() {
  if (!bridge || inited) return;
  inited = true;
  bridge.state().then((s) => useUpdate.setState(s, true));
  bridge.onChange((s) => {
    useUpdate.setState(s, true);
    if (s.status === 'available' && (manual || prompted !== s.version)) {
      const skipped = !manual && useStore.getState().prefs.skipVersion === s.version;
      if (!skipped) { prompted = s.version; openUpdateDialog(); }
    }
    if (manual && s.status === 'latest') toast(`已是最新版本 v${s.current}`, 'success');
    if (manual && s.status === 'error') toast(`检查更新失败：${s.error}`, 'error', 5000);
    if (s.status !== 'checking') manual = false;
  });
  if (useStore.getState().prefs.autoUpdate) setTimeout(() => checkForUpdates(false), 4000);
}

function UpdateDialog({ close }) {
  const u = useUpdate();
  const { setPrefs } = useStore.getState();
  const later = <button className="btn" onClick={() => close()}>稍后</button>;
  let body, footer;
  if (u.status === 'downloading') {
    body = <>
      <div className="modal-msg">正在下载 v{u.version}…</div>
      <div className="update-progress"><div style={{ width: `${u.percent || 0}%` }} /></div>
      <div className="setting-desc">{u.percent || 0}%　可以关闭此窗口，下载会在后台继续。</div>
    </>;
    footer = <button className="btn" onClick={() => close()}>后台下载</button>;
  } else if (u.status === 'downloaded') {
    body = <div className="modal-msg">v{u.version} 已下载完成。重启软件即可完成更新，文库数据不受影响。{'\n'}如果选择稍后，会在下次退出软件时自动安装。</div>;
    footer = <>{later}<button className="btn btn-primary" onClick={() => bridge.install()}><RotateCw size={14} />立即重启</button></>;
  } else if (u.status === 'error') {
    body = <div className="modal-msg">更新失败：{u.error}</div>;
    footer = <>{later}<button className="btn btn-primary" onClick={() => checkForUpdates()}>重试</button></>;
  } else {
    body = <>
      <div className="modal-msg">新版本 v{u.version} 已发布，当前版本 v{u.current}。</div>
      {u.notes && <div className="update-notes">{u.notes}</div>}
    </>;
    footer = <>
      <button className="btn" style={{ marginRight: 'auto' }} onClick={() => { setPrefs({ skipVersion: u.version }); close(); }}>跳过此版本</button>
      {later}
      <button className="btn btn-primary" onClick={() => bridge.download()}><ArrowDownToLine size={14} />下载并安装</button>
    </>;
  }
  return <Modal title="软件更新" close={close} className="dlg-mid" footer={footer}>{body}</Modal>;
}

// 标题栏提示：有新版本或已下载待安装时显示
export function UpdateButton() {
  const u = useUpdate();
  const skip = useStore((s) => s.prefs.skipVersion);
  const show = (u.status === 'available' && u.version !== skip) || u.status === 'downloading' || u.status === 'downloaded';
  if (!show) return null;
  const label = u.status === 'downloaded' ? '重启以更新' : u.status === 'downloading' ? `下载中 ${u.percent || 0}%` : '有新版本';
  return <button className="tb-update" onClick={openUpdateDialog}><ArrowDownToLine size={13} strokeWidth={2} />{label}</button>;
}
