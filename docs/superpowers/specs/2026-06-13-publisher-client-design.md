# 察元发布客户端(Publisher）设计

- 日期：2026-06-13
- 状态：已通过 brainstorming，待写实施计划
- 关联：[2026-05-31-installer-builder-design.md](2026-05-31-installer-builder-design.md)（用户端在线安装器 / installer-core）

## 1. 目标

为**维护者**提供一个跨平台桌面 App，把"本机构建好的各平台/各档安装包"一键发布到分发后端 aidooo.com：

1. **登录**：用户名 / 密码 / 验证码（复用 website 已有 SVG 图形验证码）。
2. **检测**：从本地 git 取待发布版本与更新说明，扫描本地构建产物目录识别各平台/各档包，并对比线上已发布版本。
3. **上传**：分块上传（带进度、续传、并发），复用 website 已有上传协议。
4. **发布**：finalize → publish → set-primary，使离线自包含包对外可下载。
5. **生成在线清单**：合成 installer-manifest.json 并上传，驱动用户端"在线安装器"（apps/installer）按档下载。

产物形态（brainstorming 决策）：**既发布在线清单，也产离线自包含包**——二者共用同一批上传文件。

## 2. 架构与模块边界

```
apps/publisher/                      新建 Tauri 桌面端（维护者专用）
  src/                               React UI：登录→检测→上传→发布→清单（五步向导）
  src-tauri/src/lib.rs               瘦 Rust：本地 IO + 网络原语，不放业务判断
packages/publisher-core/             新建纯 TS 包（vitest，沙箱可全测）
  src/parse.ts        parsePackageName() 文件名规约解析
  src/detect.ts       planDetection() 扫描结果+git+线上 → 待发布矩阵 + 诊断
  src/manifest.ts     buildInstallerManifest() 合成 installer-manifest.json
  src/publish.ts      runPublish() 编排 finalize/publish/set-primary（IO 注入）
  src/__tests__/      vitest
packages/installer-core/             复用，不改：upload.ts、version.ts、InstallerManifest 类型
website/                             不改：纯消费 login+captcha / uploads / releases / version
```

边界原则（沿用 installer-core 教训）：

- **publisher-core 不碰 fs/网络/git**：只接收已读入数据、产出纯数据（计划/清单/调用序列），IO 由调用方注入，便于 vitest。
- **Rust 不放业务判断**：只做"读 git 输出""列目录""分块读文件并 POST""emit 进度"等原语，解析/决策全在 TS。
- **website 零改动**：验证码、登录、上传、发布、version 接口全现成。
- **installer-core 复用不复制**：upload.ts（planUpload/runChunkedUpload）、version.ts（compareVersions/isVersionNewer）直接 import。

## 3. 文件名规约 + 检测模型

### 文件名规约

```
<product>-<version>-<platform>-<tier>.<ext>
chayuan-3.0.0-win-x86_64-pro.zip
chayuan-3.0.0-linux-x86_64-standard.tar.gz
chayuan-3.0.0-mac-arm64-lite.tar.gz
```

- `product`：从右往左解析——先认末段 tier、再认 platform 两段、再认 version，剩下全是 product（允许产品名含连字符）。
- `version`：semver（`3.0.0` / `3.0.0-rc1`）。
- `platform`：`{linux,mac,win}-{x86_64,arm64}`（对齐 layout.yaml 平台键）。
- `tier`：`lite|standard|pro`。
- `ext`：白名单 `zip|tar.gz|tar.zst|exe|dmg|AppImage`。
- 解析失败/缺字段 → 不丢弃，标 `needsManual`，UI 就地手动补 platform/tier/version。

### 检测计划（planDetection）

输入：`scanned[]`（Rust 扫描目录）、`gitVersion`+`changelog`（Rust 读本地 git）、`online`（GET /api/version/chayuan）。

输出 `DetectionPlan`：

- `buildVersion`：本地构建版本（git / 文件名众数，冲突进 diagnostics）。
- `onlineVersion`：线上已发布最新。
- `status`：`ahead`（本地比线上新，可发布）| `same` | `behind` | `no-online`（用 installer-core `compareVersions` 算）。
- `items[]`：每个产物 `{filename,path,sizeBytes,platform,tier,version,parsed,onlineState,selected}`；`onlineState` ∈ `new|exists-unpublished|published`；默认勾选 `status=ahead` 且 `onlineState!=published`。
- `diagnostics[]`：版本不一致 / 平台缺档 / 重复文件等提示。

