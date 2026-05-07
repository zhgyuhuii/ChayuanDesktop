# 训练数据中心 · 数据挂载

> 把 12 种数据源接到 chat 运行时 / KB 候选 ingest,以"挂载"语义统一管理。
> 入口:**训练数据中心 → 数据挂载** tab。

## 概念

**数据挂载** = 把外部数据(KB / 文件 / Web / SQL / Mongo / S3 / Notion / Confluence /
GitHub / 标注样本 / 历史对话 / 知识源)以受控方式接进系统,根据"挂载模式"
影响 chat 行为或 KB 内容。

5 种挂载模式:

| 模式 | 行为 | 影响 KB 索引? |
|---|---|---|
| `corpus` | 候选 ingest 任务,KB 页确认后才真正 ingest | 是(用户确认后) |
| `context` | 高置信片段在 chat 时塞入 prompt 上下文 | 否 |
| `fewshot` | Q-A 样例作 in-context examples | 否 |
| `safety` | 硬约束规则附在 system prompt | 否 |
| `preference` | chosen/rejected 偏好对,长期对齐 LLM | 否 |

## 12 种数据源

| type_id | label | 适用模式 | 依赖 |
|---|---|---|---|
| kb | 知识库 | corpus / context / fewshot | 内置 |
| knowledge_source | 知识源 | corpus / context | 内置 |
| file | 文件 / 文件夹 | corpus / context / fewshot | 内置 |
| annotation | 标注样本 | context / fewshot / preference / safety | 内置 |
| web | Web 网页 | corpus / context | langchain_community |
| sql | SQL 数据库 | corpus / context / fewshot | sqlalchemy |
| s3 | S3 / MinIO | corpus / context | boto3 + langchain_community |
| mongo | MongoDB | corpus / context / fewshot | pymongo |
| notion | Notion | corpus / context | langchain_community + Notion API |
| confluence | Confluence | corpus / context | atlassian-python-api |
| github | Git 仓库 | corpus / context | GitPython |
| conversation | 历史对话 | fewshot / preference | 内置 |

## 工作流

1. **新建挂载向导(4 步)**
   - 选数据源:从卡片网格选 1 种
   - 配置:动态表单(根据 source.spec_form);"探活"按钮验证连接
   - 模式 + 范围:勾选 1-5 种 mode + scope (global / user / kb / group);
     选 corpus 时必填目标 KB
   - 预览:抽样 50 条 + 自动字段分析 + 保存草稿 / 立即发布
2. **导入 / 导出**
   - JSON: 一个 list 或单个 object,见 `MountCreateBody` schema
   - CSV: 首行表头,必须含 `name`/`source_type`/`mount_modes`(逗号分隔);
     其它列拼到 `source_filter.spec.options`
   - 导出:列表全部 mount + artifacts,JSON

## API

- `GET  /data-mounts/sources` 数据源目录(含字段表单 schema)
- `POST /data-mounts/sources/probe` 探活
- `POST /data-mounts/sources/analyze` 抽样 + 字段分析
- `POST /data-mounts` 创建草稿
- `POST /data-mounts/{id}/preview` 物化预览
- `POST /data-mounts/{id}/publish` 发布(写 artifact)
- `POST /data-mounts/{id}/disable` / `/enable`
- `POST /data-mounts/import` 批量导入(JSON / CSV)
- `GET  /data-mounts/{id}/export` 导出单条 mount + artifact

## 准确率提升

实测组合:

| 配置 | Recall@5 |
|---|---|
| 仅 hybrid_search + rerank | 基线 |
| + 指定 KB corpus mount | +5~10% |
| + 5-10 条人工 fewshot mount | +3~7% |
| + 安全规则 mount | recall 不变,但幻觉 -40% |

详见 `docs/benchmarks/kb_recall.md`。

## 常见问题

**Q: 发布 corpus 模式 mount 后,为啥 KB 内容没变?**
A: corpus 模式只生成"候选 ingest 任务";请到 KB 详情页确认任务后才会真 ingest。
   这是为避免无人审核的数据偷偷写入向量库。

**Q: 同一份数据挂载多次会重复吗?**
A: KB 内 doc_id 去重(基于 record.id 或 metadata.doc_id);如果源不给稳定 ID
   会按文本 hash 粗去重,极端边界仍可能重复 2-3 次。

**Q: Web / GitHub / S3 等外源更新了,mount 怎么跟上?**
A: 当前 v6:在数据挂载 tab 选中条目 → 点"重新发布"。v6.2 计划加 cron 自动
   重物化(由 `chayuan service.cron` 触发)。

**Q: 想自己加一种源?**
A: 在 `chayuan/server/data_mount/sources/` 加一个 .py,实现 4 个方法
   (`spec_form` / `probe` / `sample` / `load`),导出 `ADAPTER`;在 `registry.py`
   `register_default_sources` 的 `modules` list 里加一行即可。
