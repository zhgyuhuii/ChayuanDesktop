#!/usr/bin/env node
// 察元 一键发布编排(放在仓库根,与 build-desktop.* 同级,跨平台 Node 原生)。
//
// 复用现有设施,不重造:
//   - 版本号:复用 scripts/bump-version.py(真源,同步 VERSION + desktop/installer/publisher
//     的 tauri.conf.json + server pyproject)。本脚本只决策一次版本,然后让 build-desktop
//     带 CHAYUAN_BUILD_NO_BUMP=1 运行,避免二次 +1。
//   - 离线包:复用 build-desktop(.ps1/.sh)(含 Rust/link.exe/node/pnpm/模型清单全套校验、
//     PyInstaller sidecar、ISO),lite -> dist-lite/,standard|pro -> dist-full/(build-desktop 把 integrated 重命名成了 full)。
//
// 本脚本自己只做:① 决策版本(调 bump-version.py)② 调 build-desktop 出离线包
//   ③ 构建上传端(publisher)+ 下载端(installer)④ 收拢到 release/<ver>/{offline,clients}/
//
// 用法(仓库根目录):
//   node release.mjs                  版本 +1 + 离线包(standard)+ 上传端 + 下载端
//   node release.mjs --set 2.0.5      指定版本
//   node release.mjs --no-bump        不改版本
//   node release.mjs --tier lite|standard|pro|all  档位(默认 standard;all=一次出三档)
//   node release.mjs --offline-only   只出离线包
//   node release.mjs --clients-only   只出上传端+下载端(不改版本、不跑 build-desktop)
//   node release.mjs --version-only   只调 bump-version.py 升/写版本
//   node release.mjs --bd "<参数>"    透传给 build-desktop,如 --bd "-SkipModelCheck"
//
// 双击:Windows 用 release.cmd,mac/Linux 用 release.sh。

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));        // 仓库根(= chayuan-desktop)
const CLIENT_ROOT = path.join(ROOT, 'chayuan-client');
const VERSION_FILE = path.join(ROOT, 'VERSION');
const BUMP = path.join(ROOT, 'scripts', 'bump-version.py');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const isWin = process.platform === 'win32';
const PYTHON = process.env.PYTHON || (isWin ? 'python' : 'python3');

function log(m) { console.log(`\n==> ${m}`); }
function run(cmd, cwd, env) { console.log(`  $ ${cmd}`); execSync(cmd, { cwd: cwd || ROOT, stdio: 'inherit', shell: true, env: env || process.env }); }
function capture(cmd, cwd) { return execSync(cmd, { cwd: cwd || ROOT, stdio: ['inherit', 'pipe', 'inherit'], shell: true }).toString(); }

// ---- 版本:复用 scripts/bump-version.py ----
function decideVersion() {
  let flag = '';
  if (has('--set')) flag = `--set ${val('--set', '')}`;
  else if (has('--no-bump') || has('--clients-only')) flag = '--no-bump';  // 只出客户端时不改版本
  const out = capture(`"${PYTHON}" "${BUMP}" ${flag}`.trim());
  const lines = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return lines[lines.length - 1] || fs.readFileSync(VERSION_FILE, 'utf8').trim();
}

// ---- 平台 ----
const platformKey = () => `${isWin ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux'}-${process.arch === 'arm64' ? 'arm64' : 'x86_64'}`;

const OFFLINE_EXTS = ['msi', 'exe', 'deb', 'dmg', 'AppImage', 'tar.gz', 'zip']; // 不含 .iso
const CLIENT_EXTS = ['msi', 'exe', 'deb', 'dmg', 'AppImage'];

function pickByExt(dir, exts) {
  if (!fs.existsSync(dir)) return [];
  const all = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!e.name.endsWith('.app')) walk(p); }
    else { const ext = exts.find((x) => e.name.toLowerCase().endsWith('.' + x.toLowerCase())); if (ext) all.push({ p, ext, m: fs.statSync(p).mtimeMs }); }
  } };
  walk(dir);
  const best = new Map();
  for (const f of all.sort((a, b) => b.m - a.m)) if (!best.has(f.ext)) best.set(f.ext, f);
  return [...best.values()];
}
function copyTo(src, destDir, name) { fs.mkdirSync(destDir, { recursive: true }); const d = path.join(destDir, name); fs.copyFileSync(src, d); return d; }

