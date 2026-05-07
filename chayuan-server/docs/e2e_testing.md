# 浏览器 E2E 测试指引

`scripts/e2e_test.py` 基于 **Playwright + Chromium**，以真实用户视角对
**所有浏览器可访问的界面** 做端到端验证。与 `smoke_test.py`（纯 HTTP 黑盒）互补。

## 覆盖范围

| # | 组 | 目标 | 关键断言 |
| - | - | - | - |
| 1 | swagger  | FastAPI `/docs` + `/openapi.json` | 业务路由全注册；Swagger UI 渲染 |
| 2 | langfuse | Langfuse Web UI `:3000` | `/api/auth/providers` 200；登录页有 email 输入 |
| 3 | minio    | MinIO Console `:9001` | 标题含 "MinIO"；登录输入框渲染 |
| 4 | webui    | 察元 Streamlit WebUI `:8501` | 首页可达；登录表单或 sidebar 出现；真实登录后 sidebar 显现 |
| 5 | journey  | 完整用户旅程（API 层） | 注册 → 登录 → 建 KB → 搜索 → 删除 |

**关键设计**：
- 用 Playwright `request` 而非 `httpx`，**复用浏览器 cookie jar + 绕系统代理**（Chromium `--no-proxy-server`），避免 Windows 代理把 `127.0.0.1` 也劫走
- 同时校验 HTTP status **和** 业务 `code` 字段（察元习惯 200 外层 + `code=500` 业务错）
- WebUI 组会优先等 sidebar；没出来再兜底等登录表单
- 失败自动写 `e2e_artifacts/<ts>_<case>.png` 全页截图

## 首次准备

```powershell
pip install playwright
python -m playwright install chromium
```

## 用法

```powershell
# 默认：跑全部 5 组
python scripts/e2e_test.py

# 显示浏览器窗口（debug 用）
python scripts/e2e_test.py --headed

# WebUI 没起时跳过第 4 组
python scripts/e2e_test.py --skip-webui

# 仅跑某几组
python scripts/e2e_test.py --only swagger,journey

# 出 JUnit XML（CI 消费）
python scripts/e2e_test.py --junit e2e_junit.xml
```

已集成到 `scripts/run_full_test.ps1`：

```powershell
pwsh -File scripts/run_full_test.ps1             # 包含 E2E
pwsh -File scripts/run_full_test.ps1 -SkipE2E    # 跳过
```

## 扩展

加新 case：在 `E2ERunner` 里新增一个 `run_xxx(ctx)` 方法，然后在 `run()`
里接入即可，模式与现有组一致。每条 case 用 `self._case(group, name, fn, ctx)`
执行，失败会自动截图 + 计入 JUnit。
