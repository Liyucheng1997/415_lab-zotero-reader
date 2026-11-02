@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist node_modules call npm install
if not exist dist call npx vite build
start "" http://localhost:5417
node --no-warnings server/index.js
