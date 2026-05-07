### chatchat 数据库对话配置说明

#### 一、使用建议

> 1. 因大模型生成的sql可能与预期有偏差，请务必在测试环境中进行充分测试、评估；
> 2. 生产环境中，对于查询操作，由于不确定查询效率，推荐数据库采用主从数据库架构，让text2sql连接从数据库，防止可能的慢查询影响主业务；
> 3. 对于写操作应保持谨慎，如不需要写操作，设置read_only为True,最好再从数据库层面收回数据库用户的写权限，防止用户通过自然语言对数据库进行修改操作；
> 4. text2sql与大模型在意图理解、sql转换等方面的能力有关，可切换不同大模型进行测试；
> 5. 数据库表名、字段名应与其实际作用保持一致、容易理解，且应对数据库表名、字段进行详细的备注说明，帮助大模型更好理解数据库结构；
> 6. 若现有数据库表名难于让大模型理解，可配置table_comments字段，补充说明某些表的作用。

#### 二、配置说明

##### 1. 配置节点
初始化后，在tool_settings.yaml文件中，找到text2sql配置节点：


```yaml
text2sql:
  model_name: qwen-plus
  use: false
  sqlalchemy_connect_str: mysql+pymysql://用户名:密码@主机地址/数据库名称
  read_only: false
  top_k: 50
  return_intermediate_steps: true
  table_names: []
  table_comments: {}
```

##### 2. 主要参数解释
1. **model_name**

  该工具需单独指定使用的大模型，与用户前端选择使用的模型无关

2. **sqlalchemy_connect_str**

  SQLAlchemy连接字符串，支持的数据库有：crate、duckdb、googlesql、mssql、mysql、mariadb、oracle、postgresql、sqlite、clickhouse、prestodb

  不同的数据库请查阅SQLAlchemy用法，修改sqlalchemy_connect_str，配置对应的数据库连接，如sqlite为sqlite:///数据库文件路径

  如提示缺少对应数据库的驱动，请自行通过poetry安装

3. **read_only**

  设置为true会开启只读模式。但我们仍然强烈推荐优先从数据库层面对用户权限进行限制

4. **top_k**

  限定返回的行数

5. **table_names**

  如果不指定table_names，会先使用SQLDatabaseSequentialChain，这个链会先预测需要哪些表，然后再将相关表输入SQLDatabaseChain，这是因为如果不指定table_names，直接使用SQLDatabaseChain，Langchain会将全量表结构传递给大模型，可能会因token太长从而引发错误，也浪费资源，但如果表很多，SQLDatabaseSequentialChain也会使用很多token

  如果指定了table_names，直接使用SQLDatabaseChain，将特定表结构传递给大模型进行判断，可节约一定资源。
  使用特定表的示例如下：

  ```yaml
    table_names: ["sys_user","sys_dept"]
  ```

6. **table_comments**


   如果出现大模型选错表的情况，可尝试根据实际情况额外声明表名和对应的说明，例如：

  ```yaml
    table_comments: {"tableA":"这是一个用户表，存储了用户的基本信息","tanleB":"角色表"}
  ```

---

## 三、国产信创数据库：人大金仓 KingbaseES / 达梦 DM

察元从知识库层面原生支持国产信创库。**协议层复用最近亲方言**：金仓协议与 PostgreSQL 兼容、达梦与 Oracle 兼容，所以不新建 Connector，只在 `dialects.py` 按官方驱动链 + SQL 方言 profile 注册即可。创建数据源 → 对话检索这条全链路（schema introspect / Text2SQL / 只读校验 / AST 租户注入 / 脱敏 / Prometheus 埋点）都自动生效。

### 3.1 驱动安装

| 数据库 | 推荐组合（生产） | 备用（开发/应急） | 默认端口 |
|--------|------------------|-------------------|----------|
| 人大金仓 KingbaseES | `pip install ksycopg2 sqlalchemy-kingbase`（官方） 或 `pip install kingbase8 sqlalchemy-kingbase` | `pip install psycopg2-binary`（退化为 PG 兼容模式，需金仓开启 PG 兼容） | **54321** |
| 达梦 DM | `pip install dmPython sqlalchemy-dm`（官方） | —（无备选；必须装 dmPython + DPI 动态库） | **5236** |

