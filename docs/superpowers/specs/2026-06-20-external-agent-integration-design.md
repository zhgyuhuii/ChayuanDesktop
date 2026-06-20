# 察元 × OpenClaw / Hermes 双 Agent 集成 — 设计文档

> 状态：设计评审中（2026-06-20，第 2 轮自审已回填问题清单）。待范围确认后转 writing-plans。
> 范围：在察元（chayuan）中实现对 **OpenClaw** 与 **Hermes** 两个外部 AI Agent 框架的七项能力：
> ① 一键安装 ② 可视化配置 ③ 监控 ④ 双向对接/相互调用 ⑤ 全量查看技能/组件 + 翻译展示
> ⑥ 下载技能/组件 ⑦ 全生命期管理。**本文档只描述设计，不含实现代码。**

---

## 0. 背景与目标

用户群多为非工程师，终端门槛高；察元已有 KB / MCP / Tools / Marketplace 一系列「卡片化运维入口」。
本设计把对 OpenClaw / Hermes 这两个常驻 Agent 守护进程的全生命期管理 + 双向能力对接收进察元
可视化壳，并复用察元已有的 KB / 模型网关 / 多模态 / 鉴权 / 审计 / MCP 设施。

---

## 1. 两个外部系统的已核实事实（官方文档 / 源码实证）

> OpenClaw：真实公开项目，GitHub `openclaw/openclaw`（TS，作者 Peter Steinberger，2025-11 起，
> homepage openclaw.ai；与同名 Captain Claw 老游戏区分），npm `clawhub`，文档 docs.openclaw.ai。
> Hermes：Nous Research 开源（MIT，GitHub `NousResearch/hermes-agent`，文档 hermes-agent.nousresearch.com）。

| 能力面 | OpenClaw | Hermes |
|---|---|---|
| 安装 | `curl .../install.sh \| bash` / `install.ps1` / `npm i -g openclaw@latest`；`openclaw onboard --install-daemon` | `curl .../install.sh \| bash` / `install.ps1` / 桌面包；`hermes setup --non-interactive`（无 pip） |
| 配置 | `~/.openclaw/openclaw.json`（JSON5）；`openclaw config get/set/schema/validate`；UI `127.0.0.1:18789`；`SOUL.md` | `~/.hermes/config.yaml`+`.env`；`hermes config show/edit/set/check`（密钥自动入 .env）；`SOUL.md` |
| 监控 | `openclaw status/health/doctor`；`logs --follow`；WS `hello-ok`(uptimeMs)；**无独立 /health HTTP** | `hermes gateway status`/`status --all`；`~/.hermes/logs/gateway.log`；`:8642/health` |
| HTTP gateway | 默认 **18789**，OpenAI 兼容 + `/tools/invoke`；loopback，auth 默认开 | **8642**（`.env API_SERVER_ENABLED=true`）OpenAI 兼容 + `/v1/runs/{id}/events`；Bearer `API_SERVER_KEY` |
| MCP server（自身） | `openclaw mcp serve`（stdio/SSE/streamable-http） | `hermes mcp serve`（**仅 stdio**） |
| MCP client | `openclaw mcp add`（含 http） | `mcp_servers:` / `hermes mcp add`（url+headers+tools 过滤，mTLS/OAuth） |
| 自有模型端点 | `models.providers`（apiKey/baseUrl） | `model.provider: custom` + base_url/api_key |
| 技能市场 | ClawHub：`openclaw skills …`；`clawhub` CLI；`https://clawhub.ai` | `hermes skills …`；存 `~/.hermes/skills/`；**+ 内置 tools(不可下载) + plugins** |
| 生命期 | `openclaw gateway start/stop/restart`；`uninstall`；`doctor --fix` | `hermes gateway start/stop/restart`；`uninstall --full`；`doctor --fix` |
| 多实例 | `--profile`→`~/.openclaw-<name>`；**端口不自动避让**（需 `--port`）；偏「单 gateway 托多 agent」 | `-p`→`~/.hermes/profiles/<name>`，**每 profile 独立进程+token+端口**；官方推荐每用户一实例 |
| 沙箱 | `agents.sandbox.mode` off/non-main/all；Docker ns，默认 `network:none`；自承「非完美边界」；`tools.elevated` 绕过 | `terminal.backend` local/docker/ssh/singularity/modal/daytona；**官方明示「Profiles do not sandbox」** |
| per-user 鉴权 | 仅机器级 token/password/trusted-proxy | 仅实例级 `API_SERVER_KEY` |

