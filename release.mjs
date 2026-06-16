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
//   node release.mjs                  离线包(用当前 VERSION,不 bump)+ 上传端 + 下载端
//   node release.mjs --set 2.0.5      指定版本
//   node release.mjs --no-bump        不改版本(已是默认)
//   node release.mjs --bump          本次构建 +1(默认不 bump;版本号通常在 commit 时 +1)
//   node release.mjs --tier lite|standard|pro|all  档位(默认 all=一次出三档;也可指定单档)
//   node release.mjs --offline-only   只出离线包
//   node release.mjs --clients-only   只出上传端+下载端(不改版本、不跑 build-desktop)
//   node release.mjs --version-only   只调 bump-version.py 升/写版本
//   node release.mjs --bd "<参数>"    透传给 build-desktop,如 --bd "-SkipModelCheck"
//   node release.mjs --keep-iso      保留根目录原 ISO(默认拷进 release/offline 后删,省盘)
//   node release.mjs --keep-dist     保留 dist-{flavor} 中间产物(默认收进 release/ 后删,避免双份)
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
  // 默认不 bump:构建用当前 VERSION(同一份代码多次构建版本不变)。版本号跟着「提交代码」
  // 走 —— 在 commit 时 bump-version +1,不在每次编译时 +1。显式 --bump 才让本次构建 +1。
  let flag = '--no-bump';
  if (has('--set')) flag = `--set ${val('--set', '')}`;
  else if (has('--bump')) flag = '';  // 显式要求构建时 +1
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

// ---- 磁盘空间预检(WiX light.exe 在盘满时静默失败、无报错;三档 full 包占用叠加易耗尽) ----
function freeGB(dir) {
  try { const st = fs.statfsSync(dir); return (st.bsize * st.bavail) / (1024 ** 3); }
  catch { return null; }  // 旧 Node 无 statfsSync → 跳过预检(不阻断)
}
function requireFreeGB(dir, needGB, label) {
  const free = freeGB(dir);
  if (free == null) { console.warn(`  [release] 无法检测磁盘空间,跳过预检(${dir})`); return; }
  console.log(`  磁盘剩余 ${free.toFixed(1)}GB(${label} 约需 ${needGB}GB)`);
  if (free < needGB) {
    const root = path.parse(path.resolve(dir)).root;
    console.error(`\n[release] 磁盘空间不足:${root} 仅剩 ${free.toFixed(1)}GB,${label}约需 ${needGB}GB。`);
    console.error(`         WiX light.exe / ISO 制作在盘满时会「静默失败」(一行报错都没有)。`);
    console.error(`         清理磁盘后重试,或用 --tier 分档单独构建以降低峰值占用。`);
    process.exit(1);
  }
}
const TIER_FREE_GB = { lite: 4, standard: 8, pro: 12 };
const CLIENT_FREE_GB = 8;  // 客户端要 Rust release 编译 + WiX 临时;3GB 太低(盘满时 light.exe 静默失败),提到 8

// build-desktop 调用,带 CHAYUAN_BUILD_NO_BUMP=1(本脚本已决策版本,禁止它再 +1)。
const WIN_FLAVOR_FLAG = { lite: '-LiteOnly', standard: '-StandardOnly', full: '-FullOnly' };
const SH_FLAVOR_FLAG = { lite: '--lite-only', standard: '--standard-only', full: '--integrated-only' };
function runBuildDesktop(flavor, reuse) {
  const extra = val('--bd', '');
  const env = { ...process.env, CHAYUAN_BUILD_NO_BUMP: '1' };
  if (isWin) {
    const ps1 = path.join(ROOT, 'build-desktop.ps1');
    const flag = WIN_FLAVOR_FLAG[flavor] || '-FullOnly';
    // 三档 Rust 二进制相同(只换 Tauri 资源):skipClean 档跳过清 target,复用上一档
    // 的增量编译,省掉整轮 ~10-30 分钟的 Rust 全量冷编译。
    const reuseFlag = reuse ? ' -ReuseFrontend' : '';  // 第2/3档:复用基础框架(前端+Rust),只叠加资源重打
    run(`powershell -NoProfile -ExecutionPolicy Bypass -File "${ps1}" ${flag}${reuseFlag} ${extra}`, ROOT, env);
  } else {
    const sh = path.join(ROOT, 'build-desktop.sh');
    const flag = SH_FLAVOR_FLAG[flavor] || '--integrated-only';
    const reuseFlag = reuse ? ' --skip-clean-target' : '';  // sh 暂只复用 Rust 增量(无 -ReuseFrontend)
    run(`bash "${sh}" ${flag}${reuseFlag} ${extra}`, ROOT, env);
  }
}

// ---- 主流程 ----
const version = decideVersion();
log(`版本(经 scripts/bump-version.py):${version}`);
if (has('--version-only')) { console.log('\n仅写版本号,完成。'); process.exit(0); }

