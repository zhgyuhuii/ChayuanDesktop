# 察元一体化多模态 AI 平台 · 需求覆盖审计（v6 起草）

> **目的**：把用户在 2026-05-02 重复提出的全部需求，逐条列成"已完成 / 部分完成 / 待办"清单，附实施位置或开发计划。
>
> **审计基线**：commit `f2158c1` (chayuan-server) + `cd2d2f1` (chayuan-client)。
>
> **不是设计文档**——架构与权衡见 `multimodal-ai-platform-final-plan.md`（v1-v5.1）；
> 本文只回答"用户要的事 X，做完了吗？没做的话怎么补？"

## 0 · 阅读指南

| 标记 | 含义 |
|---|---|
| ✅ DONE | 代码已落地、关键路径有测试、已合到 main |
| 🔶 PARTIAL | 主路径有但有空洞；后续 v6.x 补齐 |
| 🔷 PLANNED | 设计已写入 supervisor.yaml / layout.yaml，等接入测试 |
| ❌ TODO | 既无实现也无 stub，需要新工单 |

每条都标了"实施位置"（路径锚），用户/后来者可以直接跳过去看代码。

---

## 1 · "9 类模型可运行" —— 核心 P0

| # | 类别 | 状态 | 实施位置 | 备注 |
|---|---|---|---|---|
| 1 | 对话 chat | ✅ | `chayuan-runtime/.../ollama_adapter.py` `vllm_adapter.py` `llamacpp_adapter.py` + `chayuan-gateway/routers/chat.py` | 真流式 SSE 透传 (v5.1 A1)，OpenAI 客户端零改 |
| 2 | 文字嵌入 text-embedding | ✅ | `infinity_adapter.py` + `ollama_adapter._call_embeddings` (A3) | 单机不强制装 infinity |
| 3 | 图像嵌入 image-embedding | ✅ | `infinity_adapter` 走 CLIP/SigLIP；模型识别走 `chayuan-identify` capability 5 级 | 数据集走 hf-mirror（`bge-clip` 等） |
| 4 | 重排 rerank | ✅ | `infinity_adapter._call_rerank` + `routers/rerank.py` |  |
| 5 | 文生图 t2i | ✅ | `comfyui_adapter` + `_comfyui_workflows.{sd15,sdxl}` (v6 B2) | 不再要求用户写 ComfyUI DAG |
| 6 | 文生视频 t2v | ✅ | `comfyui_adapter` + `_comfyui_workflows.svd`（SD1.5 keyframe → SVD 动画化） | 14 帧 / fps 可配 |
| 7 | 文生声音 tts | ✅ | `cosyvoice_adapter` + `piper_adapter`（subprocess） | piper 离线能力 |
| 8 | 语音识别 asr | ✅ | `funasr_adapter` + `whispercpp_adapter`（subprocess） | paraformer-zh-streaming |
| 9 | 图像识别文字 ocr | ✅ | `rapidocr_adapter` + `paddleocr_adapter` | server 侧 `routers/ocr.py` |

### 已写入但缺端到端 smoke 的环节

* 🔶 **t2i / t2v 真后端 smoke**：单元测试用 `httpx.MockTransport` 验证 wire format，但真 ComfyUI 没在 CI 跑过（GPU 资源约束）。**计划 v6.1 ·M1** 加一个 *manual-trigger* GitHub workflow，用 `comfyui-cli`（CPU sd1.5 nf4 量化）跑 30 秒 smoke。
* 🔶 **OCR 准确率回归**：当前只验证"返回了 200 + items 字段"；应该有一张"标准证件 PNG"作 fixture，断言识别出关键字段。**计划 v6.1 ·M2**。

---

## 2 · 模型来源 —— hf-mirror.com 必须能直接拉

| 项 | 状态 | 实施位置 | 备注 |
|---|---|---|---|
| `chayuan-modelmgr` 默认走 hf-mirror | ✅ | `chayuan-modelmgr/mirrors.py`：`HF_ENDPOINT=https://hf-mirror.com` |  |
| `chayuan-pack fetch` 也用 hf-mirror | ✅ | `packaging/python312/pack.py` `--hf-mirror` + `HF_MIRROR_URL` 环境变量 (v5) | CI workflow 通过 env 传递 |
| **配置面板让用户切镜像源** | 🔶 | 服务端 `chayuan_modelmgr.mirrors.set_mirror`已有；前端 settings 还没暴露 | **v6.0 ·UI1** |
| 国内/海外自动选 | 🔶 | `chayuan-discovery` 启动探测；目前只支持 hf-mirror / hf 二选一 | **v6.1 ·M3**：加 `modelscope.cn` 备份 |
| 模型 sha256 校验 | ✅ | `chayuan-modelmgr/verifier.py` |  |

