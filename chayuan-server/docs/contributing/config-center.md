# 配置中心（DB + Redis + yaml 三级）

> Nacos-lite 架构：**业务 DB 是真实源，Redis 做二级缓存与跨副本一致性总线，yaml 降级为种子与应急兜底**。

---

## 1. 为什么要做

察元历史上把配置散落在 8 个 yaml（`basic / model / kb / tool / prompt` + 后来加的 `apps / custom_tools / websocket_endpoints`）里。痛点：

1. **改了要重启**：yaml 是进程启动时 load 的 Pydantic Settings，修改后业务进程看不到；
2. **多副本不一致**：K8s 多 pod 部署时，谁改哪一份？
3. **无版本 / 无审计**：出事不知道「谁在什么时间改了什么」；
4. **yaml 落盘 + Git 审计**：敏感 secret 容易被带进 commit / 备份。

---

## 2. 架构一览

```
┌─────────────────────────────────────────────────┐
│                业务代码 / 面板                  │
│  apps_store / custom_tools_store / ws_store …   │
└──────────────┬──────────────────────────────────┘
               │ _load() / _dump()
               ▼
┌─────────────────────────────────────────────────┐
│        config_center.get_store()                │
│  ──► get(ns, key)   1) Redis  2) DB  3) yaml    │
│  ──► set(ns, key)   DB + Redis + Pub/Sub        │
└──────────────┬──────────────────────────────────┘
               │ 变更事件
               ▼
┌─────────────────────────────────────────────────┐
│   Redis channel  chayuan:config:events          │
│   (单进程时 dispatch_local 同步派发；多副本时     │
│    由后台 asyncio task 监听跨副本广播)           │
└──────────────┬──────────────────────────────────┘
               │ 本地 dispatch
               ▼
┌─────────────────────────────────────────────────┐
│  register_callback(ns, cb) 的每个订阅者          │
│  典型：tools_factory.load_and_register()        │
└─────────────────────────────────────────────────┘
```

**核心数据模型**（SQLAlchemy）：

```sql
-- 当前值
chayuan_config (id, namespace, key, value JSON, version, updated_by, comment, updated_at)
  UNIQUE(namespace, key)

-- 完整历史（写 / 删都落一行）
chayuan_config_history (id, namespace, key, value, version, updated_by, comment, updated_at)
```

---

## 3. 读写路径

### 读（`ConfigStore.get`）

```
1. Redis  chayuan:config:<ns>:<key>     （命中即返回）
2. DB     chayuan_config 表             （回源成功则回填 Redis）
3. yaml   CHAYUAN_ROOT/<ns>.yaml        （仅 DB 不可达时降级，纯只读）
```

### 写（`ConfigStore.set`）

```
1. DB 事务：UPSERT chayuan_config + INSERT chayuan_config_history
2. Redis  SETEX 新值
3. 本地 dispatch_local(evt)   -> 调所有 register_callback 回调
4. Redis PUBLISH chayuan:config:events  -> 通知其它副本 reload
```

写入方本进程 **不依赖** Redis 触发回调；Redis 仅用于跨副本 fan-out。

---

## 4. 启动流程（已接入）

- `chayuan start -a` / `start --api`：
  1. `create_tables()` 建基础表
  2. `run_migrations()` 里会自动跑 `2026_04_21_config_center` 迁移，创建 `chayuan_config / chayuan_config_history`
  3. `seed_from_yaml()` 把 `apps.yaml / custom_tools.yaml / websocket_endpoints.yaml` 种子到 DB（**仅 namespace 为空时**——下次启动不会覆盖运维在面板里的变更）
  4. API server `@app.on_event("startup")` 注册 3 个 store 的热更新回调 + 启动 Redis 订阅 task

- `chayuan start -c`（仅面板）：跳过 DB 初始化；apps_store 直接走 yaml，config_center 不启用。

---

## 5. 热更新实操

运维改完配置（面板保存 / 或 `curl` 写 DB）：

| 场景 | 结果 |
| :-- | :-- |
| 单进程 | 当前进程立即拿到新值；tools_factory 的动态工具立即重注册，对话界面工具下拉下次 query 就生效 |
| K8s 多 pod | 写入的 pod 本地立即感知 + Redis 广播；其它 pod 的订阅 task 收到消息后触发本地 reload |
| Redis 挂了 | 写入的 pod 依然能工作（本地 dispatch_local 触发）；其它 pod 感知不到变更，直到 Redis 恢复 |

**不需要重启 chayuan 进程**。

---

## 6. Emergency Kill Switch

有时候 config center 本身出问题（DB 坏了 / 迁移失败 / 数据污染），你希望临时退回纯 yaml 模式：

```bash
export CHAYUAN_CONFIG_CENTER_DISABLED=1
chayuan start -a
```

这个开关让 `apps_store / custom_tools_store / ws_endpoints_store` 的 `_load / _dump` **直接读写 yaml，跳过 DB 与 Redis**。面板保存仍然生效，只是失去跨副本一致性。