UI 渲染为"平台 × 档位"矩阵，维护者一眼看清本机有哪些、线上有哪些、这次要传哪些。

## 4. 数据流（端到端五步）

```
① 登录
   GET  /api/admin/captcha                         → {captchaId, svg}
   POST /api/admin/login {username,password,captchaId,captchaCode}
                                                    → Set-Cookie cy_admin（Rust reqwest cookie jar）
   失败：401 凭证 / 400 验证码 / 429 限流（显示 retryAfterSec）

② 检测
   Rust read_git_version  → {version, changelog}
   Rust scan_build_dir    → scanned[]
   HTTP GET /api/version/chayuan → online
   publisher-core.planDetection(scanned, git, online) → DetectionPlan
   UI 渲染矩阵 + 诊断 + 默认勾选

③ 上传（每个勾选产物）
   planUpload(size, 4MB)                            （复用 installer-core）
   续传：GET /api/admin/uploads/:id → received[] 跳过已传块
   POST /api/admin/uploads/init {product,version,platform,filename,size,sha256}
   PATCH .../chunk（X-Chunk-Index，8 并发，Rust 读盘+POST，emit upload-progress）
   POST .../finalize {variant, primary, notes} → {url, sha256, sizeBytes}
   variant = tier 显示名（lite→轻量版 / standard→集成版 / pro→全量版）

④ 发布
   POST /api/admin/releases/:product/:version/:platform/:variant/publish
   首传自动 primary；否则按矩阵 primary 选择调 set-primary
   → 离线自包含包对外可下载（version 路由可见）

⑤ 生成在线清单
   publisher-core.buildInstallerManifest(published[]) → installer-manifest.json
   经同一上传通道上传到 public/downloads/installer-manifest.json
   → 用户端 apps/installer 拉它后按档下载
```

**在线 vs 离线两条产物的关系**：

- **离线自包含包** = ②检测到的每平台每档大文件本身，经③④上传+发布，用户在 aidooo 直接下载即装、无需联网拼装。
- **在线安装器清单** = ⑤合成的 installer-manifest.json，其 `PlatformAsset.url/sha256/sizeBytes` 指向④发布的同一批离线包。
- 因此⑤必须在④之后跑（拿得到真实 url/sha/size）。两条路共用同一批上传文件。

## 5. publisher-core API 面

```ts
// parse.ts
export type Tier = 'lite' | 'standard' | 'pro';
export type PlatformKey = 'linux-x86_64'|'linux-arm64'|'mac-x86_64'|'mac-arm64'|'win-x86_64'|'win-arm64';
export interface ParsedPackage { product: string; version: string; platform: PlatformKey; tier: Tier; ext: string; }
export function parsePackageName(filename: string): ParsedPackage | null;   // 右→左，失败返回 null
export const TIER_VARIANT: Record<Tier, string>;  // {lite:'轻量版',standard:'集成版',pro:'全量版'}

// detect.ts
export interface ScannedFile { path: string; filename: string; sizeBytes: number; sha256?: string; }
export interface OnlineVersion { latest?: { version: string };
  platforms: Record<string, { version: string; variants: { variant: string; primary: boolean; url: string }[] }>; }
export interface DetectItem {
  filename: string; path: string; sizeBytes: number;
  platform: PlatformKey | null; tier: Tier | null; version: string | null;
  parsed: 'ok' | 'needsManual';
  onlineState: 'new' | 'exists-unpublished' | 'published';
  selected: boolean;
}
export interface DetectionPlan {
  buildVersion: string | null; onlineVersion: string | null;
  status: 'ahead' | 'same' | 'behind' | 'no-online';
  items: DetectItem[]; diagnostics: string[];
}
export function planDetection(input: { scanned: ScannedFile[]; gitVersion?: string; online?: OnlineVersion; }): DetectionPlan;

// manifest.ts
export function buildInstallerManifest(input: {
  product: string; version: string;
  assets: { platform: PlatformKey; tier: Tier; url: string; sha256: string; sizeBytes: number }[];
}): InstallerManifest;   // 复用 installer-core 的 InstallerManifest 类型

// publish.ts
export interface PublishIO {
  initUpload(meta): Promise<{ uploadId: string; chunkSize: number; totalChunks: number }>;
  getReceived(uploadId): Promise<number[]>;
  putChunk(uploadId, index, isLast): Promise<void>;     // Rust 侧读盘+POST
  finalize(uploadId, body): Promise<{ url: string; sha256: string; sizeBytes: number }>;
  publish(p, v, plat, variant): Promise<void>;
  setPrimary(p, v, plat, variant): Promise<void>;
  onProgress?(ev: { filename: string; received: number; total: number }): void;
}
export async function runPublish(items: DetectItem[], io: PublishIO, opts: { product: string; version: string; notes?: string }):
  Promise<{ published: { platform: PlatformKey; tier: Tier; url: string; sha256: string; sizeBytes: number }[];
            failed: { filename: string; error: string }[] }>;
```

