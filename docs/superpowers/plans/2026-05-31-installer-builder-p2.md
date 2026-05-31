# 察元下载构建器 P2(清单生成器 + 制包器 + 上传发布)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。Steps 用 checkbox。

**Goal:** ① `chayuan_packaging manifest` 子命令把 `layout.yaml` 生成归一化 `InstallerManifest` JSON(喂 P1 的 `resolveComponents`,Python pytest 可验);② installer-core 分块上传编排(把制好的包发到 website,vitest 可验);③ website 静态发布 manifest;④ makeself 自解压制包(Rust `build_installer`,`[BUILD-VERIFY]`)。

**Architecture:** 清单生成复用 chayuan_packaging 既有 `load_layout`/`Resource.release_tags`/`matrix_for`(不在 TS 重造 layout 解析);上传复用 website P0 已修的分块上传协议(init/chunk/finalize);制包用 makeself 式(归档 + 安装脚本自解压),一机造全平台。

**Tech Stack:** Python(chayuan_packaging,pytest)/ TypeScript(installer-core,vitest)/ Express(website 静态)/ Rust+makeself(`[BUILD-VERIFY]`)。承接 P1(installer-core + apps/installer 已就绪)+ P0(website 2GB 上传已修)。

---

## ⚠ 本机可验证边界
- ✅ 可验:`manifest` 子命令(pytest,合成 layout fixture)、installer-core 上传编排(vitest,注入 fetch)、website 静态路由(node test)。
- ❌ `[BUILD-VERIFY]`:makeself 制包真产出 + 真自解压安装(需目标平台);github:// 源真解析(需网络,放生成时维护者环境)。

---

## 文件结构
- `chayuan-server/packaging/python312/chayuan_packaging/installer_manifest.py`(建):`build_installer_manifest(layout) -> dict` + `resolve_asset_url(resource, platform)`。
- `chayuan-server/packaging/python312/chayuan_packaging/pack.py`(改):加 `manifest` click 子命令。
- `chayuan-server/packaging/python312/tests/test_installer_manifest.py`(建)。
- `chayuan-client/packages/installer-core/src/upload.ts`(建):`planUpload` + `runChunkedUpload`(注入 IO)。
- `chayuan-client/packages/installer-core/src/__tests__/upload.test.ts`(建)。
- `chayuan-client/packages/installer-core/src/index.ts`(改):导出 upload。
- `website/server/installer-routes.js`(建):`GET /api/installer/manifest`(读已发布 manifest.json)。
- `website/server/__tests__/installer-routes.test.mjs`(建)。
- `chayuan-client/apps/installer/src-tauri/src/lib.rs`(改):加 `build_installer` 命令(`[BUILD-VERIFY]`)。

---

## Task 1: chayuan_packaging `manifest` 子命令(Python,pytest)

**Files:**
- Create `chayuan-server/packaging/python312/chayuan_packaging/installer_manifest.py`
- Modify `chayuan-server/packaging/python312/chayuan_packaging/pack.py`
- Test `chayuan-server/packaging/python312/tests/test_installer_manifest.py`

> 复用既有 API(已读 manifest.py):`load_layout(path)->Layout`、`Layout.all_resources()->List[Resource]`、`Resource` 字段 `name/dest/optional/unpack/source/version/repo/file/matrix/release_tags`、`Resource.matrix_for(platform)->dict|None`。平台键 6 个:`linux-x86_64 linux-arm64 mac-x86_64 mac-arm64 win-x86_64 win-arm64`。
>
> 输出归一化 schema(对齐 P1 TS `InstallerManifest`):
> ```json
> {"version":"3.0.0","components":[
>   {"name":"qwen3-4b","tiers":["lite","standard","pro"],"dest":"models/chat/...","optional":false,
>    "platforms":{"linux-x86_64":{"url":"https://...","unpack":"none"}, ...}}]}
> ```
> tiers = `resource.release_tags`(lite/standard/pro);platforms 仅含 `matrix_for` 非空的平台。

