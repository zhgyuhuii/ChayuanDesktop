# 察元下载构建器(Installer Builder)设计

> 状态:design(brainstorming 产物,待用户确认)。
> 已定决策:① 皮 = 轻量 Tauri GUI 向导;② 制包格式 = **自解压为主**(A);③ 分发后端 = `/work/website`(已有 releases/uploads/version 骨架);④ P0(2GB 上传修复)**已完成**(website `2f43c63`)。

## 0. 背景与目标

全量自包含包(torch + 模型 + 服务 + 运行时)体积达数 GB~十 GB,直接分发笨重。目标:做一个**轻量壳**,跨 Linux/Mac/Windows 运行,运行后可:
1. **在本机安装**三档之一(轻量/集成/全量),按需下载组件;
2. **制作离线安装包**:选 档 + OS + CPU 架构 → 下载组件到本地 → 封成可移植安装包,拿到任意机器离线安装。

### 对标经典软件(每个决策都抄成熟范式)
| 能力 | 对标 |
|---|---|
| 瘦壳 + 按需下载安装 | VS Installer 引导程序 / NVIDIA CUDA "network" / Ollama |
| 制作离线安装包(选档→下载→产出可移植包) | **VS Installer `--layout`** + **Anaconda `constructor`** |
| 自解压包格式 | NVIDIA CUDA `.run` / Miniconda `.sh` / makeself |
| 清单驱动按 os/arch 取组件 | conda `construct.yaml`(≈ 本项目 `layout.yaml`) |
| 下载续传/校验/镜像 | Steam / aria2 |
| 检查更新 | Sparkle / Squirrel(后端用本项目 `semver`) |

### 非目标(本设计不做)
- 不重写 `chayuan_packaging`(复用其 fetch/build + `layout.yaml`)。
- 不强求各平台原生签名包(.dmg/.msi 公证)——列为可选 CI 路径(P4)。
- 不做 P2P/增量块级 diff(后续可加)。

## 1. 架构:三件套(各有现成地基)

```
┌─────────────────────────────┐  查清单/下组件/查更新/上传产物  ┌──────────────────┐
│  察元下载构建器 (Tauri 皮·新建) │ ───────────────────────────────▶│  /work/website     │
│  · 向导:选 档/OS/架构          │                                  │  (Vue+Express,已有)│
│  · 下载引擎(续传/校验/镜像)    │ ◀── 安装包/manifest/版本 ────────│  uploads/releases  │
│  · 制包器(封自解压包)          │                                  │  version-routes    │
│  · 检查更新                     │                                  │  downloads         │
└──────────┬──────────────────┘                                  └──────────────────┘
           │ 复用 fetch/build(按 os/arch/档抓组件)
           ▼
   chayuan_packaging + layout.yaml(已有:6 平台矩阵 + sha256 + 镜像)
```

- **皮**:新建轻量 Tauri app(React + Rust,与现桌面端同栈,复用 UI 组件)。**不打任何模型/运行时**,体积 ~15-30MB。
- **chayuan_packaging + layout.yaml**:组件清单与抓取(已有,扩展)。
- **website**:上传/下载/版本检查后端(已有,P0 已修 2GB 上传)。

## 2. 三档定义(复用 lite/standard/pro)

| 对外名 | = 现有 | 内容 | 体积量级 |
|---|---|---|---|
| **轻量版** | lite | 内核 + 基础对话,无 GPU 重模型 | ~百 MB |
| **集成版** | standard | + RAG + 常用本地模型 + OCR/TTS | ~GB |
| **全量版** | pro | + 全部模型 + GPU 引擎 + 服务(PG/Milvus…),装完零下载 | 数 GB~十 GB |

> 档位组成由 `layout.yaml` 的 `release` 字段(lite/standard/pro)+ 组件 `optional` 标记决定,已有机制。

## 3. 清单驱动的组件解析(扩展 layout.yaml)

皮不硬编码任何 URL。给定 `(tier, os, arch)`:
1. 读 `layout.yaml` → 解析出该组合**需要哪些组件** + 各组件的 `(matrix[os-arch])` 下载地址 + `sha256` + `unpack`。
2. 逐组件下载(走下载引擎)。

`layout.yaml` 已有 6 平台矩阵(`{linux,mac,win}-{x86_64,arm64}`),本设计仅需补一个"组件→属于哪些档"的归属表(部分已由 `optional` 表达,P1 时补全)。

## 4. 下载引擎(对标 Steam/aria2)

- **分块 + 断点续传 + 并发分片**(GB 级模型,国内网络必须可续)。
- **sha256 校验**:下完比对;坏块重下;相同 sha 复用 `packaging/.cache`。
- **镜像兜底 + 探活**:复用已有 `mirror_pool.probe_pool`(ModelScope/hf-mirror/daocloud)。
- **原子落地**:下到 temp → 校验通过 → rename。
- 实现位置:Rust 侧(Tauri command),进度经 event 推前端。

## 5. 制包器:自解压包(决策 A)