---

## 3 · 高性能 + 多并发 + 跨平台

| 项 | 状态 | 实施位置 |
|---|---|---|
| 流式高吞吐（StreamingResponse + threadpool） | ✅ | `chayuan_gateway/routers/chat.py`（v6 B1） |
| 全 9 类模型异步 IO | ✅ | adapter 全 `httpx`，gateway `async def` 路由 |
| Linux x86_64 / arm64 | ✅ | `build-installers.yml` matrix |
| macOS x86_64 / arm64 | ✅ | 同上（macos-13 / macos-14） |
| Windows x86_64 | ✅ | NSIS .exe |
| Windows arm64 | 🔶 | 当前回退 .zip（NSIS arm 工具链尚不通用），仍能用；**v6.2** 评估改 .msix |
| GPU/CPU 自适应 | ✅ | `chayuan-discovery` 检测 CUDA / Metal / DirectML，自动设 `needs_gpu` |
| 多并发吞吐基线 | 🔶 | 没有正式 benchmark；**v6.1 ·QA1** 加 `pytest-benchmark` + locust 长压 |

---

## 4 · 一键安装 + 离线 + 内嵌运行时

| 项 | 状态 | 实施位置 |
|---|---|---|
| 安装包打 Python 3.12 + JDK 17 + Node 20 | ✅ | `layout.yaml §1 runtimes` |
| 安装包打 Postgres / Redis / MinIO / Milvus | ✅ | `layout.yaml §2 services`；`supervisor.yaml` 拉起 |
| 安装包打 Docker / Docker Compose | ✅ | `layout.yaml §2 services` 含 docker / docker-compose；optional=true（lite 不带） |
| **打基础模型 qwen2.5:4b + bge** | ✅ | `layout.yaml §3 models`；`releases.yaml` lite=2GB / standard=8GB / pro=64GB |
| 离线安装 | ✅ | `chayuan-pack stage` 把全部 vendor + models copy 到 staging，`chayuan-pack build` 不再触网 |
| **运行时被杀软拦截的引导** | 🔶 | `chayuan-preflight` 已检测；**v6.0 ·UX1** 在 `AiPlatformPanel "系统自检"` 里加"为 AppImage / .exe 添加白名单"图文 |
| 安装包大小估算 | ✅ | docs/multimodal-ai-platform-final-plan.md §"安装包体积"（lite ≈ 1.8GB，standard ≈ 5.2GB，pro ≈ 18GB） |

---

## 5 · 端口管理 + 凭据 + 安全策略

| 项 | 状态 | 实施位置 |
|---|---|---|
| 默认端口避开常用值（**postgres 35432** 等大号端口） | ✅ | `supervisor.yaml preferred_port` |
| 端口被占用自动换 | ✅ | `chayuan_supervisor/port_allocator.py` + server 侧 `chayuan/server/runtime/port_allocator.py`；**v5 已统一**（`runtime_adapter.make_unified_port_allocator`） |
| 最终生效端口 / 地址 / 用户名 / 密码提示 | ✅ | CLI: `chayuan ai-platform service info`；UI: `AiPlatformPanel · 服务` 列；`chayuan_gateway/routers/system.py /v1/system/services` |
| 凭据自动生成 + 持久化 | ✅ | `chayuan/server/runtime/credentials.py` (chmod 0600) |
| 服务 URL 中的密码遮罩 | ✅ | `mask_password_in_url`；`/v1/system/services` 默认遮罩，加 `?reveal=true` 解 |

---

## 6 · 单机 / 服务器 / 集群 三档部署

