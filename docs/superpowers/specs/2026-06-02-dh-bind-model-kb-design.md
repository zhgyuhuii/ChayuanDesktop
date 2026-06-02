# 数字人预设绑定「对话模型 + 知识库」+ 知识库驱动脚本生成 — 设计

> 状态:设计已与用户逐节确认(2026-06-02)。下一步 writing-plans。
> 仓库 /work/chayuan-desktop(root,sudo 提交)。分支 main→origin/main。
> 沙箱 py3.6 跑不了 pytest、前端 toolchain 有时可用 → 真验证靠用户 py312 + 重建/重启 sidecar。
> 依赖:已完成的「文案生成选模型」(GeneratePanel ModelMenuList)、模型广场(本地模型)、
> 项目统一知识查询路径(ku_ids/KnowledgeRef,POST /api/v1/kb-query/search)。

## 目标

数字人预设绑定「对话模型 + 知识库」,实时对话/生成视频时默认用绑定值(不必再选);
预设可配「是否允许临时更改」;脚本生成可基于知识库检索做 grounding,生成贴合企业话术的文案。

## 已确认决策
1. 覆盖语义 = **预设作默认、是否可临时改由预设里的开关控制**:`allow_*_override=true`→实时/生成页
   显示选择器(预填预设值、可临时改、不写回预设);`false`→隐藏该组件、固定用预设值。
2. **模型、知识库各一个独立开关**(按组件粒度)。
3. 模型存 `platform_name::id`(带平台消歧,沿用前期实现)。

## 设计 ①:数据模型 + 覆盖开关

预设新增字段(后端 `digital_human/schemas.py` `DigitalHumanPreset` + 前端 `packages/api/src/digitalHuman.ts` 同步):
```
model: str = ""                       # 绑定对话模型 platform_name::id
ku_ids: List[str] = []                # 绑定知识库 doc:<kb>/src:<id>
allow_model_override: bool = True     # 实时/生成时显示模型选择器(预填)、可改
allow_kb_override: bool = True        # 实时/生成时显示知识库选择器(预填)、可改
```
预设级字段(不随合成模式/角色变)。向后兼容:都给默认值,旧预设无此字段时 model/ku_ids 空、override 默认 true(行为同今天)。

## 设计 ②:PresetEditor UI

在 PresetEditor **预设级全局设置区**(合成模式附近、各角色配置之上)加两组:
- **对话模型**:复用 `ModelPicker`(或 ModelMenuList 包装),`value=model`(platform::id)、capabilityFilter=CHAT_CAPABILITIES(chat+vl);旁 checkbox「允许实时/生成时更改」→ `allowModelOverride`(默认勾)。
- **知识库**:复用 `KnowledgePickerPill`,**受控实例**(本地 `kuIds` 状态,不耦合 live 的 dhComposerStore)。
  KnowledgePickerPill 现读写全局 store → **给它加可选受控 props(`value`/`onChange`),保持向后兼容默认走 store**(真复用,不 fork 阉割版,CLAUDE.md 硬规则)。旁 checkbox「允许实时/生成时更改」→ `allowKbOverride`(默认勾)。
- `onSave` body 加 `model`、`ku_ids`、`allow_model_override`、`allow_kb_override`。

## 设计 ③:实时/生成页消费

**统一"有效值"解析**(实时+生成同规则):
- `effectiveModel = allowModelOverride ? (会话选值 ?? preset.model) : preset.model`
- `effectiveKuIds = allowKbOverride ? (会话选值 ?? preset.ku_ids) : preset.ku_ids`
- 选择器显隐:`allow*Override===false && preset 有绑定值` → 隐藏、固定用预设值;否则显示+预填预设值(可改、不写回)。
- 边界:`allow*Override===false 但预设无绑定值` → 退化为显示选择器(避免死锁,等同今天)。

