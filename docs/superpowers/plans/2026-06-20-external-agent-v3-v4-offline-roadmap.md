# External Agent v3 / v4 / 离线轨 — 里程碑级实施计划

> **说明（重要）**：v1、v2 是逐行 TDD 计划（见同目录两份文档）。本文件覆盖 **v3（对接）/ v4（服务器多租户）/ 离线轨**，
> **刻意停在里程碑级**——给出目标、文件结构、里程碑任务、接口契约、测试策略、验收与开放问题，但**不逐行铺代码**。
> 原因：这三档强依赖 v1/v2 落地后的真实抽象与锚点（MCP server 选型、`AgentInstanceManager` 的真实形状、
> sysbox 宿主可用性），现在逐行写必然返工。**各档轮到时，再按 writing-plans 展开为逐行 TDD。**
>
> 设计依据：`docs/superpowers/specs/2026-06-20-external-agent-integration-design.md` §4/§5/§6/§9/§10。
> 前置：v3 依赖 v1+v2；v4 依赖 v3 抽象验证；离线轨与 v1/v2 并行。

---

# v3 — 双向对接（chayuan MCP server + 模型共享 + 反向调用）

**Goal:** 让外部 agent 能消费 chayuan 的 KB（带引用）+ 多模态；让 chayuan 与 agent 共用本地模型；
让 chayuan 反向调用 agent 的工具。

**Architecture:** chayuan 新增 **MCP server**（现状仅 MCP client）。主推 Streamable HTTP/SSE，挂
`/api/v1/mcp_server`，复用 `require_auth_enabled` + `authz.assert_readable` + `audit`。模型共享靠把
agent 的 custom provider `baseUrl` 指向 `:62581/v1`。

## 文件结构（预判，落地时核对）
- Create `SRV/chayuan/server/mcp_server/`（server 实现：transport / tool registry / handlers）
- Create `SRV/chayuan/server/mcp_server/tools/kb_search.py`、`tts.py`、`image.py`、`video.py`（desktop 门控）
- Modify `api_server/server_app.py`（挂载 mcp_server）
- Modify `agent_connector/openclaw.py` / `hermes.py`（写 agent 配置：注入 chayuan MCP url + 模型 baseUrl + token）

## 里程碑
- **M1 选型 + server 骨架**：确定 MCP server 实现方式（评估 `mcp` Python SDK 的 server 端 vs 在 FastAPI 上
  手搓 Streamable HTTP）。产出空 server + `tools/list` 动态按 HostPolicy/构建返回。
  - 验收：MCP client（用 `mcp` SDK 或 fake）能连上、`tools/list` 返回当前可用工具。
- **M2 `chayuan_kb_search` 工具（皇冠）**：映射 `POST /api/v1/kb-query/search`；连接 Bearer → user →
  `assert_readable(ku_id)` 默认 deny；**KB 类工具默认不授权 agent，用户按技能/按 KB 显式勾选才放行**
  （自审 #4）；引用 `Citation` 结构化塞进 tool result；调用配额 + 异常批量检索告警；`audit()`。
  - 验收：授权用户经 MCP 检索带引用；未授权 KB 被 deny；超频被限流；审计有记录。
- **M3 多模态工具**：同步 `chayuan_tts` / `chayuan_generate_image` / `chayuan_video_understand`；
  异步三段 `chayuan_digital_human_generate` / `chayuan_video_generate`（提交→`_task_status`→`_task_result`，
  不阻塞，**仅 desktop 门控**）。
  - 验收：同步工具直接返；异步工具返 task_id 且可轮询取件；服务器版不暴露 DH/VG。
- **M4 模型共享 + per-user 凭证**：在 agent 配置写入 `baseUrl=127.0.0.1:62581/v1` + scoped token；
  trusted-local 用固定本地 token，shared-multitenant 预留 per-user 铸造（真正实现挪 v4）。
  - 验收：agent 用 chayuan 本地模型应答，无需独立模型。
- **M5 反向调用**：chayuan 侧把 agent 的 gateway（18789/8642 OpenAI 兼容 / `/tools/invoke`）封成可调工具。
  - 验收：chayuan 会话里能委托一个 agent 技能并拿回结果。
- **M6 环路保护**（自审 #13）：调用链深度上限 + 环检测；约定 agent 用 chayuan 模型时同链不反向回调 chayuan 工具。
  - 验收：构造 chayuan→agent→chayuan 调用，深度超限被拦。

## 测试策略
- MCP server 用 `mcp` SDK 的 client（或 fake client）做契约测试，不依赖真 agent。
- KB 授权/配额/审计各加用例；引用透传断言 tool result 含 citations。
- 模型共享/反向调用用 mock gateway。

## 开放问题（M1 前必答）
- chayuan 用哪种 MCP server 实现（SDK vs 手搓）？OpenClaw/Hermes 连 HTTP MCP 的实测连通性（设计 §10 已标需核实）。
- `kb-query/search` 的 user 注入在 MCP 上下文里如何还原（Bearer→middleware→`request.state.user` 链路在 MCP transport 下是否成立）。

---

# v4 — 服务器多租户（shared-multitenant 实现）

**Goal:** 一台服务器多用户，每用户一个隔离的 agent 实例，强制沙箱、配额、回收，Fleet 可视化。
**并入主线，v3 后紧接做。**