> **DM DPI 动态库**：`dmPython` 是 Python 对 C 动态库 DPI 的封装。部署时需确保
> `libdmdpi.so`（Linux）/`dmdpi.dll`（Windows）在 `LD_LIBRARY_PATH` / `PATH` 中。
> 可在达梦官方下载的 drivers 目录找到。

### 3.2 WebUI 接入

1. **"设置 → 🗄️ SQL 数据库 → 新建 SQL 数据源"**；
2. 方言下拉里选择 **"人大金仓 KingbaseES"** 或 **"达梦 DM"**，端口会自动填默认值；
3. 金仓高级选项：`search_path`（可选，类 PG）；
4. 达梦高级选项：`schema` / `autoCommit`（可选）；
5. 先点"仅测试连接"验证驱动 + 网络；成功后点"创建"。

### 3.3 对话检索

创建完成后，在**知识对话**里勾选该数据源（或勾选"全部"），提问会自动走 Text2SQL 管线：

- **Schema introspect**：通过 SQLAlchemy Inspector 枚举表 / 列 / 注释 / 3 行采样，写两级缓存（Redis → DB）；
- **LLM 生成 SQL**：system prompt 按方言追加"信创专项提醒"——
  - 金仓：`CURRENT_DATE` / `DATE_TRUNC` / `LIMIT N OFFSET M` / PG 风格双引号 schema；
  - 达梦：`SYSDATE` / `TO_CHAR(col, 'YYYY-MM-DD HH24:MI:SS')` / `ROWNUM <= N` / `||` 拼接 / `NVL`；
- **只读安全校验**：sqlglot AST 以 `postgres`（金仓）/ `oracle`（达梦）方言解析，拒掉任何写语句；
- **多租户 AST 注入**：`inject_tenant_where` 按相同 sqlglot 方言给 SQL 增补 `WHERE tenant_id = ...`；金仓额外支持 `SET LOCAL app.tenant_id` 打 PG RLS 策略；
- **per-query 超时**：金仓走 `SET LOCAL statement_timeout`（PG 家族共享）；达梦依赖客户端 socket timeout；
- **熔断 / retry / 脱敏 / Prometheus**：与其他方言完全一致。

### 3.4 别名支持

下列常见写法都会被归一化：

- `kingbaseES` / `kingbase_es` / `kb` → `kingbase`
- `dameng` / `dm7` / `dm8` / `dmdb` → `dm`

API 层 `POST /knowledge_source/` 的 `dialect` 字段可以用上面任意写法。

### 3.5 RAGAS 门禁

信创方言的生成/检索质量与 PG/Oracle 共享同一套 RAGAS 评测管线；建议在 `golden` 集内也放几条金仓/达梦专属 SQL 样本（例如 `ROWNUM` 分页 / 金仓 `search_path` 切换），确保评测通过再上线。

---

## 四、知识库"范围"语义（选表 / 选集合 / 选 index）

### 4.1 设计原则

> **选了就限定、没选默认全部。** 白名单字段 (`allowed.tables` / `allowed.collections` / `allowed.indices`) 非空即启用范围；空则沿用旧全量行为。

不引入新 DDL，完全复用 `KnowledgeSourceConnectionModel.allowed_json`。

### 4.2 结构化数据源（SQL / Hive / Kingbase / DM / Mongo / ES 文本 ...）

**新建时**：在 WebUI "🗄️ SQL 数据库 → 新建 SQL 数据源" 表单下方展开"🎯 限定范围"面板，点"拉取可选表"调轻量 `POST /knowledge_source/catalog` 接口，选完勾选再"创建"。