**两系统高度同构** → 支撑「一套抽象、两个 adapter」。

---

## 2. 产品定位与边界（解决自审 #10：避免跟察元自身能力撞车）

察元同时拥有 chat / KB / Tools / MCP；OpenClaw/Hermes **也**有 chat / skills / MCP。必须定清边界，
否则用户迷路：「我跟谁聊？用谁的技能？」

- **察元 = 宿主 + 前台 + 知识/多模态供给方**。
- **外部 agent = 后台执行器 + 技能生态插件**（擅长常驻、跨会话记忆、cron、~万级技能）。
- 使用动线：用户主要在察元里操作；需要外部技能/常驻任务时，由察元把活**委托**给 agent；
  agent 需要知识/模型/多模态时，**回调**察元。两套 chat/skill 不并列暴露给用户当对等选项。

---

## 3. 顶层架构

```
┌─ chayuan-client（单页 AgentHub，OpenClaw/Hermes 切换，组件全复用）─────────┐
│   五态：未装向导 / 配置 / 监控 / 技能 / 日志（+ 服务器版 Fleet 实例列表）      │
└───────────────┬─────────────────────────────────────────────────────────────┘
                │ HTTPS/SSE（鉴权同 MCP/Tools）
┌───────────────▼─ chayuan-server ────────────────────────────────────────────┐
│  ExternalAgentConnector 抽象（照搬 knowledge_source connector 模式）          │
│   ├─ OpenClawAdapter   ┐ 共用 ~80%（两家同构）                                │
│   └─ HermesAdapter     ┘                                                      │
│  AgentInstanceManager（单实例/per-user spawner 同一接口，由 HostPolicy 决定）  │
│  控制面 = subprocess_runner（argv 白名单，文件锁防并发，版本/能力探针）        │
│  数据面 = HTTP gateway 调用 + chayuan MCP server（暴露 KB/多模态）             │
│  横切   = require_auth + authz + audit + per-system 总开关                    │
└────────┬──────────────────────────┬──────────────────────────────────────────┘
   CLI/HTTP                     CLI/HTTP
   openclaw(18789…)             hermes(8642…)
```

控制面走 CLI（只有 CLI 能装/onboard/管技能/起停），数据面走 HTTP gateway + MCP。
**前端不做两个页面，做一个 AgentHub + 系统切换器**，复用同一套组件。

---

## 4. 七项功能逐条落地

1. **一键安装**：按 OS 选命令，SSE 流式日志（**过滤密钥不外吐**，自审 #7）；OpenClaw 接
   `onboard`、Hermes 接 `setup --non-interactive`。⚠️ 两家首装均需联网（见 §10 离线开放问题）。
2. **可视化配置**：OpenClaw 有 `config schema` → schema 驱动表单；Hermes 字段表单 + `.env`/yaml 分流。
   **密钥字段 UI 脱敏、写入不回读、审计/日志过滤**（自审 #7）。两家均加 `SOUL.md` 编辑器。
3. **监控**：统一状态模型 `{installed, running, version, uptime, health, pid, instances?}`；日志 SSE。
   OpenClaw 无独立 /health → CLI status + `/v1/models` 兜底（弱，见 §10）。服务器版升级为「实例舰队」。
4. **双向对接**：见 §5（这是核心增量）。
5. **技能/组件查看 + 翻译**：统一 Skill 模型；Hermes 三类分开（内置 tools/skills 市场/plugins）；
   OpenClaw 为 ClawHub。翻译见 §7。