**Architecture:** 实现 v1 `AgentInstanceManager` 的 `multi_instance` 缝（v1 占位 `NotImplementedError`）：
`PerUserSpawner` 按 chayuan 用户 spawn profile 实例（OpenClaw `--profile <user> --port <分配>` /
Hermes `-p <user>` + `.env` 端口/key），自维护 username→port 路由表，idle-culler 回收。沙箱用
**sysbox 子容器**（设计 §6.2 已拍板）。

## 文件结构（预判）
- Create `SRV/chayuan/server/agent_connector/spawner.py` — `PerUserSpawner`（端口池 + 路由表 + 进程组）
- Create `SRV/chayuan/server/agent_connector/culler.py` — idle 回收
- Create `SRV/chayuan/server/agent_connector/credentials.py` — per-user scoped token 铸造/轮换/吊销
- Create `SRV/chayuan/server/agent_connector/sandbox.py` — sysbox 子容器封装
- Modify `agent_connector/manager.py` — `multi_instance` 分支接 `PerUserSpawner`
- Create `CLI/packages/app/src/features/agent/FleetView.tsx` — N 实例舰队视图（admin）

## 里程碑
- **M1 PerUserSpawner**：端口池分配（不端口扫描，spawner 自记）+ 路由表（username→port）+ profile 起停 +
  进程组 kill；实例死了移路由（抄 JupyterHub `poll()`）。
  - 验收：两个用户各得独立实例/端口；杀一个不影响另一个；死实例路由被清。
- **M2 idle-culler + 配额**：空闲超时关停 + 懒启动 + per-user CPU/内存/磁盘配额（两家原生无 quota，自建）。
  - 验收：闲置实例被回收；超配额被限制。
- **M3 强制沙箱（sysbox）**：OpenClaw `sandbox.mode=all`+Docker / Hermes `terminal.backend=docker|singularity`，
  均跑在 sysbox 子容器；出网走 egress allowlist + SSRF 代理；裸机/VM 用普通 Docker。
  - 验收：恶意技能困在沙箱、无法触达宿主/他人实例/无授权出网。
- **M4 per-user 凭证**：spawn 时铸绑定用户的 scoped token 注入 agent，过期轮换、注销即吊销（接 v3 M4 缝）。
  - 验收：A 用户的 agent 回调 chayuan 只能访问 A 有权的 KB；吊销后立即失效。
- **M5 Fleet UI**：admin 看 N 实例（状态/资源/uptime）+ 起停/回收；HostPolicy=shared-multitenant 才显示。
  - 验收：admin 能看全部实例并操作；普通用户只见自己。
- **M6（可选）LiteLLM 式网关**：per-user 虚拟 key + 按 model_name 聚合 + 后台健康剔除挂掉实例。

## 测试策略
- `PerUserSpawner` 对 fake CLI（v1/v2 的 fake）跑，断言端口分配/路由/回收逻辑，不真起容器。
- 沙箱用集成 smoke（需 sysbox 宿主）；凭证隔离加单测。
- 「不安全默认不漏进服务器」回归：构造 `AUTH_REQUIRED=true`，断言策略=shared-multitenant 且沙箱强制开（自审 #7 红线）。

## 开放问题
- 部署宿主是否裸机/VM（普通 Docker）还是容器内（必须 sysbox）——影响 M3。
- sysbox 在目标环境可装性 PoC。

---

# 离线轨（内网，与 v1/v2 并行）

**Goal:** 内网无外网也能装 OpenClaw/Hermes（设计 §10 已拍板纳入范围）。

**Architecture:** 预置离线安装包——OpenClaw 走内网 npm offline mirror / 打包好的 `node_modules`；
Hermes 走捆绑 runtime（Python/Node）+ 离线 wheel。挂在功能①安装的 adapter `install()` 路径上，
按「在线/离线」两条分支。

## 里程碑
- **M1 可行性 PoC（先做）**：在真无外网环境验证两家能否离线装成。
  - OpenClaw：`npm i -g openclaw` 的传递依赖能否用 `npm pack` / verdaccio 私服 / 预打 `node_modules` 离线还原。
  - Hermes：自带 Python/Node runtime + 离线 wheel 能否预置。
  - **验收**：至少一家能离线装成；不通的那家明确「降级为需联网装一次」。
- **M2 离线包构建**：把验证通过的离线包纳入构建产物（呼应 desktop 三档打包 / vendored 资产模式）。
  - 验收：离线包随安装介质分发，校验脚本能验完整性。
- **M3 安装流分支**：adapter `install()` 探测网络，离线则走预置包，并在 UI 明示「离线安装」。
  - 验收：内网机从离线包装成 OpenClaw/Hermes，走通 v1 装→配→监控→起停。

## 测试策略
- 离线包还原脚本单测（校验 + 解包）。
- 真内网 smoke（断网机）跑装机闭环。

## 开放问题
- OpenClaw 的 npm 传递依赖在内网镜像的完整性（最大不确定性，M1 先攻）。
- 离线包体积对 desktop 打包体积的影响（呼应已有打包体积红线）。

---

# 全局里程碑顺序与依赖

```
v1(单机+OpenClaw 托管闭环) ──► v2(Hermes + 技能 + 翻译) ──► v3(对接 MCP server) ──► v4(服务器多租户)
       │                                                                              
       └────────────► 离线轨(并行,挂在功能①安装上) ──────────────────────────────────►
```

- v1/v2：逐行 TDD（已就绪）。
- v3/v4/离线：本里程碑计划；**各自轮到时按 writing-plans 展开为逐行 TDD**，并在展开前先答其「开放问题」。
- 每档独立可发、独立可测。