// build-desktop 调用,带 CHAYUAN_BUILD_NO_BUMP=1(本脚本已决策版本,禁止它再 +1)。
const WIN_FLAVOR_FLAG = { lite: '-LiteOnly', standard: '-StandardOnly', full: '-FullOnly' };
const SH_FLAVOR_FLAG = { lite: '--lite-only', standard: '--standard-only', full: '--integrated-only' };
function runBuildDesktop(flavor) {
  const extra = val('--bd', '');
  const env = { ...process.env, CHAYUAN_BUILD_NO_BUMP: '1' };
  if (isWin) {
    const ps1 = path.join(ROOT, 'build-desktop.ps1');
    const flag = WIN_FLAVOR_FLAG[flavor] || '-FullOnly';
    run(`powershell -NoProfile -ExecutionPolicy Bypass -File "${ps1}" ${flag} ${extra}`, ROOT, env);
  } else {
    const sh = path.join(ROOT, 'build-desktop.sh');
    const flag = SH_FLAVOR_FLAG[flavor] || '--integrated-only';
    run(`bash "${sh}" ${flag} ${extra}`, ROOT, env);
  }
}

// ---- 主流程 ----
const version = decideVersion();
log(`版本(经 scripts/bump-version.py):${version}`);
if (has('--version-only')) { console.log('\n仅写版本号,完成。'); process.exit(0); }

const tier = val('--tier', 'standard');
if (!['lite', 'standard', 'pro', 'all'].includes(tier)) { console.error(`--tier 必须 lite|standard|pro|all`); process.exit(1); }
const tiers = tier === 'all' ? ['lite', 'standard', 'pro'] : [tier];
const TIER_FLAVOR = { lite: 'lite', standard: 'standard', pro: 'full' };
const plat = platformKey();
const RELEASE_DIR = path.join(ROOT, 'release', version);
const OFFLINE_DIR = path.join(RELEASE_DIR, 'offline');
const CLIENTS_DIR = path.join(RELEASE_DIR, 'clients');
const summary = [];

if (!has('--clients-only')) {
  for (const t of tiers) {
    const fl = TIER_FLAVOR[t];
    log(`构建离线包(${plat} / tier=${t} → flavor=${fl},CHAYUAN_BUILD_NO_BUMP=1)`);
    runBuildDesktop(fl);
    const distDir = path.join(ROOT, `dist-${fl}`);
    const arts = pickByExt(distDir, OFFLINE_EXTS);
    if (!arts.length) { console.error(`未在 ${distDir} 找到 ${t} 离线包产物`); process.exit(1); }
    for (const a of arts) {
      const dest = copyTo(a.p, OFFLINE_DIR, `chayuan-${version}-${plat}-${t}.${a.ext}`);
      summary.push(`离线包(${t}): ${path.relative(ROOT, dest)}`);
    }
  }
  summary.push('  提醒: lite=纯云零模型;standard=引擎+必带音色(其余模型用户下载);pro=全部模型离线。各档模型需构建机先 seed(sherpa/voxcpm 音色、字体等)。');
}

if (!has('--offline-only')) {
  for (const [app, label] of [['apps/publisher', '上传端(发布客户端)'], ['apps/installer', '下载端(安装器)']]) {
    log(`构建${label}`);
    run('pnpm tauri build', path.join(CLIENT_ROOT, app));
    const arts = pickByExt(path.join(CLIENT_ROOT, app, 'src-tauri/target/release/bundle'), CLIENT_EXTS);
    if (!arts.length) { console.warn(`  未找到${label}安装器产物`); continue; }
    for (const a of arts) { const dest = copyTo(a.p, CLIENTS_DIR, path.basename(a.p)); summary.push(`${label}: ${path.relative(ROOT, dest)}`); }
  }
}

log('完成');
console.log(`\n版本 ${version} 全部产物: ${path.relative(ROOT, RELEASE_DIR)}/`);
for (const s of summary) console.log('  - ' + s);
console.log('\n下一步:双击 release/' + version + '/clients/ 里「察元发布客户端」-> 登录(用户名/密码/验证码)-> 检测 offline/ -> 上传 -> 发布 -> 生成在线清单。');
console.log('用户侧:运行下载端按档下载,或直接下 offline/ 离线包安装。');