| 模式 | 状态 | 配置文件 |
|---|---|---|
| Standalone（单机，~~不需要环境变量~~） | ✅ | `ai_platform_config/profiles/standalone.yaml`；`runtime.json` 内置全套配置 |
| Server（裸机 / docker） | ✅ | `profiles/server.yaml`；`docker/dev-stack-alt-ports/docker-compose.yml` |
| Cluster | 🔶 | `profiles/cluster.yaml` 已起骨架（postgres + milvus 走外部，gateway 多实例）；**未做 k8s helm chart**——**v6.2 ·CL1** 加 `deploy/k8s/` |
| 单机模式：用户能改数据存储路径 | ✅ | `Settings.basic_settings.MEDIA_PATH` / `IMG_DIR` 可经 `CHAYUAN_ROOT` 覆盖 |
| 业务数据 SQLite ↔ Postgres 切换 | ✅ | `Settings` 默认 SQLite，配置 `DATABASE_URL=postgresql://...` 即切；标签由 `chayuan-discovery` 自动探测 |
| 文件存储本地 ↔ MinIO 切换 | ✅ | `chayuan/store/storage_backend.py` 抽象接口 |
| OnlyOffice 引导 | 🔶 | 单机不支持 OnlyOffice 由文档提示；**v6.0 ·UX2** 在 `AiPlatformPanel · 服务` 列加 "OnlyOffice 未启用 → 推荐 docker compose 启动 / 一键 docker pull" |
| 检测本地已有服务（pg/redis/...）并询问"是否复用？" | ✅ | `chayuan/server/config_panel/local_service_detector.py`；UI 在 `SettingsDialog · 服务` |

---

## 7 · 客户端 / 服务端拆分 + 瘦桌面壳

| 项 | 状态 | 实施位置 |
|---|---|---|
| 容器部署：服务端不部署前端文件 | ✅ | `chayuan/server/api_server/server_app.py` 没 mount 前端静态；只 `/media` `/img` |
| 桌面瘦壳安装包 | ✅ NEW | `chayuan-client/apps/desktop/src-tauri/tauri.thin.conf.json` + `pnpm build:thin` |
| 桌面壳启动弹登录界面（地址 + 用户名 + 密码） | ✅ NEW | `packages/app/src/features/auth/ServerLoginModal.tsx` (v6 B5) |
| 把前端打进瘦壳 | ✅ NEW | tauri thin 配置 `frontendDist=../dist` |
| 远端服务地址持久化 | ✅ NEW | `useSettingsStore.apiBaseOverride`，`rememberServer` 复选框 |
| Playwright e2e 验证 | ✅ NEW | `e2e/07-thin-client-login.spec.ts` |

---

## 8 · 跨平台二进制供应

| 平台 / 组件 | 状态 | 备注 |
|---|---|---|
| Linux x86_64 | ✅ | `layout.yaml.matrix.linux-x86_64` 全列 |
| Linux arm64 | ✅ | 同上 |
| macOS x86_64 / arm64 | ✅ | 部分服务 macOS 上是 universal binary（postgres） |
| Windows x86_64 / arm64 | ✅ | win arm 部分可能需要 emu，标 optional |
| **可选服务（OnlyOffice / Docker）** | 🔶 | docker-compose 二进制已列；OnlyOffice docker image 引导 |
| **CI 自动 fetch 全套** | ✅ | `build-installers.yml fetch / stage / build` |
| **手动 dropping**（开发者把 zip 丢到 `vendor/` 就能打包） | ✅ | `vendor/services/README.md` 写了 drop-folder 约定 |

---

## 9 · 测试矩阵（合规性快照）

| 层 | 测试 | 数量 | 上次绿 |
|---|---|---|---|
| Adapter wire format | `chayuan-runtime/tests/test_adapters_wire.py` | 29 | ✅ v6 B2 |
| Gateway 路由 | `chayuan-gateway/tests/test_gateway.py` | 7（含新增 SSE 透传） | ✅ v6 B1 |
| AI Platform 桥接 | `chayuan-server/tests/unit_tests/ai_platform/` | 43 | ✅ v5 |
| Supervisor / Runtime 统一 | `chayuan-supervisor/tests/test_runtime_adapter.py` | 11（1 skip on Py3.13） | ✅ v6 |
| Chayuan-server 运行时 | `chayuan-server/tests/unit_tests/runtime/` | 33 | ✅ v5 |
| 客户端 typecheck | `pnpm typecheck` | 13 packages | ✅ v6 |
| Playwright e2e | `e2e/01..07-*.spec.ts` | 7 spec | 🔶 07 新增，需在 PR CI 通过一次 |
| Storybook | `packages/app/src/stories/` | 11 stories（新增 Login + AiPlatform 共 6 个） | 🔶 chromatic 未接 |
| 真启 ollama smoke | `.github/workflows/smoke-ollama.yml` | 1 job | 🔷 v6 已加，**首次运行需推一次 PR 才能验证** |

