# Milvus 2.4 → 2.6 升级计划与执行清单

> 服务端：`milvusdb/milvus:v2.4.9` → **`v2.6.15`**（2.6.x 当前最新稳定）
> 客户端：`pymilvus 2.4.15` → **`>=2.6,<2.7`**（2.6.12 是 2026-04 PyPI 最新）+ 新增 **`langchain-milvus>=0.3,<0.4`**
>
> 状态：代码改造已完成 ✅；锁文件刷新与镜像拉取留给运行时执行

---

## 1. 决策摘要

| 决策 | 取舍 |
|---|---|
| 跨版本直跳 vs 经 v2.5.16 中转 | **dev-stack 清卷直跳**；**prod 必须中转**（已在 compose 注释里高亮） |
| 客户端先升 vs 后升 | **同步升**——pymilvus 2.4 + Milvus 2.6 server 在 `DescribeIndex` / `LoadCollection` 等 RPC 上协议号不匹配（issue #1582 / #24444），强行混用会运行时炸 |
| `langchain_community.vectorstores.Milvus` vs `langchain-milvus` | 改用独立包；前者 LangChain 1.x 已弃用，且不支持 MilvusClient 风格的 URI 协议 |
| Index/metric 默认 | 由 `{index_type:HNSW, metric_type:L2}` 改为 `{AUTOINDEX, COSINE}`，规避漏 `params:{M,efConstruction}` 的历史踩坑 |
| 配置写法 | `host/port` 改 `uri`，与 Milvus 2.6 / langchain-milvus 0.3 内部 `MilvusClient(uri=...)` 风格对齐 |

## 2. 已经改完的文件清单

### 镜像层（docker-compose）
- `docker/dev-stack/docker-compose.yml`
  - `milvusdb/milvus:v2.4.9` → **`v2.6.15`**
  - 服务上方加详细升级注释（含清卷命令）
- `docker/prod/docker-compose.yaml` —— 同上 + prod 中转告警
- `docker/prod/docker-compose.prod.yaml` —— 同上

### Python 依赖层
- `libs/chayuan-server/pyproject.toml`
  - `pymilvus = ">=2.4,<3.0"` → **`>=2.6,<2.7`**
  - 新增 **`langchain-milvus = ">=0.3,<0.4"`**
- `libs/chayuan-server/chayuan/server/config_panel/health.py`
  - 健康检查清单的 `pymilvus>=2.3` → **`pymilvus>=2.6,<2.7`**
  - 新增 langchain-milvus 检查项

### 配置层（默认 / prod 模板 / Tray 写入路径）
- `libs/chayuan-server/chayuan/init_prod_profile.py`
  - `_kb_overrides()` 改为优先用 `CHAYUAN_MILVUS_URI`，老 `HOST/PORT/SECURE` 自动拼成 uri
- `libs/chayuan-server/chayuan/server/config_panel/local_service_catalog.py`
  - 探测填充改写 `kbs_config.milvus.uri`
- `libs/chayuan-server/chayuan/tray/services/manager.py`
  - Milvus-Lite 切换写 `kbs_config.milvus.uri`，清理旧 host/port 字段
- `docker/prod/chayuan/kb_settings.yaml`
  - `host/port` → `uri: http://milvus:19530`
  - `index_params.metric_type: L2 + index_type: HNSW` 漏参 → `metric_type: COSINE + index_type: AUTOINDEX + params: {}`

### 代码层（已经写好不需改）
- `libs/chayuan-server/chayuan/server/knowledge_base/kb_service/milvus_kb_service.py`
  - 已含：URI 归一 `_normalize_connection_args`、index_params 必填补齐 `_normalize_index_params`、search_params 与 index 一致校验 `_normalize_search_params`、issue #1643 alias self-heal、ConnectionNotExist 重试链
  - **零代码改动**，只受益于依赖升级

## 3. 用户本地待执行（按顺序）