const tier = val('--tier', 'all');  // 默认出三档(lite+standard+pro);单档用 --tier lite|standard|pro
if (!['lite', 'standard', 'pro', 'all'].includes(tier)) { console.error(`--tier 必须 lite|standard|pro|all`); process.exit(1); }
const tiers = tier === 'all' ? ['lite', 'standard', 'pro'] : [tier];
const TIER_FLAVOR = { lite: 'lite', standard: 'standard', pro: 'full' };
const plat = platformKey();
const RELEASE_DIR = path.join(ROOT, 'release', version);
const OFFLINE_DIR = path.join(RELEASE_DIR, 'offline');
const CLIENTS_DIR = path.join(RELEASE_DIR, 'clients');
const summary = [];

if (!has('--clients-only')) {
  for (let ti = 0; ti < tiers.length; ti++) {
    const t = tiers[ti];
    const fl = TIER_FLAVOR[t];
    log(`构建离线包(${plat} / tier=${t} → flavor=${fl},CHAYUAN_BUILD_NO_BUMP=1)`);
    requireFreeGB(ROOT, TIER_FREE_GB[t] ?? 8, `离线包 ${t} 档`);
    runBuildDesktop(fl, ti > 0);  // 第 1 档干净编译;2/3 档跳过清 target,复用 Rust 增量
    // 离线包必须自包含。WiX EmbedCab="no" 下 .msi 仅 ~2MB 元数据,真实内容在旁边的多个
    // cab 里;只收 .msi 装机必报「找不到 cab」(Error 1311/1335)。完整产物 = ISO
    // (把 MSI + 全部 cab 装在一起)。优先收 ISO;没出 ISO 则退回把整个 dist 目录搬进去。
    const isoSrc = path.join(ROOT, `chayuan-desktop_${fl}_setup.iso`);
    if (fs.existsSync(isoSrc)) {
      const dest = copyTo(isoSrc, OFFLINE_DIR, `chayuan-${version}-${plat}-${t}.iso`);
      const mb = (fs.statSync(dest).size / 1048576).toFixed(0);
      summary.push(`离线包(${t}): ${path.relative(ROOT, dest)} (${mb}MB,ISO 自包含 MSI+cab)`);
      // 削峰:已拷进 release/offline/,删根目录原 ISO,避免三档叠加把盘占满(--keep-iso 保留)
      if (!has('--keep-iso')) { try { fs.rmSync(isoSrc, { force: true }); } catch { /* 忽略 */ } }
    } else {
      // 非 Windows(Mac/Linux):.dmg / .deb / .AppImage 本身自包含,直接收单个安装器。
      const distDir = path.join(ROOT, `dist-${fl}`);
      if (!fs.existsSync(distDir)) { console.error(`未找到 ${t} 离线产物(无 ISO 且无 ${distDir})`); process.exit(1); }
      const SELF_CONTAINED = ['dmg', 'AppImage', 'deb', 'rpm', 'pkg', 'tar.gz'];
      const arts = pickByExt(distDir, SELF_CONTAINED);
      if (arts.length) {
        for (const a of arts) {
          const dest = copyTo(a.p, OFFLINE_DIR, `chayuan-${version}-${plat}-${t}.${a.ext}`);
          const mb = (fs.statSync(dest).size / 1048576).toFixed(0);
          summary.push(`离线包(${t}): ${path.relative(ROOT, dest)} (${mb}MB,自包含安装器)`);
        }
      } else {
        // 兜底:既无 ISO 又无单文件安装器 → 整个 dist 目录搬走(整目录一起分发)。
        // ⚠ Mac 下 .app 是目录,这里只收普通文件;若 dist 里只剩 .app(说明 DMG
        // 没生成,通常是 make-mac-dmg 那步磁盘空间不足、见上面 hdiutil 报错),
        // 会出现「0 文件可收」。此时不留空文件夹,直接给可操作的报错。
        const onlyApp = fs.readdirSync(distDir).every((e) => e.endsWith('.app'));
        if (onlyApp) {
          console.error(`\n[release] ${t} 档没有可分发安装器:${path.relative(ROOT, distDir)}/ 里只有 .app,没有 DMG。`);
          console.error(`         多半是上面 make-mac-dmg 那步「设备上无剩余空间」导致 DMG 没生成 —— 清理磁盘后重跑(或单独 --tier ${t})。`);
          process.exit(1);
        }
        const tierDir = path.join(OFFLINE_DIR, `chayuan-${version}-${plat}-${t}`);
        fs.mkdirSync(tierDir, { recursive: true });
        let n = 0, bytes = 0;
        for (const e of fs.readdirSync(distDir)) {
          const sp = path.join(distDir, e);
          if (fs.statSync(sp).isFile()) { fs.copyFileSync(sp, path.join(tierDir, e)); n++; bytes += fs.statSync(sp).size; }
        }
        if (!n) { fs.rmdirSync(tierDir); console.error(`${distDir} 里没有文件可收`); process.exit(1); }
        summary.push(`离线包(${t}): ${path.relative(ROOT, tierDir)}/ (${n} 文件 ~${(bytes/1048576).toFixed(0)}MB,整目录分发)`);
      }
    }
    // 削峰:本档已收进 release/offline/,删 dist-{flavor} 中间产物,避免与 release/ 重复占用(--keep-dist 保留)
    if (!has('--keep-dist')) {
      try { fs.rmSync(path.join(ROOT, `dist-${fl}`), { recursive: true, force: true }); } catch { /* 忽略 */ }
    }
  }
  summary.push('  提醒: lite=纯云零模型;standard=引擎+必带音色(其余模型用户下载);pro=全部模型离线。各档模型需构建机先 seed(sherpa/voxcpm 音色、字体等)。');
}