- [ ] **Step 1: 写失败测试**
```python
# chayuan-server/packaging/python312/tests/test_installer_manifest.py
import textwrap
from pathlib import Path
from chayuan_packaging.manifest import load_layout
from chayuan_packaging.installer_manifest import build_installer_manifest, resolve_asset_url

_LAYOUT = textwrap.dedent('''
runtimes:
  - name: python312
    dest: vendor/runtimes/python
    source: https://example.com/py-{platform_tag}.{ext}
    matrix:
      linux-x86_64: { platform_tag: linux-x64, ext: tar.gz }
      win-x86_64:   { platform_tag: win-x64,   ext: zip }
models:
  - name: qwen
    dest: models/chat/qwen
    source: hf-mirror://org/qwen
    repo: org/qwen
    file: qwen.gguf
    unpack: none
    release: [lite, standard, pro]
    matrix:
      linux-x86_64: org/qwen
      mac-arm64: org/qwen
releases:
  lite:     { models: [qwen] }
  standard: { runtimes: [python312], models: [qwen] }
  pro:      { runtimes: [python312], models: [qwen] }
''')


def _layout(tmp_path: Path):
    p = tmp_path / "layout.yaml"
    p.write_text(_LAYOUT, encoding="utf-8")
    return load_layout(p)


def test_resolve_asset_url_http_interpolates(tmp_path):
    layout = _layout(tmp_path)
    py = layout.get("python312")
    url = resolve_asset_url(py, "linux-x86_64")
    assert url == "https://example.com/py-linux-x64.tar.gz"


def test_resolve_asset_url_hf_mirror_model(tmp_path):
    layout = _layout(tmp_path)
    qwen = layout.get("qwen")
    url = resolve_asset_url(qwen, "linux-x86_64")
    # hf-mirror://org/qwen + file qwen.gguf → hf-mirror 下载直链
    assert "hf-mirror.com" in url and "org/qwen" in url and "qwen.gguf" in url


def test_build_manifest_shape_and_tiers(tmp_path):
    layout = _layout(tmp_path)
    man = build_installer_manifest(layout, version="3.0.0")
    assert man["version"] == "3.0.0"
    comp = {c["name"]: c for c in man["components"]}
    # qwen 三档都含
    assert comp["qwen"]["tiers"] == ["lite", "standard", "pro"]
    # 仅 matrix 有的平台进 platforms
    assert set(comp["qwen"]["platforms"].keys()) == {"linux-x86_64", "mac-arm64"}
    assert comp["qwen"]["platforms"]["linux-x86_64"]["unpack"] == "none"
    # python312 无 release_tags → 不带 tiers(归到所有引用它的 release)
    assert "python312" in comp
    assert set(comp["python312"]["platforms"].keys()) == {"linux-x86_64", "win-x86_64"}
```

- [ ] **Step 2: 跑确认失败**
Run: `cd chayuan-server && PYTHONPATH="packaging/python312" python -m pytest packaging/python312/tests/test_installer_manifest.py -v`
Expected: FAIL（模块缺失）