**实时页 `LiveAvatarPage`**(已有 ModelPicker + KnowledgePickerPill):
- 选/切预设 → `preset.model` 预填 ModelPicker(decode id+platform);`preset.ku_ids` → `dhComposerStore.setState({selectedKuIds: preset.ku_ids})` 预填。
- 按 allow_* 显隐;对话请求用 effectiveModel + effectiveKuIds(沿用 ChatRequestV2 {query, model, ku_ids})。

**生成页 `GeneratePanel`**:
- 模型选择器(前期已加):预填 preset.model,按 allow_model_override 显隐。
- **新增知识库选择器**(KnowledgePickerPill,满足需求3 脚本可选库):预填 preset.ku_ids,按 allow_kb_override 显隐。
- `generateScript` 调用加 `kuIds: effectiveKuIds`;model 用 effectiveModel。

## 设计 ④:后端脚本 grounding

职责划分(generate_script 不耦合 authz/检索,保持可测):
- **路由 `/script/generate` 做检索**(有 request/鉴权上下文):取 `ku_ids = body.get("ku_ids")`,非空时:
  1. 构造 `Subject`——**读 `/api/v1/kb-query/search` 路由 handler 怎么从 request 建 Subject**(单机桌面多半 owner/guest 默认 subject),照同款,别瞎造权限。
  2. `req = SearchRequest(ku_ids=ku_ids, contents=[QueryContent(text=subject)], options=QueryOptions(top_k=3))`;`kb_query.service.search(subject, req)`。
  3. 命中结果(items content/citation)格式化成 `kb_context` 文本块。
  4. 传 `generate_script(..., kb_context=kb_context)`。
- **`generate_script(..., kb_context: Optional[str]=None)`**:有 kb_context → 作为「【企业知识/参考话术】」注入 prompt(主题提示前),引导贴合企业话术;可与多模态(商品图)叠加。
- **检索失败兜底**:log warning,**不阻断**——退化为无 grounding 普通生成。

## 错误处理
- KB 检索失败/超时/无命中 → 不阻断,无 grounding 继续出稿,日志告警。
- 预设绑定的模型/库已失效(删了) → 实时/生成时回退选择器(显示)+ 提示;脚本检索无命中即无 grounding。
- 模型 platform::id 解析:沿用前期 decode/encode。

## 测试
- 后端单测(py312):`generate_script` 传 kb_context → 断言 prompt 含上下文;无 → 回归不变。schemas 新字段默认值/向后兼容。
- 检索/Subject:集成层验或 mock kb_query.search。
- 前端:`pnpm -r typecheck`;PresetEditor 保存含新字段;实时/生成预填+显隐逻辑。
- 集成冒烟(用户 py312+重建):①预设绑模型+库保存 ②实时选该预设→不必再选直接对话(走绑定模型+库) ③allow_override 关→实时/生成不显示选择器 ④生成页脚本生成基于绑定库 grounding ⑤生成页临时改库/模型生效(不写回预设)。

## 实施约束
- root→sudo;分支 main;沙箱 py3.6 只 ast/py_compile,前端 toolchain 有时可用;真验证靠用户。
- 真复用硬规则:ModelPicker/ModelMenuList、KnowledgePickerPill(加受控 props,不 fork)、kb_query.service.search、SearchRequest/QueryContent/QueryOptions、Subject 构造同 kb-query 路由、dhComposerStore(实时 KB 态)。

## 分期(writing-plans 细化)
- P1 数据模型:schemas 前后端加 4 字段(向后兼容)。
- P2 PresetEditor:模型 + KB(受控,给 KnowledgePickerPill 加受控 props)+ 两开关 + 保存。
- P3 后端 grounding:/script/generate 建 Subject+检索+kb_context;generate_script 注入 + 单测;generateScript 客户端加 kuIds。
- P4 消费:LiveAvatarPage + GeneratePanel 预填/显隐/有效值解析(GeneratePanel 新增 KB 选择器)。

## 未做(YAGNI)
- 知识库内容编辑/管理(用现有 KB 管理页)。
- 实时对话的 KB 引用展示样式改造(沿用现有)。
- 每角色绑定不同模型/库(预设级统一绑定即可,多角色台词已各自音色)。