**查询时**：
- `SqlConnector.introspect` 按 `allowed_tables` 过滤（已有）；
- `graph_text2sql.node_generate` 在 RAG context 头部用`【⚠️ 严格范围（只能使用以下表，引用其它表会被拒绝）】` 声明硬约束，提升首次命中率；
- `graph_text2sql.node_validate` 复用 sqlglot AST 提取 `FROM`/`JOIN` 表，做表名硬校验：白名单外的表触发 `validation_error="table_not_allowed: ..."`，走 `node_revise` 让 LLM 重新生成（与执行失败共用同一条重试链路，最多 `max_retries` 次，默认 2）；
- Prometheus 计数器：`chayuan_text2sql_table_violation_total{dialect, reason}`。

**修改时**：走 `PATCH /knowledge_source/{id}/allowed`，**自动级联**失效三层缓存 + 进程内 catalog 缓存，防止读到旧快照。

### 4.3 外部向量库（kind=vs：Milvus / Zilliz / PG / Relyt / Chroma / ES）

**新建时**：WebUI "🧠 外部向量库 → 新建" → 填连接 → 点"🔎 拉取可选集合"（后端现采 `utility.list_collections()` / pg `SELECT ... FROM ...` / chroma `client.list_collections()` / ES `_cat/indices`）→ 多选。

**查询时**：`ExternalVsConnector.search` 做"fan-out / reduce"：
- **决定范围**：有 `allowed_collections` 按白名单；否则 `options.collection`（兼容老配置）；再否则现采后端全部集合（上限 `VS_AUTO_FANOUT_MAX_COLLECTIONS`，默认 20）；
- **并发扇出**：每集合独立 `VectorStore`（按集合名 memo），`run_in_executor` + `asyncio.gather(return_exceptions=True)`；
- **per-collection 超时**：`options.collection_timeout_sec`（默认 10s），超时不传染其他集合；
- **reduce**：`score` 归一后 `desc` 排序 → 截 `top_k`；
- **Citation 元信息**：`meta.collection` 带上每条命中所属集合，前端可分组展示；
- Prometheus：`chayuan_vs_collection_search_seconds{dialect, collection, status}`。

### 4.4 接口约定

| 方法 | 路径 | 用途 |
|------|------|------|
| POST | `/knowledge_source/catalog` | 轻量 catalog（创建流用；测连成功后拉可选项） |
| GET | `/knowledge_source/{id}/catalog?refresh=true` | 已存在源的 catalog + 当前已选 |
| PATCH | `/knowledge_source/{id}/allowed` | 只改白名单 + 级联失效缓存 |
| POST | `/knowledge_source/{id}/introspect` | 重型 introspect（带 sample rows / column type，落 schema_cache） |

`/catalog` 与 `/introspect` 的区别：catalog 是"下拉选项"视图（O(ms)），introspect 是"完整 schema"视图（O(s)）；前者适合创建/编辑流，后者适合 Text2SQL 检索命中后的 DDL 渲染。

### 4.5 一致性保证

所有会改变"可见对象集合"的操作 —— `update_connection`（含 `allowed`/`options`/`host`/`port`/`database` 任一变动）与 `PATCH /allowed` —— 会**同一事务之后**同步执行：

1. `delete_schema_cache(source_id)` 清 DB schema_cache；
2. `schema_cache_invalidate` 清 Redis 热层；
3. `template_cache_invalidate` 清 SQL 模板缓存；
4. `invalidate_result_cache_by_source` 清短 TTL 结果缓存；
5. 进程内 catalog 5min LRU 清对应 key。

保证"改完白名单立即生效，下一次 search 不会拿到旧表列表"。

### 4.6 性能数据（参考）

- Catalog 探测：Milvus 一次 `list_collections` ≈ 3 ms；SQL `get_table_names()` ≈ 10–30 ms。进程内 5min LRU 再命中为 0.01 ms。
- VS fan-out：5 集合 × Top-20，单 collection L2 检索 P95 ≈ 40 ms；并发后**整体 P95 ≈ 50 ms**（瓶颈在最慢集合 + Python GIL 调度）。
- SQL AST 白名单校验：sqlglot 解析 + 节点遍历 ≈ 0.5 ms；相对 Text2SQL 本身 LLM 调用可忽略。