```bash
# A. 刷新 Python 依赖锁文件
cd /work/chayuan-server/libs/chayuan-server
poetry lock                  # 让 pyproject 新约束生效；会更新 pymilvus + 新增 langchain-milvus
poetry install               # 装上 pymilvus 2.6.x + langchain-milvus 0.3.x

# B. 清旧 milvus 数据卷（dev 环境）
cd /work/chayuan-server/docker/dev-stack
docker compose stop milvus milvus-etcd
docker volume rm chayuan-dev_chayuan_milvus_etcd chayuan-dev_chayuan_milvus_data

# C. 拉新镜像并重建
docker compose pull milvus
docker compose up -d milvus-etcd milvus

# D. 等待就绪
docker logs -f chayuan-dev-milvus    # 看到 'Milvus Proxy successfully started'
curl -fsSL http://127.0.0.1:9091/healthz   # → "OK"

# E. 业务侧冒烟
cd /work/chayuan-server
python scripts/smoke_test.py
pytest libs/chayuan-server/tests/kb_vector_db/test_milvus_db.py -x

# F. （可选）业务回归：重建任意一个 KB，confirm 文档能上传 + 查询能召回
```

## 4. 回滚方案

如 `pymilvus 2.6` + 新依赖与项目其它 langchain 子包出现冲突：

```bash
# 回滚 image
sed -i 's|milvusdb/milvus:v2.6.15|milvusdb/milvus:v2.4.9|' docker/dev-stack/docker-compose.yml

# 回滚 pyproject.toml（手动改回）
#   pymilvus = ">=2.4,<3.0"
#   删除 langchain-milvus 一行

# 重做 lock + install
cd libs/chayuan-server && poetry lock && poetry install

# 清卷重启 Milvus 2.4
cd ../../docker/dev-stack
docker compose stop milvus milvus-etcd
docker volume rm chayuan-dev_chayuan_milvus_etcd chayuan-dev_chayuan_milvus_data
docker compose up -d
```

> 注意：dev 卷已清，回滚后 KB 也是空的。**用户产生过的 KB 数据**回滚后需重新 embed。

## 5. 生产升级流程（与 dev 不同！）

dev-stack 直接清卷，但**生产环境不允许**：

```bash
# Step 1：备份现有 2.4 数据
docker exec chayuan-prod-milvus milvus-backup create --collection-names ...

# Step 2：升到 2.5.16（中转）
sed -i 's|milvusdb/milvus:v2.4.9|milvusdb/milvus:v2.5.16|' docker/prod/docker-compose.yaml
docker compose pull milvus
docker compose up -d milvus
# 等 30 分钟：data compaction + segment 升级
docker logs -f chayuan-prod-milvus | grep -i "completed\|ready"

# Step 3：再次备份
docker exec chayuan-prod-milvus milvus-backup create ...

# Step 4：升 2.6.15
sed -i 's|milvusdb/milvus:v2.5.16|milvusdb/milvus:v2.6.15|' docker/prod/docker-compose.yaml
docker compose pull milvus
docker compose up -d milvus

# Step 5：业务回归 ≥ 24 小时观察
```

## 6. 风险登记

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| pyproject 改动后 langchain 1.x 子包间约束求解失败 | `langchain-milvus 0.3` 与 `langchain-core >=1.3` 兼容窗口未覆盖 | poetry lock 失败后切回 `langchain-milvus = ">=0.2,<0.4"` |
| Milvus-Lite（嵌入模式）升 2.6 后 Windows 不再支持 | `milvus-lite` 在 2.6 后 Windows wheel 仍未发布 | 当前 manager.py 已限定 file 模式只在非 Windows 启用；Windows 用 docker 即可 |
| 老 KB 数据 schema 与 2.6 不兼容 | dev 直接清卷（已避免），prod 走备份还原 | prod 流程严格 backup → 2.5 → backup → 2.6 |
| `index_type: HNSW` 老配置漏 `params` | 老 yaml 里仍是历史踩坑写法 | `_normalize_index_params` 自动补默认；prod 模板已主动改成 AUTOINDEX |

## 7. 验收

- [ ] `poetry lock && poetry install` 成功
- [ ] `docker compose --profile full pull` 成功
- [ ] `docker compose up -d` 全部 healthy
- [ ] `pytest tests/kb_vector_db/test_milvus_db.py -x` 通过
- [ ] 任意创建一个 KB，上传一份 .pdf，发起 chat 能召回引用
- [ ] `chayuan health` 健康面板里 pymilvus / langchain-milvus 行均绿