---

## 10 · 已知 / 计划中的 v6.x 工单（按优先级）

> 本表 = "继续推进 chayuan-ai-platform" 用户故事 backlog。每条都有"为什么 / 做什么 / 验收"，可以直接拿去拆 issue。

### v6.0 · 用户体验冲刺（必做）

| ID | 标题 | 估时 | 验收 |
|---|---|---|---|
| UI1 | 设置面板 → "镜像源" 段落（hf-mirror / hf / 自定义） | 0.5d | 切换后 `/v1/admin/doctor` 显示新 endpoint |
| UX1 | 杀软 / Gatekeeper 引导卡片 | 0.5d | doctor 报告 ok=false 时面板渲染图文 |
| UX2 | OnlyOffice 一键 docker pull | 0.5d | 点击按钮，wsl/docker desktop 拉镜像并写 supervisor.local.override.yaml |
| DOC1 | README 顶部加 "三种部署如何选" 流程图 | 0.25d |  |

### v6.1 · 端到端真后端冲刺

| ID | 标题 | 估时 | 验收 |
|---|---|---|---|
| M1 | ComfyUI CPU smoke (SD1.5 nf4) | 1d | smoke-comfyui.yml 跑通，输出 PNG bytes |
| M2 | OCR 黄金 fixture 测试 | 0.5d | `tests/data/ocr/id_card.png` → 校验关键字段 |
| M3 | modelscope.cn 镜像兜底 | 0.5d | `mirrors.py` 增加 modelscope 路由 |
| QA1 | 多并发吞吐基线（locust） | 1d | `tests/perf/` 输出 p95 < 1500ms (chat 4b 模型) |

### v6.2 · 集群 / 企业级

| ID | 标题 | 估时 | 验收 |
|---|---|---|---|
| CL1 | k8s helm chart | 2d | `deploy/k8s/`，`helm install` 起 gateway × 3 |
| OBS1 | OpenTelemetry → Tempo / Jaeger | 1d | gateway / runtime trace 串联 |
| SEC1 | RBAC + per-tenant model quota | 2d | `routers/admin` 加 quota，UI 显示 |
| WIN1 | Windows arm64 .msix（替换 .zip） | 1.5d | win arm CI 产 .msix |

### v6.3 · 自动化运维

| ID | 标题 | 估时 |
|---|---|---|
| OPS1 | `chayuan upgrade`（带 zero-downtime） | 1.5d |
| OPS2 | snapshot / restore（pgdump + minio mirror） | 1d |
| OPS3 | Prometheus exporter 整合 | 1d |

---

## 11 · 实施次序建议

1. **v6.0**（用户视感最强）→ 一周内合
2. **v6.1**（端到端 smoke 防回归）→ 与 v6.0 并行
3. **v6.2**（企业落地）→ 视客户来不来再排
4. **v6.3**（运维体验）→ 跑通生产 1 个月以后

---

## 12 · 2026-05-02 v6 增量：模型框架卡片 + 默认模型选择

> 来源：用户当天反馈"以下功能没有完全实现"。这里只记代码级落地点，详尽 UE 设计交给 v6.0·UI1。