同一个开关也是 CI 测试隔离的标准姿势——让独立单测不污染 DB。

---

## 7. 业务代码接入 Pattern

任何想走配置中心的 store 都是同一套骨架：

```python
# my_store.py
_NAMESPACE = "my_ns"
_ROOT_KEY = "items"   # 或者多个独立 key

def _load_raw() -> dict:
    try:
        from chayuan.server.config_center import get_store
        val = get_store().get(
            _NAMESPACE, _ROOT_KEY, default=None,
            yaml_fallback_path=_yaml_path(),
        )
        return {"items": val} if isinstance(val, list) else (val or {"items": []})
    except Exception:
        # DB 完全挂了才会到这里；回落纯 yaml
        return _read_yaml()

def _dump_raw(doc: dict) -> None:
    items = doc.get("items", []) or []
    try:
        from chayuan.server.config_center import get_store
        get_store().set(_NAMESPACE, _ROOT_KEY, items,
                        updated_by="my_store", comment="panel save")
    except Exception:
        pass
    _write_yaml(doc)   # 本地 yaml 镜像作为 DR snapshot
```

**注册热更新回调**（一般在 `server_app.py` 的 `@app.on_event("startup")` 里）：

```python
from chayuan.server.config_center import register_callback

def _reload_my_cache(evt):
    # evt = {"op": "set"|"delete", "namespace": "my_ns", "key": "items", "version": 3, "ts": ...}
    my_store.invalidate()   # 或者直接 my_store.reload()

register_callback("my_ns", _reload_my_cache)
```

---

## 8. 查看历史 / 审计

```python
from chayuan.server.config_center import get_store

# 最近 20 次变更
for h in get_store().history("apps", "apps", limit=20):
    print(h["version"], h["updated_at"], h["updated_by"], h["comment"])
    print("  →", h["value"])
```

面板后续可以加「变更历史」卡片，直接展示这些行，并支持一键回滚（把某个 version 的 value 再 `set()` 一次）。

---

## 9. 迁移状态 & 路线图

历史 5 个 yaml 与新加的 3 个 store 一共 8 份配置，迁移状态如下：

| 阶段 | 目标 yaml | 状态 | 接入方式 |
| :-- | :-- | :-- | :-- |
| 新 store | `apps.yaml / custom_tools.yaml / websocket_endpoints.yaml` | ✅ 已迁 | 写完全走 DB；yaml 做镜像备份 |
| **P1** | `tool_settings.yaml` / `prompt_settings.yaml` | ✅ 已迁 | Write-through：yaml 仍是 Pydantic 源，面板写时双写 DB；DB 变 → `yaml_sync` 覆写 yaml → `set_auto_reload` |
| **P2** | `kb_settings.yaml` | ✅ 已迁 | 同 P1；`vs_config.py` 走 `save_updates` 自动 mirror |
| **P3** | `model_settings.yaml` | ✅ 已迁 | 同 P1；`model_config.py` 旁路 `_atomic_write` 之后显式调 `mirror_namespace_to_db` |
| **P4** | `basic_settings.yaml` | ⛔ **不迁** | `SQLALCHEMY_DATABASE_URI` 本身驱动 config_center，自举循环；永远留 yaml+环境变量 |

### 旁路写 yaml 的接入方法

如果新模块不走 `yaml_store.save_updates`（比如有定制的 dump 逻辑），写完 yaml 后**显式**调一次：

```python
from chayuan.server.config_panel import yaml_store

yaml_store._atomic_write(path, lambda f: yaml.dump(doc, f))
yaml_store.mirror_namespace_to_db("model_settings.yaml", doc)   # ← 这行
```

该函数只对 `_YAML_TO_NAMESPACE` 里登记过的 yaml 生效，不会误同步。

### 基础配置为什么不进库（P4 说明）

`basic_settings.SQLALCHEMY_DATABASE_URI` 是配置中心自身的 DB 来源。如果它也放 DB 里，就形成「想读 DB URI → 先连 DB → 但 URI 还没拿到」的循环。同理 `REDIS_URL` 驱动跨副本 Pub/Sub，也建议留在 yaml/env。

其余 basic 字段（端口、日志路径、超时等）**可选**迁入 config center 的 P4.5 阶段，但价值不大：它们改一般都要重启 API 进程才能生效，热更新语义不适用。

---

## 10. 运维监控

可以简单地从 DB 查看配置中心活跃度：

```sql
SELECT namespace, COUNT(*) AS keys, MAX(updated_at) AS last_update
FROM chayuan_config
GROUP BY namespace;

-- 最近 24h 有谁改了什么
SELECT namespace, key, updated_by, comment, version, updated_at
FROM chayuan_config_history
WHERE updated_at >= NOW() - INTERVAL '1 day'
ORDER BY updated_at DESC;
```

生产环境建议把 `chayuan_config_history` 配个月度归档表 + 季度清理作业，避免无限增长。