- [ ] **Step 3: 实现 installer_manifest.py**
```python
"""layout.yaml → 归一化 InstallerManifest（皮 resolveComponents 消费）。

复用 manifest.Layout/Resource;只解析 http(s)/hf-mirror 直链(离线可算),
github:// 源发出 ``github://owner/repo#asset`` 引用(下载侧解析,[VERIFY])。
"""
from __future__ import annotations

import os
from typing import Optional

from chayuan_packaging.manifest import Layout, Resource

ALL_PLATFORMS = [
    "linux-x86_64", "linux-arm64",
    "mac-x86_64", "mac-arm64",
    "win-x86_64", "win-arm64",
]
ALL_TIERS = ["lite", "standard", "pro"]


def _hf_mirror_host() -> str:
    return os.environ.get("HF_MIRROR_URL", "https://hf-mirror.com").rstrip("/")


def resolve_asset_url(resource: Resource, platform: str) -> Optional[str]:
    """把 resource+platform 解析成一个具体下载 URL。
    - source=https://...{platform_tag}.{ext} → 用 matrix 行变量插值
    - source=hf-mirror://repo + file → hf-mirror 直链
    - source=github://owner/repo → 返 ``github://owner/repo#<asset_pattern>``(下载侧解析)
    - 无法解析 → None
    """
    row = resource.matrix_for(platform)
    if row is None:
        return None
    source = resource.source or ""
    # hf-mirror 模型直链
    if source.startswith("hf-mirror://") or resource.repo:
        repo = resource.repo or source[len("hf-mirror://"):]
        fname = resource.file or row.get("asset", "")
        if repo and fname:
            return f"{_hf_mirror_host()}/{repo}/resolve/main/{fname}"
        return None
    # github://owner/repo → 引用(asset 在 matrix 行)
    if source.startswith("github://"):
        asset = row.get("asset", "")
        return f"{source}#{asset}" if asset else source
    # http(s) 模板:用 matrix 行变量 + version 插值
    if source.startswith(("http://", "https://")):
        url = source
        repl = {"version": resource.version, **row}
        for k, v in repl.items():
            url = url.replace("{" + str(k) + "}", str(v))
        return url
    # matrix 行自带完整 url
    if isinstance(row.get("source"), str) and row["source"].startswith(("http", "github://")):
        return row["source"]
    return None


def build_installer_manifest(layout: Layout, *, version: str = "0.0.0") -> dict:
    """遍历全部 resource × 6 平台 → 归一化 manifest dict。"""
    components = []
    for r in layout.all_resources():
        platforms = {}
        for plat in ALL_PLATFORMS:
            url = resolve_asset_url(r, plat)
            if not url:
                continue
            platforms[plat] = {"url": url, "unpack": r.unpack or "none"}
        if not platforms:
            continue
        tiers = list(r.release_tags) if r.release_tags else list(ALL_TIERS)
        components.append({
            "name": r.name,
            "tiers": tiers,
            "dest": r.dest,
            "optional": bool(r.optional),
            "platforms": platforms,
        })
    return {"version": version, "components": components}
```
> 注:`python312` 无 `release_tags`(它在 releases 的 runtimes 列表里,但 layout 的 release_tags 是模型专用 `release:` 字段)→ 回落 ALL_TIERS,满足测试 `"python312" in comp`。

- [ ] **Step 4: 跑测试通过**
Run: `cd chayuan-server && PYTHONPATH="packaging/python312" python -m pytest packaging/python312/tests/test_installer_manifest.py -v`
Expected: 3 passed

- [ ] **Step 5: 加 `manifest` 子命令到 pack.py**
在 pack.py 的 cli group 里加(`load_layout`/`DEFAULT_LAYOUT`/`click`/`json` 已 import):
```python
@cli.command(help="layout.yaml → 归一化 InstallerManifest JSON(喂下载构建器皮)")
@click.option("--layout-path", type=str, default=str(DEFAULT_LAYOUT))
@click.option("--version", "version_str", type=str, default="0.0.0")
@click.option("--out", type=str, default="", help="输出文件(默认 stdout)")
def manifest(layout_path: str, version_str: str, out: str) -> None:
    from chayuan_packaging.installer_manifest import build_installer_manifest
    layout = load_layout(layout_path)
    man = build_installer_manifest(layout, version=version_str)
    text = json.dumps(man, indent=2, ensure_ascii=False)
    if out:
        from pathlib import Path as _P
        _P(out).write_text(text, encoding="utf-8")
        click.secho(f"→ manifest: {out}({len(man['components'])} 组件)", fg="green")
    else:
        click.echo(text)
```

