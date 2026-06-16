# 可携带数据目录 + 外置 seed + 小资产随包 + 系统字体

- 日期:2026-06-16
- 状态:设计已评审,待写实现计划
- 适用:chayuan-desktop(含 chayuan-server sidecar + chayuan-client 打包链路)

## 1. 背景与问题

桌面端首次启动会把随安装包嵌入的内置模型从 app 资源 `shutil.copy2` 到 `<CHAYUAN_ROOT>/models/bundled/`(实测 macOS 上一次 ~2GB 拷贝)。结果:**同一份模型在「安装目录」和「数据目录」各存一份 = 双倍占用**。在近满磁盘的机器上(实测某 Mac 仅剩 ~4.7GB),这还会连锁导致视频生成等写大文件的功能耗尽磁盘、进程被杀。

同时用户希望:**数据目录成为自包含、可整目录拷到另一台直接用的单一真源**(模型 + 配置 + 数据一致,免重复下载,便于携带和迁移)。

## 2. 目标 / 非目标

**目标**
- 数据目录(`CHAYUAN_ROOT`)是所有**跨平台数据资产**(模型权重、bgm、配置、db、用户上传)的唯一真源,可整目录拷到另一台同步使用,无需重新下载。
- 消除 GB 级模型的「安装包 + 数据目录」双份占用:大模型只通过**外置 seed 介质**落地到数据目录一份。
- 小的跨平台资产(bgm / piper 音色 / rapidocr / whisper-tiny)**随每个安装包**(全平台、全档),装好即用、跨机自带。
- 砍掉随包字体(`bundled_fonts`),改**系统字体下拉**。

**非目标(本期不做)**
- 不改许可证机制:迁移**不携带许可证**,新机器需重新激活。
- 不做服务端「解绑 / 迁移」流程(留后续)。

## 3. 资产分类(核心决策)

划线原则:**跨平台数据 → 进数据目录;平台相关二进制 → 留在按平台的安装包内就地用。**

| 资产 | 体积 | 归属 | 落地方式 |
|---|---|---|---|
| bgm | 56MB | 随每个安装包(全档全平台) | 嵌入 app + 首启动 seed 到 `<ROOT>/video_generation/bgm/` |
| piper TTS 音色 | 60MB | 同上 | 嵌入 + seed 到 `<ROOT>/models/bundled/tts/` |
| rapidocr OCR | ~15MB | 同上 | 嵌入 + seed 到 `<ROOT>/models/bundled/ocr/` |
| whisper asr(默认 **tiny ~75MB**) | ~75MB | 同上 | 嵌入 + seed 到 `<ROOT>/models/bundled/asr/` |
| nltk_data | 58MB | 随包(现状不变) | 代码数据依赖,不动 |
| chat LLM(Qwen3-4B ~2GB) | GB | **外置 seed** | `models_seed` 介质 → seed 到 `<ROOT>/models/bundled/chat/` |
| embedding **bge-m3**(~2.3GB,保持默认) | GB | **外置 seed** | 同上(embedding/) |
| rerank(~1–2GB) | GB | **外置 seed** | 同上(rerank/) |
| digital_human(wav2lip+s3fd ~502MB) | 502MB | **外置 seed** | 同上(digital_human/) |
| bundled_fonts | — | **删除** | 改系统字体下拉(见 §6) |
| 服务二进制 llama-server / whisper-server / imagemagick | 平台相关 | 留在按平台安装包内 | 就地用,**不进数据目录**(换 OS 无法复用) |

小资产「嵌入 app + seed 到数据目录」会有 ~210MB 的小幅双份占用,**刻意接受**:换来数据目录字面自包含 + 运行时统一从 `CHAYUAN_ROOT` 读跨平台数据。双倍占用的真正痛点(GB 级)已通过外置 seed 消除。

> embedding 维持 **bge-m3**(1024 维,中文/长文/hybrid 第一梯队)。不降级为 gte-multilingual-base:嵌入模型与 KB 索引绑定、维度不同(1024 vs 768)、换默认会触发存量库重建。gte 顶多作为后续「可选小嵌入」,默认不动。

## 4. 打包改造(build.py / release.mjs / tauri.conf)

**发行物(每平台两件):**
1. **瘦安装包**:app + 平台服务二进制 + 小资产(bgm/tts/ocr/whisper-tiny)+ nltk;**不含 GB 模型、不含 fonts**。
2. **`models_seed` 介质**(仅当该档带 GB 模型,主要是 pro):装 chat/embedding/rerank/digital_human。macOS = DMG 内含 `models_seed/` 文件夹;Windows = 现有 ISO;Linux = zip/目录。附 `.external_seed_manifest.json`。

**改动点:**
- `chayuan-server/packaging/pyinstaller/build.py`:
  - `bundled_models` 同步**按 cap 分流**:小 cap(tts/ocr/asr)进 Tauri resources;大 cap(chat/embedding/rerank/digital_human)进 `models_seed` external seed 目录 + manifest。复用现有 `do_external_split` 思路,从「按文件 2GB 阈值」改为「按 cap 白名单」。
  - `sync_video_generation_assets`:bgm 继续进 Tauri resources(随包);**删除 fonts 同步**;imagemagick 维持(平台二进制)。
