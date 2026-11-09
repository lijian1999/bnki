#!/usr/bin/env node
// 制作 Windows 免安装便携包：node.exe + 源码 + 生产依赖 + 前端构建产物 + 双击启动器。
// 用法：node scripts/package-windows.mjs   （在 macOS/Linux 开发机上运行，需要联网）
// 产物：dist-windows/bnki-windows.zip

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'dist-windows');
const stage = path.join(outDir, 'bnki');
const nodeVersion = process.version; // 与开发机一致，保证和测试过的运行时相同

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: opts.quiet ? 'pipe' : 'inherit', cwd: opts.cwd ?? root, ...opts.env ? { env: { ...process.env, ...opts.env } } : {} });
}

function download(urls, dest) {
  for (const url of urls) {
    console.log(`下载 ${url}`);
    try {
      run('curl', ['-fSL', '--retry', '2', '-o', dest, url], { quiet: true });
      if (fs.statSync(dest).size > 1024 * 1024) return;
      fs.rmSync(dest, { force: true });
    } catch {}
    console.log('该源失败，换下一个源');
  }
  throw new Error(`下载失败：${dest}，请检查网络后重试`);
}

// ── 第 1 步：构建前端 ──
console.log('── 构建前端 ──');
run('npm', ['run', 'build', '-w', 'web']);

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
const app = path.join(stage, 'app');
fs.mkdirSync(app, { recursive: true });
fs.mkdirSync(path.join(stage, 'data'), { recursive: true });

// ── 第 2 步：复制源码（只带运行需要的部分，根 package.json 裁掉 web workspace，避免打进去一整套前端依赖）──
console.log('── 复制源码与依赖 ──');
for (const dir of ['shared', 'server']) {
  fs.cpSync(path.join(root, dir), path.join(app, dir), { recursive: true, filter: (s) => !s.includes('node_modules') });
}
fs.cpSync(path.join(root, 'web/dist'), path.join(app, 'web', 'dist'), { recursive: true });
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
pkg.workspaces = ['shared', 'server'];
fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify(pkg, null, 2));

// ── 第 3 步：安装 Windows 平台的生产依赖（--os/--cpu 让 esbuild 拿到 win32 二进制；
// better-sqlite3 v13 的包内自带全平台 prebuilds，无需额外处理；--ignore-scripts 跳过与本机平台相关的安装脚本）──
run('npm', ['install', '--omit=dev', '--ignore-scripts', '--os=win32', '--cpu=x64', '--no-audit', '--no-fund'], { cwd: app });

// npm workspace 链接是符号链接，zip 解到 Windows 会丢；换成真实目录（tsx 能转换 node_modules 里的 TS，已验证）
const linked = path.join(app, 'node_modules', '@bnki', 'shared');
fs.rmSync(linked, { recursive: true, force: true });
fs.cpSync(path.join(app, 'shared'), linked, { recursive: true });

// ── 第 4 步：下载 Windows 版 node.exe ──
console.log('── 下载 node.exe ──');
const nodeZip = path.join(outDir, `node-v${nodeVersion.slice(1)}-win-x64.zip`);
download(
  [
    `https://nodejs.org/dist/v${nodeVersion.slice(1)}/node-v${nodeVersion.slice(1)}-win-x64.zip`,
    `https://registry.npmmirror.com/-/binary/node/v${nodeVersion.slice(1)}/node-v${nodeVersion.slice(1)}-win-x64.zip`,
  ],
  nodeZip,
);
run('unzip', ['-j', '-o', nodeZip, '*/node.exe', '-d', stage], { quiet: true });

// ── 第 5 步：启动器 ──
fs.writeFileSync(
  path.join(stage, 'bnki-server.cmd'),
  [
    '@echo off',
    'rem 后台服务入口，由 启动bnki.vbs 以无窗口方式调用；日志写到包根目录 bnki.log',
    'cd /d "%~dp0app"',
    '"..\\node.exe" "node_modules\\tsx\\dist\\cli.mjs" "server\\src\\cli.ts" --port 18420 --data ../data --web web/dist > ..\\bnki.log 2>&1',
    '',
  ].join('\r\n'),
);