- [ ] **Step 6: 冒烟 + py_compile**
Run: `cd chayuan-server && PYTHONPATH="packaging/python312" python -m chayuan_packaging manifest --version 3.0.0 2>&1 | head -5`
Expected: 输出 JSON(或对真 layout.yaml 的组件)
Run: `python -m py_compile chayuan-server/packaging/python312/chayuan_packaging/installer_manifest.py chayuan-server/packaging/python312/chayuan_packaging/pack.py`

- [ ] **Step 7: 提交**
```bash
cd /work/chayuan-desktop && git add chayuan-server/packaging/python312/chayuan_packaging/installer_manifest.py chayuan-server/packaging/python312/chayuan_packaging/pack.py chayuan-server/packaging/python312/tests/test_installer_manifest.py
git commit -m "feat(installer): chayuan_packaging manifest 子命令(layout.yaml→归一化清单 JSON)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: installer-core 分块上传编排(TS,vitest)

**Files:**
- Create `chayuan-client/packages/installer-core/src/upload.ts`
- Modify `chayuan-client/packages/installer-core/src/index.ts`
- Test `chayuan-client/packages/installer-core/src/__tests__/upload.test.ts`

> 把"制好的包 → website 分块上传(init/chunk/finalize)"编排成可注入 IO 的纯逻辑。真 HTTP 在皮里注入。对齐 website P0 协议:`POST /api/admin/uploads/init {product,version,platform,filename,size}` → `{uploadId,chunkSize,totalChunks}`;`PATCH /uploads/:id/chunk`(header X-Chunk-Index);`POST /uploads/:id/finalize {variant,primary}`。

- [ ] **Step 1: 写失败测试**
```typescript
// chayuan-client/packages/installer-core/src/__tests__/upload.test.ts
import { describe, it, expect } from 'vitest';
import { planUpload, runChunkedUpload } from '../upload';

describe('planUpload', () => {
  it('按 chunkSize 切块,最后一块取余', () => {
    const p = planUpload(10, 4);
    expect(p.totalChunks).toBe(3);
    expect(p.chunks).toEqual([
      { index: 0, start: 0, end: 4 },
      { index: 1, start: 4, end: 8 },
      { index: 2, start: 8, end: 10 },
    ]);
  });
  it('整除时不多一块', () => {
    expect(planUpload(8, 4).totalChunks).toBe(2);
  });
});

