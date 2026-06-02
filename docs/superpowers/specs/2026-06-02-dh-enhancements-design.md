# 数字人增强簇设计 — 命名/显示 + 文案多模态 + 每角色脚本模型

> 状态:设计已与用户逐节确认(2026-06-02)。下一步 writing-plans。
> 仓库 /work/chayuan-desktop(root,sudo 提交)。分支 main→origin/main。
> 沙箱 py3.6 跑不了 pytest、前端无 toolchain → 真验证靠用户 py312 + 重建/重启 sidecar。
> 依赖:已完成的「模型广场」(可装 local-image-to-text VLM;对话下拉 /v1/models)。

## 目标

数字人「创建/编辑 + 工作台文案生成 + 生成」的 7 条增强,分 3 部分:
- A 命名 & 显示:形象昵称必填;角色名一律显示「设置的名称」而非图像路径。
- B 文案多模态:文案生成可选模型;上传商品图/视频 → VLM 直接看图出文案;无 VLM 引导去模型广场。
- C 每角色脚本模型:同框=每角色独立脚本框、按句轮流交织;分段轮流=按角色分组、组内可多段。

## 已确认的关键语义(澄清结论)

1. 同框「自动穿插」= **按句轮流**:每角色脚本各自切句 → A句1→B句1→A句2→B句2… 各用自己音色,
   说话者动口型、其余待机。复用 R4 `render_coframe_turntaking`,只把输入从「共享 script 轮流」
   改成「每角色 role_scripts 交织」。
2. 图生文案 = **VLM 直接看图出文案**(商品图+主题→多模态 image_url message→选中 VLM 一步出稿)。
3. 视频商品 = **抽多帧拼贴喂 VLM**(ffmpeg 抽 3-4 帧)。
4. 分段轮流分组 = **每角色一组、组内可加多段**(同角色可多次出场,按段序在各角色组间轮流)。

---

## Part A:命名校验 + 角色名显示

### A1 昵称必填(#4)
- `chayuan-client/packages/app/src/features/digital-human/PresetEditor.tsx`:`canSave` 增加
  `slots.every(s => (s.name ?? '').trim().length > 0)`(单/多形象统一:每个 slot 都要有昵称)。
- 保存禁用时行内提示「每个形象必须填昵称」,并高亮缺昵称的角色(聚焦配置区昵称框红框)。

### A2 角色名显示名称而非路径(#5)
- 后端 `digital_human/jobs.py` 字幕标签已取 `slot.name`(A1 保证非空,不再空回退)——无需改逻辑,
  但实现首步 **grep 定位前端/后端把 `avatar_ref`/`relpath`/文件名当角色名显示** 的地方
  (疑在实时页角色列表、字幕设置角色列表、或 CanvasStage/GeneratePanel 的 name 回退链),
  统一改成 `slot.name`,去掉文件名回退。
- 审计点清单(实现时逐一确认用 name):CanvasStage 标签、GeneratePanel 分段框 placeholder、
  字幕/实时页角色列表、overlay labels(后端已 OK)。

---

## Part B:文案生成选模型 + 图像/视频→VLM

### B1 模型选择(#1)
- `GeneratePanel.tsx`:加模型选择器,**复用 `features/composer/ModelMenuList.tsx`**(传 `capabilityFilter`)。
  `digitalHuman.generateScript(subject, { model })` 带选中 model id。
  **后端 `/script/generate` 已接 `body.get("model")`** → `generate_script(..., model=)`(steps/script.py),前端只是没传。
- 失败信息细化:当前笼统「文案生成失败(LLM 不可用?先在模型配置里设默认 chat 模型)」
  (digital_human_routes.py:157)。保留但前端在「无可用模型」时优先引导去模型广场/模型厂商配置。

### B2 动态 capability 过滤 + 无 VLM 引导(#2)
- 未挂商品图/视频 → 模型选择器过滤 `CHAT_CAPABILITIES`(chat+vl);
- **挂了商品图/视频 → 只列 vl(VLM) 模型**;若 `/v1/models` 无 vl 模型 → 显示引导
  「去模型广场装一个图像对话(VLM/image-to-text)模型并在此选择」+ 跳 `/model-gallery` 按钮。
- vl 判定复用 ModelMenuList 现有 capability 映射(modelCapabilityChip,'vl')。

### B3 后端多模态文案(#2)
- `digital_human_routes.py` `/script/generate`:入参增可选 `product_ref` + 沿用 `model`。
- `steps/script.py generate_script`:有 `product_ref` 时,服务端从 `dh_products_dir` 读文件:
  - 图片 → 直接作图像;
  - **视频 → ffmpeg 抽 3-4 帧**(复用现有 ffmpeg;scriptFromVideo 已用 ffmpeg 抽音,这里抽帧) → 多图;
  - 构造多模态 message(`HumanMessage(content=[{type:text,...},{type:image_url,image_url:{url:data:...base64}}])`)
    + 主题提示 → `get_ChatOpenAI(model)`(底层支持多模态) → 文案。
  - 无 product_ref → 现有纯文本路径(带 model)。
