# 数字人引擎(Wav2Lip + SadTalker)纳入 bundled_models 自包含 + 模型脚本交互式多选

- 日期:2026-06-02
- 状态:已通过 brainstorming,待用户复审
- 影响项目:`chayuan-server`(打包真源 + 运行时 + 安装脚本)

## 1. 背景与问题

用户在数字人生成面板看到:
- `Wav2Lip · 快速(CPU)` 报「权重未就绪」—— `vendor/bundled_models/digital_human/wav2lip_gan.pth` 不存在;
- `SadTalker · 高清头动(GPU)· 未安装`,点「去模型厂商配置」跳 `/marketplace`,但模型广场没有数字人引擎条目、没有任何安装说明。

根因(已排查,非代码 bug):数字人多形象代码早已合入,但模型权重是独立 seed 步骤,从未在打包/装机链路里备齐。现有 `seed_digital_human.py` 只下到开发用 `vendor/`,打包后的桌面版运行时(读 `CHAYUAN_ROOT/models/bundled/`)看不到;SadTalker 走 modelscope pipeline 联网拉,不符合「full 版完全自包含、零下载」原则。

## 2. 目标

1. 让 `install-vendor.{sh,ps1} --flavor full` 自动把 Wav2Lip + SadTalker 权重备进 `vendor/bundled_models/`,随 full 安装包带上,装机即用、零下载。
2. SadTalker 运行时从本地 bundled 目录加载(`pipeline(model=<本地目录>)`),不再联网;未 seed 时回退联网兜底。
3. 给 `install-bundled-models.py` 增加**控制台交互式多选**:↑/↓ 移动、空格勾选/取消、`a` 全选/全不选、回车确认下载;非 TTY 环境(CI / 被 install-vendor 调用 / 显式给了 flag)不弹菜单,沿用现有 flag 行为。

## 3. 非目标

- MuseTalk:它是 git 仓 + 独立推理环境,不属于 bundled_models 模型下载,本设计不覆盖。
- LITE 安装包带 DH:LITE 故意不打 torch,DH 只进 FULL。
- 把外部 embedding/模型参数引入查询阶段等无关改动。

## 4. 关键事实(探索已确认)

- **FULL sidecar 已含 torch + torchvision + transformers**(`packaging/pyinstaller/chayuan-server.spec` 按 `LITE_BUILD` 条件收集);`modelscope` 是主依赖(`libs/chayuan-server/pyproject.toml`)。→ SadTalker 跑所需依赖在 full 里齐了,**只缺 checkpoints**。LITE 不打 torch。
- **加新 cap 的注册点共 4 处**:`bundle_manifest.py`(`FULL_CAPS` + `CANONICAL_MODEL_SUBDIRS`)、`build.py:_KNOWN_CAP_DIRS`、`local_index.py:BUNDLED_CAPABILITY_DIRS`。
- **`CANONICAL_MODEL_SUBDIRS[cap]` 是 tuple**,本就为「一个 cap 多变体子目录共存」设计(rerank 已这么用)。
- **modelscope `pipeline(model=<本地目录>)` 支持本地路径**(`model_registry/install_model.py` 有先例)。
- **Wav2Lip 权重来源**:ModelScope `silveroxides/ComfyUI_wav2lip-models`,取 `wav2lip_gan.pth`(~416MB)+ `s3fd-619a316812.pth`(~86MB)。
- **SadTalker 权重来源**:ModelScope `wwd123/sadtalker`@`v1.0.0`。
- **engine.py 现在平铺读** `vendor/bundled_models/digital_human/wav2lip_gan.pth`(无子目录),`infer.py:load_models` 找 `wav2lip_gan.pth` + `s3fd-619a316812.pth`。

## 5. 设计

### 5.1 bundled_models 结构(方案 A1)

单 `digital_human` cap,下挂两个引擎子目录:

```
vendor/bundled_models/digital_human/
  ├─ wav2lip/   { wav2lip_gan.pth, s3fd-619a316812.pth }
  └─ sadtalker/ { wwd123/sadtalker 快照全部文件 }
```

运行时镜像位置:`<CHAYUAN_ROOT>/models/bundled/digital_human/{wav2lip,sadtalker}/`。

### 5.2 install-bundled-models.py:MANIFEST 多模型扩展

MANIFEST 现状是「一个 cap 一个模型(单 `dest_subdir` + `hf`/`ms`/`urls`)」。扩展为:cap 可带 `models: [ {dest_subdir, hf, ms, urls, approx_mb, note}, ... ]`。

- 向后兼容:没有 `models` 键的旧 cap 走老路径不变;有 `models` 的 cap 逐个模型下载。
- `digital_human` cap:
  - model `wav2lip`:`dest_subdir="wav2lip"`,ms=`silveroxides/ComfyUI_wav2lip-models`,`allow_patterns=["wav2lip_gan.pth","s3fd-619a316812.pth"]`。
  - model `sadtalker`:`dest_subdir="sadtalker"`,ms=`wwd123/sadtalker`(revision `v1.0.0`;modelscope snapshot 不按 allow_patterns 卡死,取全仓 —— SadTalker 需多个权重文件)。
