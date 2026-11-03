// 发布新版本：npm run release -- 1.1.0
// 改版本号 → 构建前端 → 打包并上传到 GitHub Releases（附带 latest.yml，已安装的软件据此检测更新）
// 更新说明写在 build/release-notes.md（可选），会同时显示在 Release 页面和软件的更新提示里
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const run = (cmd, env) => execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...env } });
const fail = (msg) => { console.error(`\n✗ ${msg}\n`); process.exit(1); };

const version = process.argv[2];
if (version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`版本号格式应为 x.y.z，收到：${version}`);
  run(`npm version ${version} --no-git-tag-version --allow-same-version`);
}
const { version: current } = JSON.parse(fs.readFileSync('package.json', 'utf8'));

let exists = false;
try { execSync(`gh release view v${current}`, { stdio: 'ignore' }); exists = true; } catch { /* 尚未发布 */ }
if (exists) fail(`v${current} 已经发布过了，请指定新的版本号：npm run release -- x.y.z`);

// 版本号和更新说明先提交推送，Release 的标签指向这次提交
const NOTES = 'build/release-notes.md';
const hasNotes = fs.existsSync(NOTES) && fs.readFileSync(NOTES, 'utf8').trim();
run(`git add package.json package-lock.json${hasNotes ? ` ${NOTES}` : ''}`);
try { execSync('git diff --cached --quiet'); } catch { run(`git commit -m "发布 ${current}"`); }
run('git push');
const sha = execSync('git rev-parse HEAD').toString().trim();

// electron-builder 只负责打包（同时生成 latest.yml），由 gh 一次性创建 Release 并上传全部文件：
// 让 electron-builder 直接上传时，安装包和 blockmap 会各自创建一个 Release，互相冲突
run('npx vite build');
run('npx electron-builder --win nsis --publish never');
const files = [`MyZotero-Setup-${current}.exe`, `MyZotero-Setup-${current}.exe.blockmap`, 'latest.yml'].map((f) => `"release/${f}"`).join(' ');
run(`gh release create v${current} ${files} --target ${sha} --title "我的 Zotero ${current}" --latest ${hasNotes ? `--notes-file ${NOTES}` : '--notes ""'}`);
console.log(`\n✓ v${current} 已发布。已安装的软件启动时会提示更新。\n`);