要点：upload 切块/续传复用 installer-core，`PublishIO.putChunk` 是注入薄 IO；所有函数无副作用，vitest 用假 IO 覆盖；`finalize` 返回真实 url/sha/size → 喂 `buildInstallerManifest`。

## 6. Rust 命令面（瘦壳）

`apps/publisher/src-tauri/src/lib.rs`，只做 IO：

```
website_base()            env CHAYUAN_PUBLISHER_BASE，默认 https://aidooo.com
全局 reqwest::Client      cookie_store(true)，登录后 cookie 自动随后续请求

get_captcha()                                     → {captchaId, svg}
login(username,password,captchaId,captchaCode)    → Result<()>，cookie 入 jar
read_git_version(repo)                            → {version, changelog}（VERSION 文件 / git describe / git log）
scan_build_dir(dir)                               → [{path, filename, sizeBytes}]
hash_file(path)                                   → sha256（流式 O(1) 内存）
upload_chunks(window, uploadId, path, chunkSize, indices)  按 indices 读盘 PATCH .../chunk，8 并发，emit upload-progress
http_json(method, path, body)                     → Value（init/finalize/publish/set-primary/version 通用）
```

上传"编排顺序"在 TS（publisher-core）；Rust 只给 `http_json` + `upload_chunks` 两个原语，TS 用它们组装 `PublishIO`。

## 7. UI 流程（React 五步向导）

```
[1 登录]  用户名/密码/验证码（SVG+刷新）；失败提示含限流倒计时
[2 检测]  配置：构建目录（可改，记 localStorage）、产品名、git 仓路径
          「检测」→ 平台×档位矩阵卡片（文件名/大小/解析状态/线上状态/勾选框）
          顶部横幅：本地 vX ↔ 线上 vY + status 徽标
          needsManual 项就地下拉补 platform/tier/version
[3 上传]  勾选项列表 + 每项进度条（listen upload-progress）+ 总进度；续传/重试单项
[4 发布]  逐项 publish + 选 primary；成功项显示"已对外可下载 + url"
[5 清单]  「生成并发布在线安装器清单」→ buildInstallerManifest → 上传 installer-manifest.json
          完成页：列出本次发布所有离线包 url + 在线清单已更新
```

## 8. 错误处理

- 登录失败/限流就地提示（429 显示 retryAfterSec 倒计时）。
- 上传单片失败重试 3 次（installer-core 已有）；整项失败不阻断其它项，汇总进 `failed[]`。
- 发布失败保留已传文件可重发。
- 清单生成要求④全绿才放行（否则 url/sha 不完整）。

## 9. 测试

- **publisher-core vitest**（沙箱可全测）：
  - `parsePackageName`：各平台 / 带连字符产品 / 失败回落 needsManual。
  - `planDetection`：ahead/same/behind/no-online、onlineState 判定、诊断生成。
  - `buildInstallerManifest`：url/sha/size 正确填充、平台键对齐。
  - `runPublish`：finalize→publish→set-primary 顺序、失败隔离、primary 选择。
- **`[BUILD-VERIFY]`**（需 Rust 工具链 + 目标平台，沙箱不可验）：Tauri 窗口、reqwest 登录/cookie/验证码、真分块上传+进度、read_git_version、scan_build_dir、hash_file。

## 10. 范围与非目标

- 不在发布客户端内运行构建（产物由维护者本机既有构建流程产出）。
- 不改 website 后端（接口全复用）。
- 原生包签名/公证（mac notarize / win sign）非本设计范围。
- 自动版本号推算非目标（版本取自本地 git / 文件名）。
