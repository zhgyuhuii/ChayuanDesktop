#!/usr/bin/env node
// 察元 一键构建发布脚本(跨平台,Node 原生,无外部依赖)。
//
// 作用:① 升版本号(默认末位 +1)② 构建当前平台的离线安装包(桌面产品)
//      ③ 改名为 publisher 识别的规约名 ④ 构建上传端(publisher)与下载端(installer)
//      ⑤ 全部产物收拢到 release/<版本>/ 一个文件夹,便于管理与运行。
//
// 用法(在 chayuan-client 目录下):
//   node scripts/release.mjs                 升版本(+1)+ 构建离线包(standard)+ 两个客户端
//   node scripts/release.mjs --set 2.0.1     指定版本号
//   node scripts/release.mjs --no-bump       不改版本,用当前版本构建
//   node scripts/release.mjs --tier pro      离线包档位 lite|standard|pro(默认 standard)
//   node scripts/release.mjs --offline-only  只构建离线安装包
//   node scripts/release.mjs --clients-only  只构建上传端+下载端
//   node scripts/release.mjs --version-only   只升/写版本号,不构建
//
// 注意:构建 Tauri 需要可用的 Rust 工具链;Windows 若被 Smart App Control/WDAC 拦截
//       (os error 4551),先按文档放行再构建。pro 档的"含模型"需另跑 chayuan-server
//       打包(见文档),本脚本只负责客户端 bundle 与改名收拢。

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.resolve(SCRIPT_DIR, '..');          // chayuan-client
const DESKTOP_ROOT = path.resolve(CLIENT_ROOT, '..');        // chayuan-desktop(git 仓根)
const VERSION_FILE = path.join(DESKTOP_ROOT, 'VERSION');
const TAURI_CONFS = [
  path.join(CLIENT_ROOT, 'apps/desktop/src-tauri/tauri.conf.json'),
  path.join(CLIENT_ROOT, 'apps/installer/src-tauri/tauri.conf.json'),
  path.join(CLIENT_ROOT, 'apps/publisher/src-tauri/tauri.conf.json'),
];

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

function log(msg) { console.log(`\n▶ ${msg}`); }
function run(cmd, cwd) {
  console.log(`  $ ${cmd}  (cwd: ${path.relative(DESKTOP_ROOT, cwd) || '.'})`);
  execSync(cmd, { cwd, stdio: 'inherit', shell: true });
}

// ---- 版本 ----
function readVersion() {
  try { return fs.readFileSync(VERSION_FILE, 'utf8').trim(); } catch { return '2.0.0'; }
}
function bumpPatch(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(v);
  if (!m) return '2.0.1';
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}
function writeVersion(v) {
  fs.writeFileSync(VERSION_FILE, v + '\n');
  for (const f of TAURI_CONFS) {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    j.version = v;
    fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
  }
  console.log(`  版本号已写入 VERSION + ${TAURI_CONFS.length} 个 tauri.conf.json -> ${v}`);
}

// ---- 平台 ----
function platformKey() {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
  const osk = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
  return `${osk}-${arch}`;
}

// 递归找 bundle 目录里最新的指定后缀产物。
function findArtifact(bundleDir, exts) {
  if (!fs.existsSync(bundleDir)) return null;
  const found = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!e.name.endsWith('.app')) walk(p); }
      else { const ext = exts.find((x) => e.name.toLowerCase().endsWith('.' + x.toLowerCase())); if (ext) found.push({ p, ext, mtime: fs.statSync(p).mtimeMs }); }
    }
  };
  walk(bundleDir);
  found.sort((a, b) => b.mtime - a.mtime);
  return found[0] ?? null;
}

const OFFLINE_EXTS = ['msi', 'exe', 'deb', 'dmg', 'AppImage', 'tar.gz', 'zip'];
const CLIENT_EXTS = ['msi', 'exe', 'deb', 'dmg', 'AppImage'];

function copyTo(srcFile, destDir, destName) {
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, destName);
  fs.copyFileSync(srcFile, dest);
  return dest;
}

// ---- 主流程 ----
const version = has('--set') ? val('--set', readVersion())
  : has('--no-bump') ? readVersion()
  : bumpPatch(readVersion());

log(`目标版本:${version}`);
writeVersion(version);
if (has('--version-only')) { console.log('\n✓ 仅写版本号,完成。'); process.exit(0); }

const tier = val('--tier', 'standard');
if (!['lite', 'standard', 'pro'].includes(tier)) { console.error(`--tier 必须是 lite|standard|pro,收到 ${tier}`); process.exit(1); }
const plat = platformKey();
const RELEASE_DIR = path.join(DESKTOP_ROOT, 'release', version);
const OFFLINE_DIR = path.join(RELEASE_DIR, 'offline');
const CLIENTS_DIR = path.join(RELEASE_DIR, 'clients');

const summary = [];

if (!has('--clients-only')) {
  log(`构建离线安装包(${plat} / ${tier})`);
  if (tier === 'lite') run('pnpm --filter @chayuan/desktop build:thin', CLIENT_ROOT);
  else run('pnpm run build:desktop:full', CLIENT_ROOT);
  const bundleDir = path.join(CLIENT_ROOT, 'apps/desktop/src-tauri/target/release/bundle');
  const art = findArtifact(bundleDir, OFFLINE_EXTS);
  if (!art) { console.error(`未在 ${bundleDir} 找到离线包产物`); process.exit(1); }
  const name = `chayuan-${version}-${plat}-${tier}.${art.ext}`;
  const dest = copyTo(art.p, OFFLINE_DIR, name);
  summary.push(`离线安装包: ${path.relative(DESKTOP_ROOT, dest)}`);
  if (tier === 'pro') summary.push('  提醒: pro 含模型需另跑 chayuan-server 打包并把模型并入 sidecar(见文档)');
}

if (!has('--offline-only')) {
  for (const [appDir, label] of [['apps/publisher', '上传端(发布客户端)'], ['apps/installer', '下载端(安装器)']]) {
    log(`构建${label}`);
    run('pnpm tauri build', path.join(CLIENT_ROOT, appDir));
    const bundleDir = path.join(CLIENT_ROOT, appDir, 'src-tauri/target/release/bundle');
    const art = findArtifact(bundleDir, CLIENT_EXTS);
    if (!art) { console.warn(`  未找到${label}产物(可能仅生成可执行文件,未打 bundle)`); continue; }
    const dest = copyTo(art.p, CLIENTS_DIR, path.basename(art.p));
    summary.push(`${label}: ${path.relative(DESKTOP_ROOT, dest)}`);
  }
}

log('完成');
console.log(`\n版本 ${version} 全部产物在: ${path.relative(DESKTOP_ROOT, RELEASE_DIR)}/`);
for (const s of summary) console.log('  - ' + s);
console.log('\n下一步:双击 clients/ 里的「察元发布客户端」-> 登录(用户名/密码/验证码)-> 检测 offline/ 目录 -> 上传 -> 发布 -> 生成在线清单。');
console.log('用户侧:运行「察元下载客户端/安装器」按档下载,或直接下载 offline/ 里的离线包安装。');
