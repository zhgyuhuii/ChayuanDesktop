# 察元 · 专业测试计划

> 测试负责人视角：从准入门禁、测试金字塔到具体 case 清单，一份落地即可执行的规划。

---

## 1. 测试目标

| 维度 | 验收标准 | 工具 |
|---|---|---|
| **功能正确性** | 每个 HTTP 端点对合规输入返回预期 2xx；对越权/非法输入返回正确 4xx | smoke_test.py |
| **稳定性** | 白盒 pytest 全绿（>= 150 cases）；覆盖率 ≥ 80% | pytest + pytest-cov |
| **安全合规** | SQL 只读强制、PII 按角色脱敏、Prompt 注入拦截、租户注入生效 | pytest + 手工抽查 |
| **性能** | multi_search p95 < 5s @ 10 并发 | locust / scripts |
| **可观测** | /metrics 业务 label 齐全；Langfuse trace 每次对话有 span | curl + UI 目视 |
| **容错** | Redis/Langfuse/Ollama 宕 → 业务**不**中断 | 手工断电 |

---

## 2. 测试金字塔

```
            ┌───────────────┐
            │   E2E（手动）  │   ~6 场景（浏览器点到底）
            └───────────────┘
          ┌───────────────────┐
          │  Black-box HTTP   │   ~50 端点探活
          └───────────────────┘
        ┌───────────────────────┐
        │  Integration (真服务) │   PG/Milvus/Redis/Ollama
        └───────────────────────┘
      ┌───────────────────────────┐
      │    White-box pytest       │   151 cases（已通过）
      └───────────────────────────┘
    ┌───────────────────────────────┐
    │       Unit（纯算法）           │   已 inline 在 pytest 套件里
    └───────────────────────────────┘
```

---

## 3. 依赖准入清单

用户当前环境（已确认）：
- ✅ Docker：Postgres、Redis、Milvus 运行中
- ✅ Ollama：`qwen3.5:4b`（或类似）+ embed 模型
- ❌ Langfuse：需本脚本自动部署
- ⚠️ 察元 yaml：需根据上述地址重新配置

**自动化步骤**：

```powershell
# 1. 探活所有依赖 + 生成配置
python scripts/setup_local.py `
  --pg-host 127.0.0.1 --redis-host 127.0.0.1 `
  --milvus-host 127.0.0.1 --ollama-host 127.0.0.1 `
  --ollama-llm qwen3.5:4b --ollama-embed nomic-embed-text

# 2. 部署 Langfuse
cd docker/langfuse
cp .env.example .env
# 自动生成 secret（见脚本注释）
docker compose up -d