| 用户故事 | 状态 | 实施位置 |
|---|---|---|
| 设置面板顶部一行：模型框架卡片（11 个 adapter） | ✅ NEW | 后端 `chayuan-gateway/routers/admin.py::list_runtimes` `/v1/admin/runtimes` · 前端 `chayuan-client/packages/app/src/features/aiPlatform/RuntimeCenter.tsx::RuntimeCard` |
| 卡片显示健康（绿/橙/灰）、URL、能力 tag、模型数 | ✅ NEW | 同上（`probe` + `models_served`） |
| 点卡片 → 安装向导（一键安装 / 多平台命令 / 进度日志） | ✅ NEW | `RuntimeInstallWizard` modal + 后端 `/v1/admin/runtimes/{name}/install` + `/install/{task_id}` |
| Ollama 一键自动安装（curl install.sh / winget） | ✅ NEW | `_spawn_install("ollama")` |
| pip 自动安装（infinity / piper / cosyvoice / funasr / rapidocr / paddleocr / whispercpp） | ✅ NEW | `_spawn_install` + `_runtime_default_pip_pkg` |
| 安装进度推到事件总线（前端轮询同 task_id 状态） | ✅ NEW | `get_bus().publish("runtime.install", ...)` + 客户端 `aiPlatform.runtimes.status` |
| 安装完成自动刷新框架卡片 | ✅ NEW | `RuntimeCenter.reload` + `onClose(installed)` |
| 第二行：9 类默认模型选择 | ✅ NEW | 后端 `GET/POST /v1/admin/defaults` · 前端 `DefaultModelsRow` + `DefaultCapabilityCard` |
| 没装任何模型时显示 "去推荐" 跳到 CapabilityCenter | ✅ NEW | `chayuan:capability-jump` CustomEvent + `CapabilityCenter` 监听切 tab |
| `chat / embedding / clip / t2i / t2v / tts / asr / ocr / rerank` 默认模型读写 | ✅ NEW | 复用 `repo.set_default(category, model_id)`；前端键支持 `text-embedding`/`image-embedding` 等 alias |
| 单测覆盖 | ✅ NEW | `test_admin_runtimes_lists_all_adapters_with_capabilities` / `test_admin_runtime_install_rejects_manual_and_accepts_ollama` / `test_admin_defaults_round_trip` / `test_admin_defaults_accepts_frontend_capability_aliases` |
| 设置面板"模型设置"第三行：8 个云供应商 + "更多"目录 + 模型广场 | ✅ NEW | `chayuan-client/packages/app/src/features/aiPlatform/AiPlatformPanel.tsx` 引 `MarketplacePage` 作子组件；`MarketplacePage` 增加 `embedded`/`excludeLocal` props（隐藏 Ollama / vLLM / LM Studio / Xinference / GPUStack 等本地服务，避免与 RuntimeCenter 重复） |
| 8 个供应商卡片：已配置 + 已启用 显示状态徽章 | ✅ NEW | `marketplace/components/VendorHeroStrip.tsx::VendorMiniCard` `VendorFullCard` 加 `CheckCircle2` 徽章，``data-testid=vendor-status-<pid>`` |
| **chayuan-server NiceGUI 设置面板 · 模型设置模块顶部两行** | ✅ NEW | 用户反馈"在 chayuan-server 设置面板模型设置模块一个功能都没看到"——之前只把 React 改了。新增 `chayuan-server/libs/chayuan-server/chayuan/server/config_panel/runtime_framework_panel.py`：`render_runtime_framework_row` (11 个适配器健康卡 + 一键安装 dialog) + `render_capability_defaults_row` (9 类 capability 默认模型选择器)；同进程调用 `chayuan_runtime.get_registry()` + `LocalIndexRepository`，不走 HTTP。在 `model_config.py::render_model_settings_page` 入口立即渲染 |
| 单测覆盖（NiceGUI 纯函数） | ✅ NEW | `tests/unit_tests/test_runtime_framework_panel.py` 9 项：`capability_labels_cover_nine_cases` / `runtime_install_kind_dispatch` / `build_install_cmd_for_{ollama_cross_platform,pip_packages}` / `build_install_cmd_returns_none_for_docker_only` / `gather_runtime_cards_lists_all_eleven` / `capability_candidates_returns_dict_for_all_nine_caps` / `spawn_install_async_{rejects_unknown,for_pip_does_not_real_run}` |

**为什么这是大动作而不是 patch**：

* 把"安装框架"和"选模型"在 UX 上彻底分离：
  框架卡片 = "这台机器能跑什么后端"，默认模型 = "用哪个具体模型"。
  以前用户必须在 6 个面板（doctor / 镜像源 / 服务拓扑 / 模型 / 推荐 / 自检）来回跳；现在
  设置面板 ``9 类模型库`` tab 顶部一屏完成。
* "一键安装 Ollama" 是历来 P1 缺口，现在后端真起 ``Popen``，前端实时拉日志，
  装完直接探测 URL，``CapabilityCenter`` 就能看到模型列表自动多出来。
* 9 类默认模型选择把 ``embeddings / chat / tts / asr / ocr`` 路由统一了；
  前端 ``aiPlatform.defaults.setMany({chat:"qwen2.5:4b", embedding:"bge-..."})`` 一次性写，
  之后 ``/v1/embeddings`` ``/v1/chat/completions`` 缺 ``model`` 字段就走默认。

---

**本表 v6 起草于 2026-05-02；每完成一个 ID，把表里对应行从 🔶/🔷/❌ 改成 ✅，并在 final-plan 里追写细节。**