6. **下载技能/组件**：CLI install/uninstall/update + SSE；**装前权限预览**（ClawHub ~20% 恶意、
   Hermes 装时扫描），高危权限黄标；**卸载侧清理残留目录/容器/端口/路由**（自审 #15）。
7. **全生命期**：start/stop/restart/uninstall/doctor + reconcile。daemon 归属见 §6.1。

---

## 5. chayuan MCP Server（功能 ④ Provider 面，核心增量）

察元新增一个 **MCP server**，把「带引用的 KB 检索 + 多模态生成」暴露成标准 MCP 工具。
**一次实现，OpenClaw/Hermes/未来任何 MCP agent 通吃**。模型共享走 OpenAI 端点直插，不进 MCP。

- **传输**：主推 **Streamable HTTP / SSE**（两家 MCP client 均支持 HTTP server），挂 `/api/v1/mcp_server`。
  **自审 #14**：两家都支持 HTTP MCP，故 stdio 桥接二进制**默认不造**（省跨平台打包），仅在确有
  stdio-only 场景时再评估。
- **工具**：

  | MCP tool | 映射 | 同步? | 门控 |
  |---|---|---|---|
  | `chayuan_kb_search` | `POST /api/v1/kb-query/search` | 同步 | 通用 |
  | `chayuan_tts` / `chayuan_generate_image` / `chayuan_video_understand` | modality / `/v1/images` | 同步 | 通用 |
  | `chayuan_digital_human_generate`(+`_task_status`/`_task_result`) | `/api/v1/digital-human/*` | 异步三段 | **仅 desktop** |
  | `chayuan_video_generate`(+共用 task 工具) | `/api/v1/video-generation/*` | 异步三段 | **仅 desktop** |

  > DH/VG 是异步任务，**不能阻塞**（撞 180s worker 超时），拆三段由 agent 自取。
  > t2v/i2v 后端无独立端点，暂不暴露。
  > **自审 #17（不对称）**：DH/VG 仅在 desktop server，故**服务器版外部 agent 无法生成视频**——
  > 这是已知不对称，需在文案明示，别让人以为服务器版也能出片。

- **安全脊柱**：MCP 连接带 `Authorization: Bearer` → `require_auth_enabled()` 还原 user →
  `assert_readable(subject, ku_id)` **默认 deny** → `audit()`。红线：MCP 入参不接受外部覆盖 embedding 模型。
- **自审 #4（恶意技能借工具洗库，高危）**：per-ku_id 授权挡不住「合法身份的恶意调用」——
  agent 里一个恶意技能能以用户身份把其有权访问的整库捞走。**对策**：
  - KB 类工具**默认连工具都不给** agent，**用户显式按技能/按 KB 勾选授权**才放行；
  - MCP 工具层加**调用频率/配额限制** + **异常批量检索告警**；
  - 审计保留全量调用链。
- **自审 #3（per-user 凭证签发，服务器版缺口）**：agent 回调察元的 `Bearer <token>` 不能凭空出现。
  补 **per-user agent 凭证签发模块**：察元 spawn 实例时铸一个**绑定该用户的 scoped token**，注入
  agent 的 `.env`/config，支持过期轮换、注销即吊销。单机匿名档退化为固定本地 token。
- **自审 #13（模型共享成环）**：agent 模型指察元 `:62581/v1`，察元又能把 agent 当工具 → 可能
  `察元→agent→察元模型→…` 递归。**对策**：调用链深度上限 + 环路检测；约定 agent 用察元模型时
  不得在同一链路反向回调察元工具。
- **引用透传**：`Citation`(kb_id/name/snippet/score/doc_ref) 结构化塞进 tool result，让 agent 回答带出处
  ——这是察元相对两家的差异化能力。

---

## 6. 单机 vs 服务器：一套逻辑 + 一个 HostPolicy（核心架构决策）