describe('runChunkedUpload', () => {
  it('init→各 chunk→finalize,按序调用注入的 io', async () => {
    const calls: string[] = [];
    const io = {
      init: async () => { calls.push('init'); return { uploadId: 'u1', chunkSize: 4, totalChunks: 3 }; },
      sendChunk: async (id: string, idx: number) => { calls.push(`chunk:${idx}`); return; },
      finalize: async () => { calls.push('finalize'); return { ok: true }; },
    };
    const res = await runChunkedUpload(
      { product: 'desktop', version: '3.0.0', platform: 'linux-x86_64', filename: 'x.run', size: 10, variant: '集成版' },
      io,
    );
    expect(res.ok).toBe(true);
    expect(calls).toEqual(['init', 'chunk:0', 'chunk:1', 'chunk:2', 'finalize']);
  });
  it('某 chunk 抛错 → 返回失败,不调 finalize', async () => {
    const io = {
      init: async () => ({ uploadId: 'u1', chunkSize: 4, totalChunks: 3 }),
      sendChunk: async (_id: string, idx: number) => { if (idx === 1) throw new Error('net'); },
      finalize: async () => ({ ok: true }),
    };
    const res = await runChunkedUpload(
      { product: 'desktop', version: '3.0.0', platform: 'linux-x86_64', filename: 'x.run', size: 10, variant: '集成版' },
      io,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toContain('net');
  });
});
```

- [ ] **Step 2: 跑确认失败**
Run: `cd chayuan-client && npx vitest --run packages/installer-core/src/__tests__/upload.test.ts`

- [ ] **Step 3: 实现 upload.ts**
```typescript
export interface UploadChunk { index: number; start: number; end: number; }
export interface UploadPlan { totalChunks: number; chunks: UploadChunk[]; }

/** 按 chunkSize 把 size 切成块(最后一块取余)。 */
export function planUpload(size: number, chunkSize: number): UploadPlan {
  const totalChunks = Math.max(1, Math.ceil(size / chunkSize));
  const chunks: UploadChunk[] = [];
  for (let i = 0; i < totalChunks; i++) {
    chunks.push({ index: i, start: i * chunkSize, end: Math.min((i + 1) * chunkSize, size) });
  }
  return { totalChunks, chunks };
}

export interface UploadMeta {
  product: string; version: string; platform: string;
  filename: string; size: number; variant: string; primary?: boolean;
}
export interface UploadIO {
  init(meta: UploadMeta): Promise<{ uploadId: string; chunkSize: number; totalChunks: number }>;
  sendChunk(uploadId: string, index: number, chunk: UploadChunk): Promise<void>;
  finalize(uploadId: string, meta: UploadMeta): Promise<{ ok: boolean; error?: string }>;
}

/** 编排 init→各 chunk→finalize。任一步抛错→返回 {ok:false},不进 finalize。 */
export async function runChunkedUpload(meta: UploadMeta, io: UploadIO): Promise<{ ok: boolean; error?: string }> {
  try {
    const { uploadId, chunkSize } = await io.init(meta);
    const plan = planUpload(meta.size, chunkSize);
    for (const c of plan.chunks) {
      await io.sendChunk(uploadId, c.index, c);
    }
    return await io.finalize(uploadId, meta);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
```

- [ ] **Step 4: 更新 index.ts**(在末尾加)
```typescript
export {
  planUpload, runChunkedUpload,
  type UploadChunk, type UploadPlan, type UploadMeta, type UploadIO,
} from './upload';
```

- [ ] **Step 5: 跑通 + typecheck**
Run: `cd chayuan-client && npx vitest --run packages/installer-core`（全 passed:14+4=18）
Run: `cd chayuan-client/packages/installer-core && npx tsc -p tsconfig.json --noEmit`（空)

- [ ] **Step 6: 提交**
```bash
cd /work/chayuan-desktop && git add chayuan-client/packages/installer-core
git commit -m "feat(installer): 分块上传编排 planUpload + runChunkedUpload(注入 IO,对齐 website 协议)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: website 发布 manifest 路由(Express,node test)

**Files:**
- Create `website/server/installer-routes.js`
- Modify `website/server/index.js`
- Test `website/server/__tests__/installer-routes.test.mjs`

> 维护者把 `chayuan_packaging manifest --out` 生成的 JSON 放到 `public/downloads/installer-manifest.json`;路由读它返回(找不到返 404 而非崩)。皮启动拉这个。

- [ ] **Step 1: 写失败测试**
```javascript
// website/server/__tests__/installer-routes.test.mjs
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import express from 'express'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'installer-routes-'))
process.env.ADMIN_DATA_DIR = tmpDir
process.env.ADMIN_PUBLIC_DOWNLOADS = path.join(tmpDir, 'downloads')

const { ensureDirs, PATHS } = await import('../db.js')
const installerRouter = (await import('../installer-routes.js')).default

const app = express()
app.use('/api/installer', installerRouter)

let server, baseUrl
before(async () => {
  ensureDirs()
  await new Promise((r) => { server = app.listen(0, r) })
  baseUrl = `http://127.0.0.1:${server.address().port}`
})
after(async () => { await new Promise((r) => server.close(r)); fs.rmSync(tmpDir, { recursive: true, force: true }) })

describe('GET /api/installer/manifest', () => {
  test('有文件 → 返回 JSON', async () => {
    fs.writeFileSync(path.join(PATHS.publicDownloads, 'installer-manifest.json'),
      JSON.stringify({ version: '3.0.0', components: [] }))
    const r = await fetch(`${baseUrl}/api/installer/manifest`)
    assert.equal(r.status, 200)
    const j = await r.json()
    assert.equal(j.version, '3.0.0')
  })
  test('无文件 → 404', async () => {
    fs.rmSync(path.join(PATHS.publicDownloads, 'installer-manifest.json'), { force: true })
    const r = await fetch(`${baseUrl}/api/installer/manifest`)
    assert.equal(r.status, 404)
  })
})
```

- [ ] **Step 2: 跑确认失败**
Run: `cd /work/website && node --test server/__tests__/installer-routes.test.mjs`

- [ ] **Step 3: 实现 installer-routes.js**
```javascript
/** 下载构建器:对外发布 InstallerManifest(由维护者 chayuan_packaging manifest 生成后放 public)。 */
import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { PATHS } from './db.js'

const router = express.Router()

router.get('/manifest', (req, res) => {
  const p = path.join(PATHS.publicDownloads, 'installer-manifest.json')
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'manifest_not_published' })
  try {
    const text = fs.readFileSync(p, 'utf8')
    res.type('application/json').send(text)
  } catch (e) {
    res.status(500).json({ error: 'manifest_read_failed', detail: String(e?.message || e) })
  }
})