// models_seed 介质(pro 等带 GB 大模型的档):build.py 按 cap 把 EXTERNAL_CAPS 写到
// chayuan-server/dist/models_seed/。收拢到 release/<ver>/seed/,用户烧/挂为卷标 CHAYUAN_FULL,
// 首启从介质 seed 进数据目录。lite/standard 无大模型 → 该目录空,跳过。
if (!has('--clients-only')) {
  const seedSrc = path.join(ROOT, 'chayuan-server', 'dist', 'models_seed');
  if (fs.existsSync(seedSrc) && fs.readdirSync(seedSrc).length) {
    const seedDest = path.join(RELEASE_DIR, 'seed', 'models_seed');
    fs.mkdirSync(path.dirname(seedDest), { recursive: true });
    fs.rmSync(seedDest, { recursive: true, force: true });
    fs.cpSync(seedSrc, seedDest, { recursive: true });
    let bytes = 0;
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const fp = path.join(d, e.name); if (e.isDirectory()) walk(fp); else bytes += fs.statSync(fp).size; } };
    walk(seedDest);
    summary.push(`models_seed 介质: ${path.relative(ROOT, seedDest)}/ (~${(bytes / 1048576).toFixed(0)}MB; 烧/挂为卷标 CHAYUAN_FULL, 首启自动 seed 进数据目录)`);
  }
}

if (!has('--offline-only')) {
  requireFreeGB(ROOT, CLIENT_FREE_GB, '客户端(上传端+下载端)');
  const isMac = process.platform === 'darwin';
  const makeDmg = path.join(ROOT, 'scripts', 'make-mac-dmg.sh');
  const macArch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  for (const [app, label] of [['apps/publisher', '上传端(发布客户端)'], ['apps/installer', '下载端(安装器)']]) {
    log(`构建${label}`);
    const appDir = path.join(CLIENT_ROOT, app);
    const bundleDir = path.join(appDir, 'src-tauri/target/release/bundle');
    if (isMac) {
      // Tauri 2 自带 bundle_dmg.sh 在 macOS 14/15 上常因 osascript/hdiutil 挂掉(真错被吞,
      // 还会让整个 release 中断 —— 见 desktop 同坑,build-desktop.sh 早改走自研脚本)。
      // 这里客户端也只出 .app,再用项目自研 make-mac-dmg.sh(纯 hdiutil)产 dmg,稳定可重复。
      run('pnpm tauri build --bundles app --verbose', appDir);
      const macosDir = path.join(bundleDir, 'macos');
      const appBundle = fs.existsSync(macosDir)
        ? fs.readdirSync(macosDir).find((n) => n.endsWith('.app')) : null;
      if (appBundle && fs.existsSync(makeDmg)) {
        const appPath = path.join(macosDir, appBundle);
        const stem = appBundle.replace(/\.app$/, '');
        const dmgOut = path.join(macosDir, `${stem}_${version}_${macArch}.dmg`);
        try {
          run(`bash "${makeDmg}" "${appPath}" "${dmgOut}" "Chayuan"`, ROOT);
        } catch (e) {
          console.warn(`  ${label} make-mac-dmg 失败,本档无 dmg(.app 仍在 ${macosDir}):${e.message}`);
        }
      } else if (!appBundle) {
        console.warn(`  ${label} 未找到 .app(${macosDir}),跳过 dmg`);
      }
    } else {
      run('pnpm tauri build --verbose', appDir);  // --verbose:WiX light.exe 失败时透出真实报错(否则 Tauri 只说 failed to run light.exe)
    }
    const arts = pickByExt(bundleDir, CLIENT_EXTS);
    if (!arts.length) { console.warn(`  未找到${label}安装器产物`); continue; }
    for (const a of arts) { const dest = copyTo(a.p, CLIENTS_DIR, path.basename(a.p)); summary.push(`${label}: ${path.relative(ROOT, dest)}`); }
  }
}

log('完成');
console.log(`\n版本 ${version} 全部产物: ${path.relative(ROOT, RELEASE_DIR)}/`);
for (const s of summary) console.log('  - ' + s);
console.log('\n下一步:双击 release/' + version + '/clients/ 里「察元发布客户端」-> 登录(用户名/密码/验证码)-> 检测 offline/ -> 上传 -> 发布 -> 生成在线清单。');
console.log('用户侧:运行下载端按档下载,或直接下 offline/ 离线包安装。');
