# 察元测试体系总览

## 一键执行

```powershell
# Windows PowerShell
pwsh -File scripts/run_full_test.ps1 -Python D:\soft\conda_envs\py312\python.exe
```

- 自动起 postgres + redis + minio + milvus + langfuse + ollama
- 自动写 yaml
- 跑白盒 162 个 pytest
- 启动察元 API（若未起，脚本会提示）
- 跑黑盒 50+ smoke

## 测试层次

```
┌─ E2E（手动）──────────┐  浏览器点到底
├─ Black-box (smoke) ────┤  scripts/smoke_test.py
├─ Integration ──────────┤  docker compose 真服务 + pytest
├─ White-box (pytest)────┤  151 knowledge_source + 11 storage = 162 核心 case
└─ Unit ──────────────────┘  pytest 内联
```

## 准入门禁

| 检查项 | 命令 | 期望 |
|---|---|---|
| 白盒 pytest | `pytest tests/knowledge_source` | 162 passed |
| 探活 | `python scripts/setup_local.py --probe-only` | 所有 ✅ |
| 黑盒 smoke | `python scripts/smoke_test.py` | 退出码 0 |
| Langfuse trace | 打开 http://localhost:3000 | 看到对话 trace |
| MinIO 对象 | http://localhost:9001 → chayuan-kb-content | 能看到上传文件 |
| /metrics | `curl http://localhost:62581/metrics | grep chayuan_` | 业务 metric 齐全 |

## 端点清单（smoke 覆盖）

详见 [test_plan.md](./test_plan.md) 第 4 节；8 大组 50+ 端点：

1. **健康** — /healthz /readyz /metrics /docs
2. **鉴权** — /auth/me
3. **知识库** — list / create / upload_docs / search / delete
4. **知识源** — dialects / test_connection / multi_search_sync
5. **治理** — policy / pii/scan / guardrail / usage / lineage
6. **存储** — status / list / test_connection
7. **图像** — image_models / disk_usage
8. **对话** — /chat/v2/chat
9. **工具** — /tools

## 故障排查

| 现象 | 原因 | 修复 |
|---|---|---|
| smoke 里大量 503 | 察元 API 未起 | `chayuan start -a` |
| /chat 返回 500 | Ollama 未拉模型 | `docker compose run ollama-setup` |
| KB 创建失败 | embed 模型不可达 | 检查 model_settings.yaml api_base_url |
| storage status 显示 local 但 MINIO_ENDPOINT 有配 | 用 admin 账号切到 minio 后端 | `POST /storage/switch_backend` |
| Langfuse 看不到 trace | LANGFUSE_* 环境变量未配 / CHAYUAN_LANGFUSE_DISABLE=1 | 修 basic_settings.yaml |

## 报告位置

- `smoke_report.json` — 详细结果（每个 case 的 http / elapsed / message）
- `smoke_junit.xml` — CI 可消费 JUnit 格式
- pytest 覆盖率：`pytest --cov=chayuan.server --cov-report=html`