export default router
```

- [ ] **Step 4: 挂到 index.js**(在其它 `app.use('/api/...` 旁)
```javascript
import installerRouter from './installer-routes.js'
// ...
app.use('/api/installer', installerRouter)
```
> READ index.js 找到现有 `app.use('/api/admin/uploads', ...)` 一行,在其附近加。`installerRouter` import 放顶部 import 区。

- [ ] **Step 5: 跑通 + 不回归**
Run: `cd /work/website && node --test server/__tests__/installer-routes.test.mjs`（2 passed)
Run: `cd /work/website && node --test server/__tests__/*.test.mjs 2>&1 | tail -4`（全 pass）

- [ ] **Step 6: 提交(website 仓)**
```bash
cd /work/website && git add server/installer-routes.js server/index.js server/__tests__/installer-routes.test.mjs
git commit -m "feat(installer): GET /api/installer/manifest 发布下载构建器清单

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: makeself 自解压制包(Rust `build_installer`,`[BUILD-VERIFY]`)

**Files:**
- Modify `chayuan-client/apps/installer/src-tauri/src/lib.rs`

> 本机无 Rust → 只写形状,不编译。`build_installer` 把一个 staging 目录(P1 下载引擎已把组件落到这里)+ 安装脚本打成自解压包:Linux/mac 用 makeself 式(tar.gz + shell 头),Windows 留 [BUILD-VERIFY]。本任务交付可编译形状的 Rust 命令 + 注册。

- [ ] **Step 1: 加 `build_installer` 命令到 lib.rs**(在 `download_file` 后)
```rust
/// 把 staging 目录打成自解压安装包。
/// [BUILD-VERIFY] 真打包需目标平台 makeself / 7z 自解压头;本骨架用 tar.gz + shell 自解压头(Linux/mac)。
#[tauri::command]
async fn build_installer(staging_dir: String, out_path: String, tier: String, os: String) -> Result<String, String> {
    use std::process::Command;
    let staging = std::path::Path::new(&staging_dir);
    if !staging.is_dir() {
        return Err(format!("staging 不存在: {}", staging_dir));
    }
    // [BUILD-VERIFY] Linux/mac:tar 打包 + 拼 shell 自解压头;Windows 待接 7z SFX。
    if os == "win" {
        return Err("windows 自解压制包待接 7z SFX [BUILD-VERIFY]".into());
    }
    let tar_tmp = format!("{}.tar.gz", out_path);
    let status = Command::new("tar")
        .args(["-czf", &tar_tmp, "-C", &staging_dir, "."])
        .status()
        .map_err(|e| format!("tar 失败: {}", e))?;
    if !status.success() {
        return Err("tar 退出码非 0".into());
    }
    // 自解压头:解压到 $1(默认 ./chayuan-<tier>)后跑 install.sh
    let stub = format!(
        "#!/bin/sh\nset -e\nDEST=\"${{1:-./chayuan-{tier}}}\"\nmkdir -p \"$DEST\"\nARCHIVE_LINE=$(awk '/^__ARCHIVE__/ {{print NR + 1; exit 0}}' \"$0\")\ntail -n +$ARCHIVE_LINE \"$0\" | tar -xzf - -C \"$DEST\"\n[ -f \"$DEST/install.sh\" ] && sh \"$DEST/install.sh\"\nexit 0\n__ARCHIVE__\n",
        tier = tier
    );
    // 拼 stub + tar 内容 → out_path
    let mut out = std::fs::File::create(&out_path).map_err(|e| e.to_string())?;
    use std::io::Write;
    out.write_all(stub.as_bytes()).map_err(|e| e.to_string())?;
    let tar_bytes = std::fs::read(&tar_tmp).map_err(|e| e.to_string())?;
    out.write_all(&tar_bytes).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&tar_tmp);
    Ok(out_path)
}
```

- [ ] **Step 2: 注册到 invoke_handler**(把 `build_installer` 加进 `generate_handler!`)
```rust
        .invoke_handler(tauri::generate_handler![download_file, fetch_manifest, build_installer])