- `chayuan-client/apps/desktop/src-tauri/tauri.conf.json`:`bundle.resources` 去掉 `bundled_fonts/**/*`;保留 `bundled_bgm`、小 cap 的 `bundled_models`。
- `release.mjs`:产物清单区分「瘦安装包」与「models_seed 介质」;lite/standard 通常无 `models_seed`。

## 5. 首启动 seed + 迁移(bundled_seed.py / 运行时路径)

- **首启动**:按 manifest 检查 `<CHAYUAN_ROOT>` 缺哪些资产 →
  - 小资产:从 **app 资源**拷进数据目录对应位置;
  - 大模型:从挂载的 `models_seed` **介质**拷进 `<ROOT>/models/bundled/<cap>`,完成后提示「可弹出/删除介质」。
  - 复用 `bundled_seed.py` 的 `_candidate_external_roots`(已覆盖 `/Volumes`、`/media`、Win 盘符)、manifest 校验、逐文件 `skip`(已存在即跳过)。
- **迁移(核心收益)**:B 机装瘦壳 → 数据目录指向「从 A 拷来的目录」→ manifest 检查发现**全在 → 全 skip → 不需要介质** → 直接用。路径在 registry 中相对 `CHAYUAN_ROOT`(如 `models/bundled/embedding/bge-m3`),config/db/runtime 均在 `<ROOT>/` 下,跨机解析成立。
- **运行时路径解析**:
  - bgm:`bgm_index` / `_helpers.font_dir` 等**只从 `CHAYUAN_ROOT` 读**(去掉「从 app vendor 读 bgm」的分支);
  - 模型:维持读 `CHAYUAN_ROOT/models/bundled`;
  - 平台二进制(llama/whisper/imagemagick):维持从 app 就地读(`binaries.py::_vendor_root`)。

## 6. 字体改系统字体

- 打包:去掉 `vendor/bundled_fonts` 同步与 tauri resources 条目。
- 后端:新增**枚举系统字体**接口(扫 OS 字体目录:macOS `/System/Library/Fonts`、`/Library/Fonts`、`~/Library/Fonts`;Windows `C:\Windows\Fonts`;Linux fontconfig / `~/.fonts`),给前端下拉。
- 前端:复用 `VgSubtitlePopover.tsx` 的字体选择,把「内置字体列表」换成「系统字体列表」。
- 字幕渲染:复用 `digital_human/overlay.py` 已有的「系统 CJK 字体兜底」+ `subtitle_ass.py`(ffmpeg ASS 烧入)路径,确保用**选中的系统字体文件**渲染,默认回退黑体(STHeiti / 微软雅黑 / Noto Sans CJK 按平台)。

## 7. 许可证(本期 C)+ 隐患记录

- 本期**不改许可证**。迁移只覆盖数据/模型/config;新机器需重新激活。
- **隐患记录(本期仅记录、不修)**:`license/fingerprint.py` 的 `_stable_machine_id` 在 `~/.chayuan/machine.id` 缺失时会回退读 `<CHAYUAN_ROOT>/license/machine.id`(在数据目录内)。后果:把 A 机数据目录整目录拷到一台**从未装过**的全新 B 机后,B 会读到随目录带过来的 A 机 `machine.id` 而**冒充 A 机** → 激活态被一并带走 = **机器绑定被绕过的盗版隐患**;反之 B 机若已有自己的 `~/.chayuan/machine.id` 则激活失效、且序列号已在服务端标「已用」无法重激活、用户卡死。后续二选一根治:① 服务端补「解绑/迁移」流程;② 收紧 legacy 回退(不再从数据目录派生指纹)。

## 8. 测试 / 验证

- 单测:`bundled_seed` 的 cap 分流、manifest 生成/校验、迁移 skip(目标已存在)。
- 集成(py312):首启动 seed → 数据目录就位 → 各 local runtime 起得来(chat/embedding/rerank/asr/ocr/tts)。
- 打包冒烟:瘦安装包不含 GB 模型 / 不含 fonts;`models_seed` 介质含四大项 + manifest;字幕用系统字体渲染不报 `font None`。
- 迁移验证:A 机数据目录拷到 B 机 → 指向后免介质直接可用;实测无重复 seed。
- 回归:bgm 在每个安装包都存在并可选;砍 fonts 后字幕不崩。

## 9. 风险

- **磁盘**:即便消除双份,GB 模型 + 视频渲染临时文件仍需富余空间;首启动 seed 前应做磁盘预检(沿用 `requireFreeGB` 思路,seed 目标盘)。
- **介质发现**:用户提前弹出 `models_seed` 介质会导致 seed 中断;沿用现有「external_pending,请重挂后重启」提示。
- **跨平台数据正确性**:确认进数据目录的都是跨平台格式(gguf/onnx/safetensors/mp3),平台二进制不得混入。
- **cap 分流误判**:大/小 cap 白名单要与 `local_index.BUNDLED_CAPABILITY_DIRS` 对齐,避免漏打或误外置。
