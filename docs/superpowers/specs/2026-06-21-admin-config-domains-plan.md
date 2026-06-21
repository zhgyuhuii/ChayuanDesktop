# 后台配置域补全计划（原 8502 NiceGUI → React 控制台）

> 2026-06-21 立项。把原 8502 config_panel 里尚未迁到 React 的配置域全部补齐，落进
> 独立管理员控制台（/admin AdminConsole）。用户决策：① 按价值/风险排序逐期做；
> ② 敏感操作做完整可写(强确认+admin+重启提示+审计)；③ 数据目录也可改(容器内基本无效，会标注)。

## 分期（按确认顺序）

- [x] P1 默认模型 — 纯前端。GET/POST /admin/capability_defaults 已有。9 个分组下拉(按 platform_name 分云/本地)+当前默认+切换即存。AdminConsole 新增「默认模型」域。(本期)
- [ ] P2 模型平台完整化 — 替换 PlatformAdmin 薄壳：平台 CRUD、API Key/base_url/proxy/并发编辑、测试连接+拉模型、8 类模型启停、供应商目录(~60)。后端大部已有(/admin/model_platforms*)。
- [ ] P3 Redis — 补 POST /api/v1/admin/redis/{test,save}+GET status(复用 redis_config 逻辑)；UI 6 字段+测试+保存+清空。
- [ ] P4 对象存储 MinIO — 后端已全有(/storage/*)，纯 UI：切换 local/minio+9 字段+测试+迁移(强确认)。
- [ ] P5 数据库 — 补 POST /api/v1/admin/db/{validate,create,save}(admin-only;create 二次确认+审计+防注入)；UI DB 类型下拉(sqlite/pg/mysql)+动态字段+测试+建库+保存；向量库(vs_config 7 种)子项。
- [ ] P6 服务与框架 — 框架卡片启停、外部端点注册、服务健康卡、本地服务探测。
- [ ] P7 数据目录 — GET info(root/来源/派生路径/诊断)+写 rc(容器内标注无效)。

## 关键真源
- 默认模型 yaml 键(runtime_framework_panel.py:1493): DEFAULT_LLM_MODEL/EMBEDDING/IMAGE_EMBEDDING/RERANK/TEXT2IMAGE/TEXT2VIDEO/TEXT2SPEECH/SPEECH2TEXT/OCR。9 cap 标签 CAPABILITY_LABELS(对话/文本嵌入/图像嵌入/重排/文生图/文生视频/语音合成/语音识别/图像识别文字)。
- DB/Redis/MinIO 配置写 basic_settings.yaml(yaml_store.save_updates)，改后需重启。
- DB 可复用: db_config.py validate_connection/create_database/build_uri/parse_uri(_assert_safe_identifier 防注入)。
- Redis 可复用: redis_config.py validate_connection/build_url/parse_url。
- MinIO REST: storage_routes.py /storage/{status,test_connection,switch_backend,migrate,list,object}。
- admin_router 前缀 /admin；新管理端点放 /api/v1/admin/<域> 或复用 /admin。

## 验证
每期前端 node_modules/.bin/tsc -p packages/app/tsconfig.json --noEmit；动后端则 py312 pytest/ast。真效果需重建镜像。