- 就绪判定:wav2lip 看 `wav2lip/wav2lip_gan.pth`;sadtalker 看子目录非空且含权重文件(复用 `_MODEL_WEIGHT_EXTS`)。

### 5.3 控制台交互式多选(纯 stdlib 跨平台)

- 触发条件:`sys.stdin.isatty() and sys.stdout.isatty()` 且**未显式给** cap 选择类 flag(`--only`/`--lite`)。否则跳过菜单,沿用 flag。
- 实现:Unix 走 `termios`+`tty` 读单字符;Windows 走 `msvcrt.getwch`。封装成一个 `select_models(items) -> list[chosen]`。
- 键位:`↑/k`、`↓/j` 移动;`空格` 勾选/取消;`a` 全选/全不选切换;`回车` 确认;`q`/`Ctrl-C` 取消(返回空 → 不下载、退出码 0)。
- 列表项 = 各模型(7 个旧 cap + digital_human 的 wav2lip/sadtalker),每行显示:勾选框 `[x]/[ ]`、显示名、`~大小`、就绪标记 `✓`(已存在则默认不勾)。
- 渲染:纯 ANSI 重绘(光标上移 N 行重画),不依赖 curses(Windows 友好)。

### 5.4 SadTalker 运行时本地加载

`sadtalker_server.py`:
- 新增 `_resolve_sadtalker_dir() -> Optional[str]`,镜像 `engine.py:_resolve_wav2lip_dir()`:依次查 `CHAYUAN_ROOT/models/bundled/digital_human/sadtalker/` → 从本文件向上找 `vendor/bundled_models/digital_human/sadtalker/`;命中且非空则返回。
- `_ensure_loaded()`:本地目录命中 → `pipeline(task=..., model=<本地目录>, model_revision=cfg revision)`;未命中 → 保留现有 `model="wwd123/sadtalker"` 联网兜底(开发/未 seed)。

### 5.5 engine.py:wav2lip 解析兼容子目录

`_resolve_wav2lip_dir()` 的 roots 既查平铺 `.../digital_human/`,也查 `.../digital_human/wav2lip/`(新布局)。两者都 `(dir/"wav2lip_gan.pth").is_file()` 命中即返回。保证旧平铺布局与新子目录布局都能用。

### 5.6 注册点改动汇总

1. `scripts/install-bundled-models.py`:MANIFEST 多模型扩展 + `digital_human` 条目 + 交互式多选。
2. `chayuan-server/packaging/bundle_manifest.py`:`FULL_CAPS += ("digital_human",)`;`CANONICAL_MODEL_SUBDIRS["digital_human"]=("wav2lip","sadtalker")`。
3. `chayuan-server/packaging/pyinstaller/build.py`:`_KNOWN_CAP_DIRS` 加 `digital_human`。
4. `chayuan-server/libs/chayuan-server/chayuan/server/model_registry/local_index.py`:`BUNDLED_CAPABILITY_DIRS` 加 `digital_human`。
5. `chayuan-server/libs/.../video_generation/digital_human/engine.py`:wav2lip 解析加子目录。
6. `chayuan-server/libs/.../modality/sadtalker_server.py`:本地解析 + `pipeline(model=本地)`。
7. README.md / `vendor/bundled_models/README.md`:补 digital_human 布局与 install-vendor 说明。

## 6. 错误处理 / 兼容

- 交互菜单非 TTY 兜底,保证 install-vendor 自动链路不被卡。
- SadTalker 本地未 seed 时回退联网,开发不阻断。
- wav2lip 新旧布局双兼容,不破坏已手动 seed 的环境。
- modelscope snapshot 双倍占盘(缓存+落地)+ 本机磁盘临界:脚本完成后提示可清 `~/.cache/modelscope`。

## 7. 验证计划

- `python -m py_compile` 所有改动 .py;`install-bundled-models.py --list` / `--check`。
- 交互菜单:在 TTY 跑一次,验证移动/勾选/全选/确认;非 TTY(管道)验证跳过菜单。
- `[GPU-VERIFY]`:SadTalker 本地加载 + 真推理需用户 GPU 环境实测。
- `[BUILD-VERIFY]`:`build.py` full 同步把 `digital_human/{wav2lip,sadtalker}` 打进 bundle、装机后运行时解析命中,需用户机器实测(沙箱无 GPU、conda 环境已被清)。

## 8. 风险

- SadTalker 全仓快照体积偏大(具体大小待实测),full 包随之增大 —— 用户已确认接受「塞进 full 自包含」。
- `pipeline(model=<本地目录>)` 对 `wwd123/sadtalker` 的本地布局要求需 GPU 环境实测对齐(modelscope talking-head pipeline 的本地加载行为)。
- 纯 stdlib TUI 在各类终端(Windows Terminal / conhost / 各 Linux term)的转义兼容需实跑覆盖。