fs.writeFileSync(
  path.join(stage, '启动bnki.vbs'),
  [
    "' 双击启动 bnki：后台起服务，等它就绪后自动打开浏览器",
    "Set shell = CreateObject(\"WScript.Shell\")",
    "Set fso = CreateObject(\"Scripting.FileSystemObject\")",
    "shell.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)",
    "shell.Run \"bnki-server.cmd\", 0, False",
    "Dim http, ok",
    "ok = False",
    "For i = 1 To 40",
    "  WScript.Sleep 500",
    "  On Error Resume Next",
    "  Set http = CreateObject(\"MSXML2.XMLHTTP\")",
    "  http.open \"GET\", \"http://127.0.0.1:18420/\", False",
    "  http.send",
    "  If Err.Number = 0 Then",
    "    If http.status = 200 Then",
    "      ok = True",
    "      Exit For",
    "    End If",
    "  End If",
    "  On Error GoTo 0",
    "Next",
    "If ok Then",
    "  shell.Run \"http://127.0.0.1:18420/\"",
    "Else",
    "  MsgBox \"bnki 启动失败，请把文件夹里的 bnki.log 发给维护者。\", 16, \"bnki\"",
    "End If",
    "",
  ].join('\r\n'),
);

fs.writeFileSync(
  path.join(stage, '关闭bnki.cmd'),
  [
    '@echo off',
    'rem 只结束 bnki 自己的 node 进程（按命令行特征匹配），不影响别的程序',
    `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='node.exe'\\" | Where-Object { $_.CommandLine -like '*tsx*cli.mjs*server*cli.ts*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`,
    'echo bnki 已关闭',
    'pause',
    '',
  ].join('\r\n'),
);

fs.writeFileSync(
  path.join(stage, '使用说明.txt'),
  [
    'bnki 卡片复习系统（Windows 免安装版）',
    '========================================',
    '',
    '每天使用：',
    '  1. 双击「启动bnki.vbs」，等几秒会自动打开浏览器进入复习页面。',
    '  2. 用完想彻底退出：双击「关闭bnki.cmd」。（不关也不影响电脑，只是它在后台驻留）',
    '',
    '建议：右键「启动bnki.vbs」→ 发送到 → 桌面快捷方式，以后从桌面点就行。',
    '',
    '数据保存在哪里：',
    '  全部在这个文件夹的 data 子目录里（bnki.sqlite 数据库、media 图片、backups 自动备份）。',
    '  整个文件夹可以随意拷贝、改名、移动到别的电脑，数据跟着走。',
    '',
    '常见问题：',
    '  - 双击没反应或提示启动失败：看看文件夹里的 bnki.log，把它发给维护者。',
    '  - 杀毒软件拦截：这是正常的（本软件未做数字签名），选择「仍要运行」即可。',
    '  - 关机前不需要特别操作，数据是实时保存的。',
    '',
  ].join('\r\n'),
);

// ── 第 6 步：压缩 ──
console.log('── 生成 zip ──');
run('find', ['.', '-name', '.DS_Store', '-delete'], { cwd: stage, quiet: true });
const zipPath = path.join(outDir, 'bnki-windows.zip');
fs.rmSync(zipPath, { force: true });
run('zip', ['-r', '-q', zipPath, '.'], { cwd: stage });

const mb = (n) => `${(fs.statSync(n).size / 1024 / 1024).toFixed(1)} MB`;
function dirSize(dir) {
  let total = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    total += e.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return total;
}
console.log(`完成：dist-windows/bnki-windows.zip（${mb(zipPath)}，解压后约 ${(dirSize(stage) / 1024 / 1024).toFixed(1)} MB）`);