- 选了非 vl 模型却传图 / VLM 不可用 → 明确错误(引导配 VLM),不再只笼统「LLM 不可用」。

### B4 商品上传支持视频(#3)
- `GeneratePanel.tsx` 上传 `accept="image/*,video/*"`。
- 后端 `/products`(digital_human_routes.py:198):扩展名白名单加视频(.mp4/.mov/.webm/.mkv 等),保存逻辑不变。

---

## Part C:每角色脚本模型(同框/分段)

### C1 脚本输入模型(GeneratePanel,按模式)
- single:一个 textarea → `script`(不变)。
- **coframe(#6)**:每角色一个独立 textarea(标题=昵称),N 个 → `role_scripts: string[]`(一角色一串)。
- **sequential(#7)**:按角色分组(组标题=昵称 + 「添加一段」按钮,组内可多段)→ 前端拼成有序
  `role_segments: Array<{role_index:number, text:string}>`(**按段序在各角色组间轮流**排:
  A段1→B段1→A段2…,缺段角色跳过)。排序策略在前端,后端按给定顺序播。

### C2 后端契约(schemas.py DhGenerateRequest)
- `script: Optional[str]`(single,不变)。
- `role_scripts: Optional[List[str]]`(**改由 coframe 用**,一角色一串)。
- 新增 `role_segments: Optional[List[Dict]]`(sequential 用,`[{role_index,text}]` 有序)。
- 向后兼容:字段都可选;旧 sequential 若仍发 role_scripts,plan 兜底当作每角色一段。

### C3 script_router.plan 重写
- single:`script` → 1 unit(role 0)。
- **coframe**:每角色 `role_scripts[i]` 用 `_split_string_by_punctuations` 切句 → **按句序轮流交织**
  (for k: for role i: 若 role i 有第 k 句 → unit(role i, 句k)),每 unit 用该角色音色。
- **sequential**:`role_segments` 顺序 → 每段一 unit(role_index 指定角色音色),按列表序。
- 纯函数,改单测(coframe 交织顺序、sequential 顺序、缺段跳过、向后兼容 role_scripts 兜底)。

### C4 jobs.py + compose
- `_gen_slot_clips` 接 `role_scripts`(coframe)/`role_segments`(sequential),传给 plan。
- compose 复用:coframe → `render_coframe_turntaking`;sequential → `render_sequential`。基本不动。

---

## 错误处理
- 文案生成:无可用模型/VLM → 明确引导(去模型广场/模型厂商),非笼统报错。
- VLM 多模态调用失败(模型不支持 vision/超时)→ 回传可读错误,前端提示换 vl 模型。
- 视频抽帧失败 → 回退用首帧或纯主题文本,提示。
- 脚本为空(某模式没填)→ 保存/生成前前端校验提示,后端 plan 跳过空 unit。

## 测试
- 后端单测(py312,纯函数):`script_router.plan` 三模式(coframe 交织、sequential 有序多段、单形象、
  缺段跳过、role_scripts 向后兼容);商品视频抽帧函数(mock ffmpeg);多模态 message 构造。
- 前端:`pnpm -r typecheck`;PresetEditor canSave 昵称必填逻辑。
- 集成冒烟(用户 py312+重建):①选模型生成文案 ②挂商品图+选 VLM 生成 ③挂视频商品生成
  ④同框每角色填脚本→生成看交织 ⑤分段每角色多段→生成看轮流 ⑥缺昵称存不了 ⑦字幕角色名显示昵称。

## 实施约束
- root→sudo;分支 main;沙箱 py3.6 只 py_compile/ast,前端无 toolchain;真验证靠用户。
- 真复用硬规则:ModelMenuList(选模型)、ffmpeg(抽帧)、get_ChatOpenAI(多模态)、
  render_coframe_turntaking/render_sequential(合成)、`/model-gallery`(引导)。
- C 部分改 R4 台词模型,改前重读 script_router/compose 现状,保单测覆盖向后兼容。

## 分期(writing-plans 细化)
- P1 Part A(命名必填 + 显示名称)——小、低风险、先做。
- P2 Part C(脚本模型重写 + plan 单测)——后端纯函数为主,可独立验。
- P3 Part B(选模型 + 多模态 VLM + 视频抽帧 + 商品视频上传)——跨前后端,依赖模型广场 VLM。
- 前端脚本输入 UI(C1)与 Part B 的 GeneratePanel 改动同处文件,计划里注意协调。

## 未做(YAGNI)
- 商品图在生成视频里做贴图合成(当前商品仅用于文案生成的视觉输入,不入画面合成)。
- 多模态对话的流式输出(文案生成一次性返回即可)。
