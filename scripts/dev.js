// 同时启动后端 API 与 Vite 开发服务器
import { spawn } from 'node:child_process';
const run = (cmd, args) => spawn(cmd, args, { stdio: 'inherit', shell: true });
const api = run('node', ['--no-warnings', '--watch-path=server', '--watch-path=shared', 'server/index.js']);
const web = run('npx', ['vite']);
const stop = () => { api.kill(); web.kill(); process.exit(); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