**结论**：一个 `AgentInstanceManager` 抽象 + 一个 `HostPolicy` 策略对象，单机是退化配置
（JupyterHub「同一 single-user server，不同 spawner」范式）。

**关键洞察**：让「安装/装技能全放开」在单机安全的真因**不是「用户匿名」，而是「这是用户自己
的机器」**。真正分界是 **「可信独占主机 vs 共享多租户主机」**；**让两版安全的不是收紧权限，而是
收紧爆炸半径**。所以权限模型两版统一放开，**唯一不能随权限放开的是沙箱**。

| HostPolicy 字段 | 单机（trusted-local） | 服务器（shared-multitenant） |
|---|---|---|
| 实例数 | N=1 单例 | N，per-user spawn + 端口池 + 路由表 + idle-culler |
| 身份 | 匿名 owner | 多用户 auth + 实例绑定 + per-user 凭证（§5） |
| 安装/技能权限 | 全放开 | 全放开（限定到自己实例内） |
| **沙箱** | **off**（自己机器） | **强制**（OpenClaw `sandbox.mode=all`+Docker+`network:none`+禁 `tools.elevated`；Hermes `terminal.backend=docker/singularity`，禁 local/ssh） |
| 资源/回收 | 无 | 配额 + idle-culler + 懒启动 |
| spawn 目标 | 客户机本地 | 服务器（web 不能 spawn，经 server） |

- **策略派生**：从现有 `AUTH_REQUIRED` 派生——关 auth → trusted-local；开 auth → shared-multitenant。
- **服务器多实例**：OpenClaw `--profile <user> --port <分配>`（端口须显式分）；Hermes `-p <user>` +
  各自 `.env API_SERVER_PORT/KEY`。端口由 spawner 自分自记（username→port 路由表），不端口扫描；
  实例死了移路由（抄 JupyterHub `poll()`）；有状态会话同 session_id 黏连。

### 6.1 daemon 生命期归属（解决自审 #1 双主冲突）

两家装时自带 systemd/launchd 服务，**OS 已在管 daemon**。察元若同时 spawn/stop 会与服务管理器打架。
**决策（写死）**：**agent 由其自带 OS 服务管理器拥有常驻**；**察元只通过 CLI/HTTP 控制，不自己
detached-spawn、不与 systemd 抢**。安装时若要察元托管则显式不装 OS 服务，二者只取其一。
**自审 #12（桌面父子）**：单机由 agent 自己的 OS 服务常驻，**不挂在易重启的 Python sidecar 下**，
避免 sidecar 重启把 agent 变孤儿/误杀（历史反复踩的坑）；进程操作一律进程组级。

### 6.2 服务器沙箱与嵌套部署（解决自审 #2 Docker-in-Docker；已拍板 sysbox）

服务器版 per-user agent 一律走容器后端做隔离。**决策（2026-06-20）**：当 chayuan-server 自身
部署在容器里时，**用 sysbox runtime 跑子容器**（免特权、近原生 Docker 体验），**不用裸 DinD/特权
容器**；裸机/VM 部署则直接用普通 Docker 后端。即 OpenClaw `sandbox.mode=all`+Docker(sysbox)、
Hermes `terminal.backend=docker/singularity`（均跑在 sysbox 子容器内）。
**自审 #7（出网）**：沙箱出网走 **egress allowlist + SSRF 代理**（抄 Dify），不简单二选 `network:none`。
**自审 #16（并发）**：config 编辑/装卸/起停加文件锁，防 race。
---

## 7. 技能/组件翻译（功能 ⑤：察元 LLM 实时翻 + 缓存）

- 复用察元模型网关 `/v1/chat/completions` 翻 `name + description`（卡片）与 `SKILL.md` 正文（懒翻）。
- 缓存键 `(system, skill_id, version, field, lang, src_hash)` 落 SQLite；离线本地模型也能翻；**缓存全局共享**。
- UI 双语切换（默认中文，可看原文），标「机器翻译」。
- **自审 #11（安全攸关文本不机翻）**：**权限清单不机翻**——保留规范原文 + 固定词表对照，避免机翻
  误导用户对恶意技能放行；只机翻营销性名/描述。