**产物**:`chayuan-<tier>-<os>-<arch>` 的单文件自解压包:
- **Linux/macOS**:makeself 式 `.run`(归档 + 安装脚本:解压到目标目录 + 注册 sidecar/服务 + 建快捷方式)。
- **Windows**:自解压 `.exe`(同理)。

**为什么 A**:一台机器即可造**全部 6 平台**的包,绕开"造 mac `.pkg` 要 Apple 证书/公证、造 Win 签名 exe 要 Windows + 证书"的跨平台地狱——正是 CUDA/Miniconda 用 `.run`/`.sh` 的原因。

**制包流程**(对标 VS `--layout` + constructor):
1. 皮内选 `(tier, os, arch)` → 下载引擎把所需组件抓进一个临时 layout 目录。
2. 制包器把 layout 目录 + 安装脚本 + 自解压头拼成单文件包。
3. 产物可:① 本地保存;② 经 website 上传接口发布(走 P0 修复后的分块上传)。

**[VERIFY/约束]**:跨平台造原生包(.dmg/.msi/.deb)需各平台 CI——本设计 A 档不做;原生包列为 **P4 可选**。

## 6. 检查更新(对标 Sparkle,后端用 website `semver`)

- 已装产品 / 皮启动时,查 `website/version-routes`(已有 + `semver` 依赖),比对本地版本。
- 有新版 → 提示 → 下载引擎拉整包(P1 整包;块级增量 = 后续)→ 原子替换。
- 复用 `downloads-tracking`(更新也计数)。

## 7. 与 website 的上传/下载闭环

- **管理员发布**:皮"制作安装包" → 经**分块上传(P0 已修)**传到 `public/downloads/<product>/<platform>/`,登记 `releases`(`variant` 承载"档位",`platform` 承载 OS/架构)。
- **终端用户**:皮 / 官网从 `downloads-routes` 下对应 `(os,arch,tier)` 包。
- variant 字段语义:复用现有 variant(集成版/轻量版…),正好等于"档位";platform 已是 `{os}-{arch}`。

## 8. 数据模型 / 接口

- **清单**:`layout.yaml`(已有)+ 组件归档表(P1 补)。
- **website API**(已有):`POST /uploads/init|PATCH chunk|POST finalize`、`GET version-routes`、`downloads-routes`、`releases`。
- **皮↔Rust**:Tauri commands `resolve_components(tier,os,arch)` / `download(component)` / `build_installer(tier,os,arch)` / `check_update(product)`;进度走 event。

## 9. 错误处理

- 下载失败 → 镜像切换 → 全失败则给"换源/重试/查网络"指引(复用 mirror 探活诊断)。
- sha 不匹配 → 重下该组件,连续失败报具体组件名 + 期望 sha。
- 磁盘不足 → 制包/安装前预检(同 P0 上传预检思路),不够当场提示所需空间。
- 制包脚本失败 → 保留 layout 目录 + 日志,可重试。

## 10. 测试策略

- **下载引擎**:stub HTTP,测续传(断点重连)/sha 校验/镜像回退/原子落地。
- **清单解析**:给定 `(tier,os,arch)` 解析出预期组件集(纯函数,单测)。
- **制包器**:小假组件 → 产出自解压包 → 解包验证内容 + 安装脚本存在(本机平台可验;跨平台产物结构可验,真运行 [VERIFY])。
- **检查更新**:stub version-routes,测 semver 比对 + 提示逻辑。
- **website 上传**:已有 `uploads-chunk-flow`(P0)。

## 11. 分期

| 期 | 内容 | 状态/可验证性 |
|---|---|---|
| **P0** | 修 website 2GB 分块上传(append-on-arrival) | ✅ 已完成(`2f43c63`)|
| **P1** | 皮骨架:Tauri 向导(选档/os/arch)+ 清单解析 + 下载引擎(续传/校验/镜像)+ 本机安装 | 本机可验大部 |
| **P2** | 制包器(自解压包产出)+ 经 website 上传发布 | 本机平台可验;跨平台产物 [VERIFY] |
| **P3** | 检查更新(消费 version-routes + 原子替换) | 本机可验 |
| **P4(可选)** | 原生包(.dmg/.msi/.deb)CI 矩阵 + 签名公证 | 需各平台 CI + 证书 |

## 12. 风险 / [VERIFY]

- **跨平台造原生包**:一机造不全 → A 档用自解压规避;原生包待 P4 CI。
- **mac Gatekeeper / Win SmartScreen**:自解压未签名会被拦 → 需引导用户放行,或 P4 签名。
- **GB 级下载稳定性**:依赖续传 + 镜像;国内网络实测 [VERIFY]。
- **皮体积**:Tauri 需系统 webview(Win 自带 WebView2 / mac WKWebView / Linux WebKitGTK)——Linux 需确保 webkit2gtk 依赖,或退 CLI(本设计选 GUI)。
- **website 部署**:nginx `client_max_body_size ≥ 16M` + 反代超时需核对(P0 注释已记)。