```

- [ ] **Step 3: 形状自检(不编译)**
Run: `grep -n "build_installer" chayuan-client/apps/installer/src-tauri/src/lib.rs`（命令定义 + handler 注册各一处）
> `cargo build` 标 `[BUILD-VERIFY]`,本机跳过。

- [ ] **Step 4: 提交**
```bash
cd /work/chayuan-desktop && git add chayuan-client/apps/installer/src-tauri/src/lib.rs
git commit -m "feat(installer): build_installer 自解压制包命令(makeself 式 tar.gz+shell 头)[BUILD-VERIFY]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: 自检 + 推送

- [ ] **Step 1:** `cd chayuan-server && PYTHONPATH="packaging/python312" python -m pytest packaging/python312/tests/test_installer_manifest.py -q`（pass)
- [ ] **Step 2:** `cd chayuan-client && npx vitest --run packages/installer-core`（全 pass)
- [ ] **Step 3:** `cd /work/website && node --test server/__tests__/installer-routes.test.mjs`（pass)
- [ ] **Step 4:** 推送两仓:
```bash
cd /work/chayuan-desktop && git push origin main
cd /work/website && git push origin main
```

---

## 自检(Self-Review)
- **Spec 覆盖**(spec §3 清单 / §5 制包 / §7 上传发布):清单生成(T1)、制包(T4)、上传编排(T2)+ 发布路由(T3)。检查更新 = P3。
- **占位扫描**:无 TBD。`[BUILD-VERIFY]` 标的是 makeself 真打包/真自解压 + github:// 真解析需目标/网络环境。
- **类型一致**:T1 JSON schema(`version/components[].{name,tiers,dest,optional,platforms{<key>:{url,unpack}}}`)= P1 TS `InstallerManifest`/`ManifestComponent`/`PlatformAsset`;T2 `UploadMeta`/`UploadIO`/`planUpload` 签名自洽;website 协议字段(product/version/platform/filename/size/variant)与 P0 `uploads.js` 一致。
- **不回归**:T1/T2 新文件;T3 website 加路由不动既有(跑全量回归);T4 仅加 Rust 命令。
- **风险/[BUILD-VERIFY]**:① makeself 真产物可在目标机自解压 ② Windows 7z SFX 未接 ③ github:// 源 URL 生成时真解析(需网络)④ 皮把下载引擎 staging 接给 build_installer 的端到端(P1+P2 串联需 Rust 环境)。