---

## 8. 复用的察元现成设施（实证 file:line）

> 主仓 `/work/chayuan-server`；DH/VG 仅 desktop 副本 `/work/chayuan-desktop/chayuan-server`。

- KB 查询：`POST /api/v1/kb-query/search`；`kb_query/schemas.py:63-106`；响应
  `retrieval/query/orchestrator.py:169-196`；refs `retrieval/query/refs.py:36-90`。
- OpenAI 端点：`openai_routes.py`（chat:347 / embeddings:365 / images:430 / speech:475）；sidecar **62581**。
- 多模态：TTS `modality_routes.py:34`→`modality/service.py:103`；video understand `modality/service.py:115`。
- DH：`POST /api/v1/digital-human/generate`（`digital_human_routes.py:562`，`DhGenerateRequest`）；轮询/取件。
- VG：`POST /api/v1/video-generation/tasks`（`video_generation_routes.py:276`，`runner.py:78`）；SSE events。
- MCP 现状：**仅 client**（`mcp_routes.py` `/api/v1/mcp_connections`；`mcp_kit/client.py`）→ **MCP server 是新增**；
  前端 `packages/app/src/features/mcp/McpPage.tsx`。
- 鉴权/审计：`auth/deps.py:87`；`kb_query/authz.py:80-92`；`observability/audit.py:45`；`api_server/middleware.py`。

---

## 9. 分期（按自审 #5 砍范围：v1 收成「单机 + OpenClaw + 托管闭环」）

> **理由**：7 功能 × 2 系统 ×（单机 + 服务器多租户：spawner/端口池/路由/culler/沙箱/Fleet）+ 新
> MCP server + 翻译 是多月体量；**服务器多租户单拎就是半个产品**。先用一个 hero 场景验证抽象，
> 其余只在抽象层预留缝、分批实现。**「两版一起上」在工程上不现实，故拆分。**

| 阶段 | 范围 | 产出 / 退出标准 |
|---|---|---|
| **v1（Hero）** | **单机 trusted-local + 仅 OpenClaw + 功能 1/2/3/7**（装/配/监控/生命期）+ AgentHub 壳 + `ExternalAgentConnector`/`AgentInstanceManager`/`HostPolicy` 抽象骨架（**只实现 OpenClaw+trusted-local，但接口缝把 Hermes/shared-multitenant 预留**）+ per-system 总开关 + fake-agent 契约测试（§11） | 一台机从零装好 OpenClaw、能配能监控能起停；接口缝定死 |
| **v2** | 加 **HermesAdapter**（复用抽象，验证抽象正确）+ 功能 **5/6 技能**（查看/搜/装/卸 + 翻译缓存，权限不机翻） | 两家可切；技能能看能装、中文化 |
| **v3** | 功能 **4 对接**：chayuan MCP server（§5，含 #4 KB 授权门控 + #13 环路保护）+ 模型共享 + 察元反向调 agent 工具；per-user 凭证在单机退化为本地 token | 双向互通（仍单机） |
| **v4（Server，并入主线，v3 后紧接做）** | `shared-multitenant` 实现：PerUserSpawner + 端口池/路由表/culler + **强制沙箱（sysbox 子容器，§6.2）** + per-user 凭证签发（§5 #3）+ Fleet UI + 资源配额 | 服务器多用户隔离托管 |
| **离线轨（内网，并行工作流）** | 预置离线安装包（OpenClaw npm offline mirror / Hermes 捆绑 runtime + 离线 wheel）；先 PoC 验证可行性后全量，挂在功能①安装上 | 内网无外网也能装外部 agent |

每阶段独立可发；v4 体量大但**并入主线、v3 后紧接做**（非单独立项）；离线轨与 v1/v2 并行推进。