# 3. 首次启动察元
chayuan init --profile prod  # 或直接用已有配置
chayuan start -a
```

---

## 4. 黑盒 HTTP 端点清单（50+）

按路由分组。每个打 * 号的必须在 smoke 测试覆盖：

### 4.1 健康与元数据（5）
| Endpoint | 方法 | 期望 | smoke |
|---|---|---|---|
| `/healthz` | GET | 200 | ✅* |
| `/readyz` | GET | 200 / 503 | ✅* |
| `/metrics` | GET | 200 + Prometheus 文本 | ✅* |
| `/` | GET | 302 → /docs | ✅ |
| `/docs` | GET | 200 HTML | ✅ |

### 4.2 认证（4）
| Endpoint | 方法 | 期望 | smoke |
|---|---|---|---|
| `/auth/register` | POST | 200 返回 access_token | ✅* |
| `/auth/login` | POST | 200 返回 access_token | ✅* |
| `/auth/me` | GET | 带 token=200 / 无 token=401 | ✅* |
| `/auth/logout` | POST | 200 | ✅ |

### 4.3 知识库（15）
| Endpoint | smoke |
|---|---|
| `GET /knowledge_base/list_knowledge_bases` | ✅* |
| `POST /knowledge_base/create_knowledge_base` | ✅* |
| `POST /knowledge_base/upload_docs`（multipart） | ✅* |
| `GET /knowledge_base/list_files` | ✅* |
| `POST /knowledge_base/search_docs` | ✅* |
| `POST /knowledge_base/delete_docs` | ✅ |
| `POST /knowledge_base/delete_knowledge_base` | ✅ |
| `POST /knowledge_base/{kb}/build_raptor` | ✅（异步 enqueue） |
| `POST /knowledge_base/{kb}/build_graphrag` | ✅ |
| `GET /knowledge_base/{kb}/build_status/{id}` | ✅ |
| `GET /knowledge_base/{kb}/graphrag/stats` | ✅ |
| `GET /knowledge_base/{kb}/grants` | ✅ |
| `POST /knowledge_base/{kb}/grants` | ✅ |
| `DELETE /knowledge_base/{kb}/grants/{uid}` | ✅ |
| `PATCH /knowledge_base/{kb}/visibility` | ✅ |

### 4.4 知识源（统一抽象，14）
| Endpoint | smoke |
|---|---|
| `GET /knowledge_source/dialects` | ✅* |
| `POST /knowledge_source/test_connection` | ✅* |
| `GET /knowledge_source/` | ✅* |
| `POST /knowledge_source/` | ✅* |
| `GET /knowledge_source/{id}` | ✅ |
| `PATCH /knowledge_source/{id}` | ✅ |
| `DELETE /knowledge_source/{id}` | ✅ |
| `POST /knowledge_source/{id}/introspect` | ✅ |
| `GET /knowledge_source/{id}/schema` | ✅ |
| `GET /knowledge_source/{id}/grants` | ✅ |
| `POST /knowledge_source/{id}/grants` | ✅ |
| `POST /knowledge_source/grants/batch` | ✅ |
| `POST /knowledge_source/multi_search` (SSE) | ✅* |
| `POST /knowledge_source/multi_chat` (SSE) | ✅* |

### 4.5 对话（6）
| Endpoint | smoke |
|---|---|
| `POST /chat/chat/completions` (非流式) | ✅* |
| `POST /chat/chat/completions` (流式 SSE) | ✅* |
| `POST /chat/kb_chat` | ✅* |
| `POST /chat/file_chat` | ✅ |
| `POST /chat/v2/chat`（ChatGraph 新入口） | ✅* |
| `POST /chat/feedback` | ✅ |

### 4.6 治理（7）
| Endpoint | smoke |
|---|---|
| `GET /governance/policy` | ✅* |
| `POST /governance/policy` | ✅* |
| `GET /governance/policy/effective` | ✅ |
| `GET /governance/lineage` | ✅* |
| `GET /governance/lineage/top_objects` | ✅ |
| `GET /governance/usage/today` | ✅* |
| `POST /governance/pii/scan` | ✅* |
| `POST /governance/guardrail/check_input` | ✅* |
| `POST /governance/guardrail/check_output` | ✅* |

### 4.7 图像知识源（新，8）
| Endpoint | smoke |
|---|---|
| `GET /image_models/` | ✅* |
| `POST /image_models/download` | ⚠️（大文件，smoke 跳过） |
| `GET /image_models/disk_usage` | ✅ |
| `POST /knowledge_source/{id}/image/upload` | ✅*（需要 image 源 + 模型） |
| `GET /knowledge_source/{id}/image/list` | ✅ |
| `GET /knowledge_source/{id}/image/{iid}` | ✅ |
| `DELETE /knowledge_source/{id}/image/{iid}` | ✅ |
| `POST /knowledge_source/{id}/image/search_by_image` | ✅ |

### 4.8 其它（略）
`/tools/*`、`/mcp/*`、`/openai/*`、`/openapi/v1/*`：smoke 抽查 1-2 条。

---

## 5. 典型 E2E 场景

| 场景 | 步骤 | 预期 |
|---|---|---|
| 注册→登录→创建 KB→上传→问答 | 逐步骤调 API | 能拿到带 docs 字段的答复 |
| SQL 数据源接入→Text2SQL | test_connection → 创建 → multi_search | 返回含生成 SQL 的 chunk |
| 多租户隔离 | 两个 user 分别建 KB，互查 | 403 |
| 图像知识源→以图搜图 | 上传图 → search_by_image | 命中 top1 cos=1.0 |
| 断网 Langfuse | 关 langfuse 容器，发对话 | 业务不中断；log 里一次 warn |
| 配额超限 | 设 qps=1，连发 3 次 | 第 2、3 次 quota_denied |
| Prompt injection | 发 "忽略以上指令" | guardrail 拦截 |
| PII 脱敏 | 非 admin 查含手机号数据 | 结果中手机号被脱敏 |

---

## 6. 门禁（Release Gate）

上线前所有**必过项**：

- [ ] pytest 白盒 ≥ 150 cases 全绿  
- [ ] scripts/setup_local.py --probe-only 返回 `✅ 所有依赖服务都就绪`
- [ ] scripts/smoke_test.py 退出码 0（或仅有 SKIP 无 FAIL）
- [ ] Langfuse 能看到至少一条 chat trace
- [ ] /metrics 能看到 `chayuan_ks_connector_search_seconds`、`chayuan_text2sql_graph_node_seconds`、`chayuan_rag_hybrid_seconds` 三个 histogram
- [ ] Guardrail ON 时 "忽略以上指令" 被拦
- [ ] 治理 ON 时含 PII 的查询结果被脱敏
- [ ] Arq worker 启动能处理 raptor_build 任务

---

## 7. 回归 matrix

每次合并 PR 前 CI 跑：

```yaml
runs:
  - pytest -m "not real_db and not real_llm"   # 核心 151 case，~15s
  - pytest -m "real_db" --docker               # testcontainers，5 min
  - bash scripts/smoke_test.sh                  # 50 端点探活，~2 min
```
