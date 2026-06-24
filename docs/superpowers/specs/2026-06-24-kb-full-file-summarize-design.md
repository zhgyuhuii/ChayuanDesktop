# 知识库「全文总结」(方案 A:实时全文归纳)— 设计

日期:2026-06-24 · 状态:设计已确认(用户选 A;入口双轨;超大先估时确认)

## 目标
用户问"xxx 文件写的是什么/总结一下这个文件"时,**站在整篇**归纳,而不是只召回 top-k 分块。

## 现状(已核实)
- 文档库问答 = 分块 top-k 向量检索(默认 top_k=5),`synthesize_answer` 只基于召回片段。
- 路由 `infer_intent()` 无"总结"意图;向量 `search_docs()` 不支持 file_name 过滤。
- **已有可复用件**:`kb.list_docs(file_name)`+`get_doc_by_ids`(取全文)、`SummaryAdapter`(map-reduce 全文摘要)、
  `kb_summary` 摘要向量库、`recreate_summary_vector_store` 的流式 `output()` 模式、`synthesize_answer`。
- 缺口:这些没接进实时查询。

## 设计

### 服务端
1. **查询契约**(`kb_query/schemas.py`):`SearchRequest.options` 增 `summarize`:
   `{ mode:"summarize_file", file_name:str, kb, confirmed?:bool }`。设了即走总结路径,不进 top-k。
2. **意图/路由**(`retrieval/query/router.py`):新增 `document_summarize`。
   - 按钮:前端直接带 `mode + file_name`(精确)。
   - 对话 NL:命中关键词(总结/概括/归纳/写的是什么/讲了什么/主要内容/全文)+ 从问题抽候选文件名 →
     与该 KB 文件清单**模糊匹配**;唯一命中→总结;多个/0→让用户选或回退 top-k(不瞎猜)。
3. **总结执行**(新分支,复用件):
   - 取全文:`kb.list_docs(file_name)`→`get_doc_by_ids`。
   - 归纳:复用 `SummaryAdapter`(map-reduce + 递归 reduce);**map 阶段并发**(asyncio.gather 分批,默认并发 6,可配)。
   - **缓存**:结果回写 `kb_summary` 摘要库;键 = 文件名 + **内容哈希**(文件重新入库→哈希变→自动失效重算)。
     查询先查缓存,命中且新鲜→秒回。
4. **异步 + 流式**:复用 `recreate_summary_vector_store` 的流式 `output()`,吐进度(第 i/总 块、reduce 中、完成)。
5. **超大文件兜底**:chunk 数 > 阈值(**默认 60 块**,可配 `KB_SUMMARY_CONFIRM_CHUNKS`)→ 返回 `needs_confirm`
   (含块数/预计调用次数/约耗时)→ 前端确认 → 带 `confirmed=true` 重发。

### 客户端
1. **按钮(主)**:`DocumentKbDetail`/`KbDetailPage` 文件预览加「总结全文」(后台 `KbAdminDetail` 复用同组件自动有)
   → 调总结端点 → 进度条 → 渲染摘要(可复制)。
2. **对话 NL(次)**:KB 会话输入"总结 xxx 文件" → 前端识别意图+文件名 → 同一端点/进度/渲染。
3. **超大文件**:收到 `needs_confirm` → 确认框(预计耗时/调用数)→ 确认再跑。

## 默认取舍(可在 spec review 时调整)
- 缓存失效:**内容哈希**(比入库版本号更稳,任何内容变都失效)。
- 超大阈值:**60 块**(可配)。
- NL 轨:做,但排在最后(先按钮)。
- map 并发度:6(可配)。

## 里程碑
- **M1(服务端)**:契约字段 + 总结路径(取全文→并发 map-reduce→回写缓存)+ 流式 + needs_confirm 阈值。先不接 NL。
- **M2(按钮)**:文件预览「总结全文」按钮 + 进度 + 渲染 + 确认框。后台因复用同组件自动具备。
- **M3(NL)**:对话内"总结某文件"意图识别 + 文件名模糊匹配。

## 验证与限制
- 服务端:补 schema/路由/缓存键 单测;`py_compile`。
- ⚠ 本沙箱缺 langchain 等全栈依赖,无法跑总结链集成测试;集成/真机验证待用户环境。
- 前端:`packages/app` `tsc --noEmit`。
