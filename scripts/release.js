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

let published = false;
try { execSync(`gh release view v${current}`, { stdio: 'ignore' }); published = true; } catch { /* 尚未发布 */ }
if (published) fail(`v${current} 已经发布过了，请指定新的版本号：npm run release -- x.y.z`);

// 上传用有写权限的令牌：优先 GH_TOKEN，否则取 gh 命令行的登录令牌
const ghToken = process.env.GH_TOKEN || execSync('gh auth token').toString().trim();
run('npx vite build');
run('npx electron-builder --win nsis --publish always', { GH_TOKEN: ghToken });
console.log(`\n✓ v${current} 已发布。已安装的软件启动时会提示更新。\n`);
