# ChaCMD M3+M4 验收记录（2026-07-05）

分支 `worktree-chacmd-p0-backend`。测试：**97 passed**（py3.11），ruff `All checks passed`。

## 交付提交（M3→M4）

| commit | 内容 |
|---|---|
| `6a921aa` | 修察元契约 whoami→`/openapi/v1/whoami`；authz 归 ChaCMD 本地域 |
| `e0a0d91` | NatsEventBus (JetStream) + 组合根 memory/nats 切换 |
| `28eee62` | Database 方言无关回归（postgres URL） |
| `242fd45` | Anthropic `/v1/messages` shim → 察元 OpenAI 网关（#16 缺口） |
| `ea7f594` | 审批门 API approve/reject（NFR-H1）+ 状态机校验 |
| `1f63f64` | per-job token 预算 kill（NFR-C1）+ Job token 计量列 |
| `89e1918` | DockerSandbox rootless + 加固基线（NFR-SEC1/2） |
| `512cd9a` | OpenHandsAdapter（JSONL→统一事件 + 流式子进程） |
| `72c0464` | OTel traceparent 注入（NFR-O1）+ Provisioner 供给/配置下发（#2/#10） |

## 察元契约冒烟（源码级已核验；运行时冒烟待环境）

察元实例当前未运行（127.0.0.1:8000/5173 均 connection refused），无法做运行时 curl 冒烟。
改以**源码级契约核验**锁定（已单测固化，见 `tests/test_chayuan_client.py`）：

| ChaCMD 调用 | 察元真实路由 | 源码位置 | 结论 |
|---|---|---|---|
| `whoami` → `GET /openapi/v1/whoami` | `openapi_router(prefix=/openapi/v1)` + `/whoami` | `openapi_routes.py:36,242` + `server_app.py:233 include_router(openapi_router)` 无额外前缀 | ✅ 对齐 |
| shim → `POST /v1/chat/completions` | `openai_router(prefix=/v1)` + `/chat/completions` | `openai_routes.py:32,454` + `server_app.py:201 include_router(openai_router)` 无额外前缀 | ✅ 对齐 |
| `authorize(container:x, dispatch)` | 察元**无**资源级 authz-check 端点（鉴权是 scope-based `require_scopes`） | — | ✅ 归 ChaCMD 本地域，防腐层不伪造端点 |

> 待察元 docker-compose 起来后，`curl /openapi/v1/whoami`（期望非 404）+ `curl -X POST /v1/chat/completions`（期望 200）即可补运行时冒烟。

## P0 五条验收

| # | 验收项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 端到端：建任务→（沙箱开发→跑）→审批→汇总 | ✅ Fake 全链路；真 OpenHands 待运行时 | `tests/test_e2e_m4.py`（供给→派活→成功→卷 done-marker）、`test_e2e_dispatch.py`；OpenHandsAdapter 已就位（`512cd9a`），真跑需 OpenHands runtime |
| 2 | 沙箱不可逃逸（docker socket 不入容器） | ✅ | `SandboxSpec.__post_init__` 构造期拦 socket（`test_docker_sandbox.py::test_socket_mount_rejected_at_spec`）+ 加固基线 cap-drop ALL/no-new-priv/read-only/no-net（`test_hardening_baseline_applied`）；真起容器验 socket 不可见待运行时 |
| 3 | 超 per-job 预算自动 kill | ✅ | `test_budget.py`（3 用例）+ `test_dispatcher.py::test_dispatch_kills_job_over_token_budget`（累计超预算→adapter cancel + FAILED） |
| 4 | 审批门可批准/打回 | ✅ | `test_api.py` approve→running / reject→cancelled / queued→approve 返 409；`test_state.py::test_cancelled_is_terminal` |
| 5 | 大屏实时事件流 | ✅ 后端；前端另仓 | NatsEventBus JetStream（`test_nats_bus.py`）+ 事件带 traceparent（`test_e2e_m4.py::test_bus_events_carry_traceparent`）；指挥大屏 UI 属 chayuan-client 仓（设计稿待评审） |

## 明确留待后续（非本轮范围）

- **运行时冒烟**：真察元实例、真 OpenHands 子进程、真 Docker daemon 起容器、真 NATS/Postgres+RLS 集群 —— 需外部运行时，已用纯函数/契约单测锁定行为。
- **P1**：Postgres RLS policy、NATS Accounts、Vault、mTLS、per-role 出站白名单、单机容灾重建、员工视图、技能体系、Task-as-API 完整、Charter 触发交接、复杂 DAG。
- **前端**：指挥大屏 v1（chayuan-client 仓，3D 星群 + 2D 下钻设计稿待评审）。
