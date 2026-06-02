# 数字人多角色/结构化脚本生成 — 设计

> 状态:设计已与用户逐节确认(2026-06-02)。下一步 writing-plans。
> 仓库 /work/chayuan-desktop(root,sudo)。分支 main→origin/main。能跑 py312(免密 sudo+conda py312)。
> 依赖已完成:模型+知识库绑定(预设级 model/ku_ids、_retrieve_kb_context grounding+kb_used/sources)、
> 每角色脚本模型(coframe role_scripts 按句交织 / sequential role_segments 有序)、ModelMenuList/KnowledgePickerPill 受控。

## 目标
把"一篇文案机械切开分发"升级成**真·多角色结构化脚本生成**:每角色有人设/语气、可绑各自知识库,
AI 一次生成符合人设、用各自事实的有序对话;支持内置带货结构模板;给分段时长预估避免失衡。

## 已确认决策
1. 生成架构 = **一次 LLM 调用**:逐角色检索各自库 → 把所有角色 昵称+persona+各自库上下文(按角色标注)+
   模板结构 合入一个 prompt → 模型一次写出有序交错对话。检索按角色各自做,生成合一次。
2. 模板 = **内置一组结构模板、可选**(注入 prompt),不做 CRUD。
3. AI 多角色产物**统一存有序 role_segments**(coframe+sequential 通用);手写每角色框走 role_scripts,两条并存。

## ① 数据模型
- `AvatarSlot`(schemas.py + 前端 digitalHuman.ts)新增:
  - `persona: str = ""`(人设/语气)
  - `ku_ids: List[str] = []`(该角色知识库;空=回退预设级 ku_ids)
- 新模块 `digital_human/script_templates.py`:`ScriptTemplate{id,name,sections:List[str]}` 常量列表
  (`带货四段`=开场吸引→卖点展示→促单逼单→结尾引导;`问题方案`=痛点→方案→行动;`自由`=默认无结构)。
  前端镜像同一组常量(或经一个 `GET /v1/digital-human/script-templates` 返回,二选一,优先后端真源+前端拉取)。

## ② 生成架构(一次调用多角色 prompt)
- **逐角色检索**:对每角色 i,`eff_ku_ids = role.ku_ids or preset.ku_ids`,调既有 `_retrieve_kb_context(user, eff_ku_ids, subject)` → (context_i, sources_i)。空库无 grounding。
- **拼 prompt(一次 LLM,复用 preset model,多模态商品图也带)**:指令=写多角色口播/带货脚本;
  列各角色 `昵称+persona`;注入所选模板 sections + paragraph_number;各角色 KB 上下文按角色标注
  「【<昵称>·参考资料】…」;主题;**严格输出格式**:每行 `[角色名] 台词`,按播放顺序排。
- **解析输出** → 有序 `role_segments:[{role_index,text}]`(行的角色标签→role_index,顺序=模型产出对话顺序)。
- 返回 `{role_segments, kb_used, sources(各角色合并、带角色标注)}`。
- **新后端入口**:`POST /v1/digital-human/script/generate-multi`(或 /script/generate 加 multi 模式),
  入参 preset_id/subject/template_id/(product_ref);内部读 preset.compose_mode+avatars(各 persona/ku_ids)、
  逐角色检索、拼 prompt、调 generate 用的 LLM(get_ChatOpenAI(model))、解析、返 role_segments+sources。
- **plan coframe 扩展**:有 role_segments 时按其顺序做同框 turntaking(每段该角色说、其余待机);
  无则回退现有 role_scripts(每角色框手写→按句交织)。sequential 本就用 role_segments。plan 优先 role_segments。

## ③ 时长预估 + 节奏预览
- 纯函数 `estimateDurationMs(text, voiceRate)` = `字数 / (4.5 × voiceRate) × 1000`(中文 TTS 基准 4.5 字/秒,
  voiceRate 取该角色 slot.voice_rate)。前端 util,单测覆盖。
- 多角色「对话脚本」预览:每段显示 `≈X秒` + **每角色累计** + **总时长≈Ys**,让 A=50s/B=5s 失衡一眼可见。

## ④ 前端 UI
- **PresetEditor**(每角色聚焦配置区):加 `persona` textarea;加每角色 `KnowledgePickerPill`(受控,绑 role.ku_ids,
  空=继承预设级,提示「留空=用预设知识库」)。
- **GeneratePanel**:模板选择器(下拉内置 ScriptTemplate,含"自由");多角色「AI 生成文案」→ 调多角色生成
  (带 template_id)→ 有序 role_segments + sources → 有序「对话脚本」展示(角色标签+台词+每段≈秒+各角色累计+总时长),
  可编辑/重排;手写每角色框仍可用。复用既有 sources 展示(KbResultsView)。
- `digitalHuman.ts`:`generateMultiRoleScript({preset_id,subject,template_id,productRef?})→{role_segments,kb_used,sources}`;
  `listScriptTemplates()`(若走后端);AvatarSlot 类型加 persona/ku_ids。

## 错误处理
- 逐角色检索失败 → 该角色无 grounding,继续(不阻断)。
- **输出解析容错**:模型未严格按 `[角色名] 台词` → 容错(认 `[名]`/`名:` 前缀,昵称模糊匹配;无标签行并入上段或轮流);
  完全解析不出 → 退回「整段塞第一角色 + 提示手动调整」,不崩。
- 模板=自由 → 不注入结构。
- 单角色(single)不走多角色生成,沿用现有 generate_script。

## 测试(py312)
- prompt 构造:含各角色 persona + 各自库上下文 + 模板 sections(捕获 prompt 断言)。
- 输出解析器:role-tagged 行 → 有序 role_segments;昵称→index;未知标签/无标签容错;完全失败兜底。
- `estimateDuration` 纯函数。
- `script_router.plan` coframe 接受 role_segments(有序 turntaking)路径。
- 逐角色检索 eff_ku_ids 回退(role.ku_ids 空→preset.ku_ids)。
- 复用既有 grounding/sources/plan 测试不回归。
- 前端 `pnpm -r typecheck` + estimateDuration/解析器(若 ts)vitest。

## 实施约束
- root→sudo;分支 main;能跑 py312 真测(免密 sudo)。真复用:_retrieve_kb_context、get_ChatOpenAI、
  ModelMenuList/KnowledgePickerPill 受控、KbResultsView(sources)、script_router.plan、effective 绑定 helper。

## 分期(writing-plans 细化)
- P1 数据模型:AvatarSlot persona/ku_ids(前后端)+ ScriptTemplate 常量/endpoint。
- P2 后端多角色生成:逐角色检索+多角色 prompt 构造+输出解析(纯函数单测)+ generate-multi 路由。
- P3 plan coframe 接受 role_segments + 时长预估纯函数。
- P4 前端:PresetEditor persona/per-role KB;GeneratePanel 模板选择+多角色生成+对话脚本预览(时长)。

## 未做(YAGNI)
- 模板 CRUD/自定义模板库。
- 每角色不同 model(仍用预设级 model 一次生成;per-role model 不在本期)。
- 流式逐句吐出(一次性返回)。