---

## 10. 风险与未知

1. **OpenClaw 极新、改名频繁、命令/端口（18789）可能变** + **LICENSE 为 NOASSERTION**（非想当然
   MIT）→ 命令/端口配置化 + **版本/能力探针 + 解析失败优雅降级**（自审 #8）；分发/多实例托管前**核实许可证**。
2. **战略脆性（自审 #18）**：把 7 个深功能压在两个**不可控、曾被自己定位为竞品**的快速迭代外部 CLI
   上，它们 break/弃坑则本块 UX 跟着塌 → 每系统**总开关**（不可用即入口隐藏、接口 404、零成本）兜底。
3. **内网/离线安装（已拍板：纳入范围，需专门攻克）**：内网版**要支持**外部 agent。OpenClaw
   `npm i -g`（传递依赖）+ Hermes 自带 Python/Node runtime，离线安装需**预置离线包**——OpenClaw 走
   内网 npm offline mirror / 打包好的 node_modules，Hermes 走捆绑 runtime + 离线 wheel。落为独立
   「离线轨」（§9），**先做可行性 PoC 再全量**，PoC 不通则该环境降级为「需联网装一次」。
4. **监控弱点**：OpenClaw 无独立 /health，`/v1/models` 兜底在 gateway 半启动时可能误判，需实测。
5. 两家**日志磁盘路径部分未文档化** → 落地实测，别照搬第三方博客。
6. **恶意技能**：除 §5 #4 的 KB 授权门控外，服务器版强制沙箱（§6.2）；不擅自安装/启动，全程用户确认。
7. **不安全默认绝不能漏进服务器版**（单机无 auth/沙箱 off 是 trusted-local 专属）——最危险分叉点，
   策略派生须保证开 auth 即切 shared-multitenant 全套默认。
8. MCP Streamable HTTP 必须校验 Origin + 鉴权；服务器 LiteLLM 式网关（per-user 虚拟 key/聚合/健康剔除）
   为 v4 可选增强。

---

## 11. 测试策略（解决自审 #6：外部二进制无法进 CI）

- **fake agent**：实现一个 mock CLI + mock HTTP gateway（按 §1 表的命令/端点契约伪造响应），adapter
  对 fake 跑**契约测试**（install/config/status/skills/lifecycle 全路径），不依赖真装 OpenClaw/Hermes。
- **真集成**：少量 smoke（人工或带网络的专用 job）真装一次跑通关键链路。
- **安全回归**：per-ku_id deny、KB 工具默认不授权、密钥脱敏、环路保护各加用例。
- 后端 pytest 用 `reference_py312_test_env`（本机 root conda py312）。

---

## 12. 待决问题清单（2026-06-20 已拍板）

- [x] §6.1 daemon 归属：**采纳**「agent 自带服务常驻、察元只控不持有」。
- [x] §6.2 容器内沙箱：**用 sysbox 跑子容器**（支持嵌套部署，免裸 DinD）。
- [x] §10.3 内网外部 agent：**纳入范围**，离线安装作为独立「离线轨」（先 PoC）。
- [x] v4 服务器多租户：**并入主线**，v3 后紧接做（非单独立项）。

---

## 13. 评审记录

- 2026-06-20：确认 ① 单机+网络两版都要（但工程上按 §9 分期，v1 仅单机+OpenClaw）；② 翻译走察元
  LLM 实时翻+缓存（权限不机翻）；③ 先抽象再双系统（抽象 v1 即定，实现分批）；④ 单机/服务器收敛为
  「一套逻辑 + 一个 HostPolicy」，沙箱不随权限放开。
- 2026-06-20 第 2 轮自审：回填 18 条问题（🔴1-6 / 🟡7-13 / 🟢14-18），按 #5 重写分期为 v1-v4。
- 2026-06-20 §12 拍板：daemon agent 自持 / 容器内沙箱用 sysbox / 内网纳入范围(离线轨) / v4 并入主线 v3 后接做。
