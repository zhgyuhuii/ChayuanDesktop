# 数字人模块优化:知识库收敛单一 + 编辑/生成布局重排 + 卡片入工作台

- 日期:2026-06-02
- 状态:已通过 brainstorming,待用户复审
- 影响项目:`chayuan-client`(编辑/生成 UI + 数据模型 + 路由)、`chayuan-server`(多角色检索)

## 1. 背景

用户在数字人模块提出 6 条优化诉求。现状(已探索确认):
- 知识库是**双层模型**:preset 级 `ku_ids` + 角色级 `AvatarSlot.ku_ids`(空=继承),多角色 AI 生成后端按各角色专属库逐角色检索。
- 合成模式在 `PresetEditor` 中部;KB/模型/两个 override 开关分散。
- "我的数字人"卡片「生成」按钮切到 `generate` 纯表单 tab,不是 `studio` 工作台。
- 选音色后合成视频疑似未用该音色(音色不在生成请求体,后端从 preset 取)。

## 2. 架构师 + 产品视角(竞品)

主流 AI 数字人(HeyGen / Synthesia / D-ID / 腾讯智影 / 硅基智能)的共性,作为本设计依据:
- **知识/脚本接地是项目级,不是角色级**:无主流产品给每个出镜形象单独绑知识库。→ 支撑 #1/#5。
- **"身份"是角色级**:形象、**音色**、人设跟着每个角色走(多人各异是刚需)。→ 音色保持角色级,仅 KB 收敛。分界线:*角色级=身份(形象/音色/人设),项目级=知识与脚本接地*。
- **合成模式是一等公民、靠最前**。→ 支撑 #3。
- **点形象/模板进的是带预览的工作台,不是干表单**。→ 支撑 #6。

结论:6 条整体方向向主流收敛,采纳。

## 3. 目标(逐条)

1. **#1 知识库单一真源**:全模块(单形象/多人同框/分段轮流)生成与检索共用一套 KB = preset 级 `ku_ids`。
2. **#5 移除"该角色知识库"**:**彻底移除** `AvatarSlot.ku_ids` 字段 + UI + 后端按角色检索逻辑。
3. **#3 合成模式上移**:编辑页放到"名字"下方。
4. **#4 三项一行**:`知识库 → 对话模型 → 允许更改`(允许更改**保留两个独立开关**:允许模型更改 / 允许KB更改,置于模型之后),编辑页 + 生成面板都统一。
5. **#6 卡片生成入工作台**:卡片「生成」→ `studio` 并预选该数字人。
6. **#2 音色未生效**:作为 **bug** 处理(走系统化排查,见 §7)。

## 4. 非目标
- 不动音色的角色级归属(竞品共识,保留)。
- 不重写 `install_task_manager` / 运行时安装(那是另一条已搁置的 spec)。
- 不改实时对话页(`LiveAvatarPage`)的核心交互,仅顺带让其 KB/模型也走单一真源(若已是 preset 级则无需改)。

## 5. 设计

### 5.1 数据模型(#1/#5 — 彻底移除角色级 KB)
- `packages/api/src/digitalHuman.ts`:从 `AvatarSlot` 删除 `ku_ids` 字段。`DigitalHumanPreset.ku_ids` 为知识库**唯一真源**。
- 后端 `chayuan-server` 多角色脚本生成(`generateMultiRoleScript` 链路 + `digital_human` 检索):所有角色统一用 preset `ku_ids` 检索,删除"每角色专属 ku_ids"分支。
- 兼容:旧 preset 里残留的 `AvatarSlot.ku_ids` **忽略不读**(不迁移、不报错)。
- 失效检测(`dhBinding`):只检测 preset 级 `ku_ids`(现状已是)。

### 5.2 编辑页布局(PresetEditor,#3/#4/#5)
从上到下:
1. 形象(单/多角色形象选择)
2. **名字**
3. **合成模式**(single / coframe / sequential)— 紧跟名字下(#3)
4. **一行三区**(#4):`[知识库选择]` `[对话模型选择]` `[允许模型更改 ☐ 允许KB更改 ☐]`(KB 在模型前,两个开关在模型后)
5. 各角色区:形象槽 / 昵称 / 语言 / **音色** / 语速 / 音量 / 人设 — **删除"该角色知识库"**(#5)

### 5.3 生成面板统一(GeneratePanel,#4 范围)
- KB/模型选择器复用编辑页同一套语义与单一真源。
- 仅当对应 override 开关开启时,生成面板才显示 KB/模型选择器(否则锁定 preset 值,只读展示绑定来源)。
- AI 文案生成、多角色生成、依据来源(`KbResultsView`)全部基于 preset 单一 KB。

### 5.4 卡片入工作台(#6)
- `DigitalHumanPage.goGenerate(presetId)`:`setTab('studio')`(原 `'generate'`)并 `setGenPresetId(presetId)`,工作台 `DhStudio` 左预览 + 右生成面板均预选该 preset。
- 保留 `generate` tab 本身(直接进生成 tab 的其他入口不变),仅卡片按钮改指 studio。

### 5.5 音色 bug(#2 — 见 §7,设计上不预设修法)

## 6. 数据流要点
- 生成请求:KB 始终来自 preset `ku_ids`(或 override 开启时的生成面板临时值);不再有角色级 KB 参与。
- 多角色检索:后端对每个角色用同一 preset KB 检索(角色差异仅体现在 persona/音色,不在知识源)。

## 7. #2 音色未生效 — bug 排查(系统化,不在设计内拍脑袋)
已知链路事实(待验证):音色存于 `DigitalHumanPreset.voice_provider/name` 与 `AvatarSlot.voice_provider/name`;`dhGenerate` 的 opts **不含**音色;后端从 preset 解析。
实现阶段按"修 bug 强制纪律"先定位真因(候选:① 单形象 slots[0] 音色未镜像到 preset 顶层;② 后端合成未按 slot 音色逐段 TTS;③ 生成请求确实需要带音色但没带),拿到现场证据再修,不在本 spec 预设结论。

## 8. 错误处理 / 兼容
- 删除 `AvatarSlot.ku_ids` 后,读旧 preset 不报错(字段缺失即忽略)。
- override 关闭时生成面板锁定 preset 值,避免"两处语义不一致"。
- 卡片改 studio 后,确保 `DhStudio` 能接 `initialPresetId` 预选(现 GeneratePanel 已支持 `initialPresetId`)。

## 9. 测试计划
- 前端 `npm run typecheck`(删字段后所有引用处编译通过)。
- 后端:多角色检索改单一 KB 的回归(单测:多角色生成用 preset ku_ids,不再读角色 ku_ids)。
- `#2`:补一个"选定音色 → 生成请求/合成产物用该音色"的回归测试(定位真因后)。
- 手动:编辑页布局顺序、三项一行、卡片生成进工作台、override 开/关时生成面板 KB/模型显隐。

## 10. 风险
- 删 `AvatarSlot.ku_ids` 牵动前后端多处引用,需全量 grep 改净(typecheck 兜底)。
- 后端多角色检索改单一 KB,若有评测/缓存依赖角色级 KB 需一并清理。
- #2 真因未定,实现阶段若发现牵动 TTS/合成较深,单独评估。
