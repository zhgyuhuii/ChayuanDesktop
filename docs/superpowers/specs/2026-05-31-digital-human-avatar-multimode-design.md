# 数字人「形象」管理与多形象合成 — 设计 spec

- 日期：2026-05-31
- 状态：已通过设计评审，待 spec review → 写实现计划
- 涉及：`chayuan-client`(apps/web React) + `chayuan-server`(FastAPI)
- 入口组件：`chayuan-client/packages/app/src/features/digital-human/PresetEditor.tsx`
- 后端核心：`chayuan-server/.../video_generation/digital_human/{schemas,store,jobs,compose,engine}.py`、`api_server/digital_human_routes.py`

## 1. 背景与目标

当前数字人「形象」管理有三个痛点 + 一组新需求：

1. 形象 tile 只渲染文件名文字（`PresetEditor.tsx` 的 `{a.name}`），用户看到「一串地址」而非图像。
2. 没有删除入口（后端 `DELETE /avatars/{name}` 与前端 `dhDeleteAvatar` 已存在，仅缺 UI）。
3. 不能替换（重新上传覆盖某个形象）。
4. 多形象使用与合成：要支持「多人同框」「分段轮流」「同一人多照合一个驱动形象」，且让用户在使用时选模式。

架构方向（已定）：**方案 B —— 扩展预设本身持有多形象 + 合成模式**；面板提供简单版一键合成，复杂编排「高级」跳现有视频生成时间轴。

复用基线：生成主链 `jobs._run_pipeline` 已有「合成音频 → 引擎生单人片段 → `render_from_edl`/moviepy PIP 合成」；`compose.py` 已用 `TimelineClip + render_from_edl`。同框/分段/多照合一全部在此之上扩展，**不新增渲染引擎**。

## 2. 数据模型（向后兼容扩展 `DigitalHumanPreset`）

新增字段（`schemas.py`），老 `presets.json` 行靠默认值照常解析：

```
class AvatarSlot(BaseModel):
    ref: str
    kind: AvatarKind            # image | video
    label: str = ""             # 可选显示名/角色名
    lines: str = ""             # 该形象的台词(同框/分段用;空=用全局 text)

class DigitalHumanPreset(BaseModel):
    ...原有字段保留(avatar_ref / avatar_kind 不删)...
    avatars: List[AvatarSlot] = []          # 空=回退到单形象 avatar_ref
    compose_mode: Literal["single","coframe","sequential"] = "single"
    layout: Literal["side","pip","main_minor"] = "side"   # 仅 coframe 用
```

兼容规则：
- **load**：若 `avatars` 为空，合成 `[AvatarSlot(ref=avatar_ref, kind=avatar_kind)]`。
- **save**：把 `avatars[0]` 镜像回 `avatar_ref/avatar_kind`，老代码/老数据零破坏。
- `store.create_preset/update_preset` 增加 `avatars/compose_mode/layout` 透传；`update_preset` 仍禁改 `id/created`。

**台词取舍（已定 ②）**：同框/分段时**每个形象各自台词**（`AvatarSlot.lines`）。同框=多路音频混音；分段=按段对应。`lines` 为空时回退到全局 `text`（也即"全员共用"仍可用）。

## 3. 前端 UI（`PresetEditor.tsx`）

- **缩略图替换文字**：image → `<img src={dhAvatarFileUrl(ref)}>`；video → `<video muted preload="metadata">`（取首帧）。选中高亮保留。失败显示占位图标（不再退回文字地址）。
- **删除**：user 来源 tile 角标 ×，调 `dhDeleteAvatar`，删后 `invalidateQueries(['dh.avatars'])`；bundled 不可删。删的是当前选中项则清空 `avatarRef`。
- **替换**：选中 tile 提供「替换」= 上传新文件 + 删旧 ref（二次确认走项目 `confirmDialog`，不用 `window.confirm`）。
- **模式切换**（单形象 / 同框 / 分段）：
  - 同框：多选 2–3 形象 + 选 layout（并排/画中画/主+角）+ 每形象台词框。
  - 分段：可排序的 (形象 + 该段文本) 列表。
- **多照合一**：上传支持多选同一人多张照片 + 勾「合成参考图」→ 后端挑最佳单帧，UI 注明「单图驱动近似」。
- **高级**按钮：当前形象/片段 `ingest_material` 进视频时间轴并跳转，做复杂编排。
- 拖放/弹框遵循项目约定：drop 区 `preventDefault`、用 `promptDialog/confirmDialog`，不用 `window.*`。

## 4. 后端生成（`jobs._run_pipeline` 按 `compose_mode` 分派）

- `single`：现状不变。
- `coframe`：每个 `AvatarSlot` 用其 `lines`(或全局 text) 合成音频→引擎生 presenter 片段→`render_from_edl` 多条 video 轨按 `layout` 做 PIP 合成；多路音频混音为成片音轨。把 `build_presenter_edl` 泛化为「多 presenter 轨」生成器。
- `sequential`：按 (形象,段文本) 顺序各生片段→`render_from_edl` 顺序 `track_start_ms` 拼接，音频顺序拼接。
- 进度：把 30→100 段按子任务数等分上报。
- `submit/_PENDING` 增加 `compose_mode/avatars/layout` 透传；`DhGenerateRequest` 可加可选 `compose_mode` 覆盖（默认取 preset 的）。

## 5. 多照合一（选项 4，受引擎约束）

引擎事实：`wav2lip/sadtalker/musetalk` 的 `generate(*, avatar_path, ...)` 均**单图/单源**，无多参考身份建模。

实现：新增 `build_reference_image(paths:list[str]) -> str`——人脸检测打分挑最正/最清晰一帧（或对齐后选一张），仍按**单图**喂引擎。上传"合成参考图"时调用，产出一个普通 `user:` 形象。

**真·多参考身份建模**（学习式 identity）需换新引擎(GPU/重依赖)：**本期不做，仅留 `build_reference_image` 接口与 UI 文案**。

## 6. 错误处理

- 同框某路失败 → 退回首个形象单人片段 + 明确提示（不整体失败）。
- 分段某段失败 → 该段占位/跳过并在结果里标注。
- 形象文件缺失 → 明确 `RuntimeError`（不静默）。
- `sadtalker/musetalk` 仅 GPU：不可用时返回明确错误文案，前端不"永远转圈"。
- `build_reference_image` 没检到人脸 → 回退用第一张原图 + 提示。

## 7. 测试（扩 `tests/unit_tests/test_digital_human_*`）

- store：老预设行(无 avatars/compose_mode) 向后兼容解析；save 后 `avatar_ref` 与 `avatars[0]` 一致。
- compose：多 presenter 轨 EDL 结构正确；分段顺序 `track_start_ms` 正确。
- jobs：`compose_mode` 分派到对应分支（用 fake engine + run_sync）。
- `build_reference_image`：多图选帧、无脸回退。
- routes：create/update 预设接收并回读新字段；上传多图合成。

## 8. 实现顺序（里程碑）

- **M1**：缩略图 + 删除 + 替换（纯前端，低风险，先解最烦的痛点）。
- **M2**：数据模型扩展 + 向后兼容（schemas/store + routes 透传 + 前端类型）。
- **M3**：同框（coframe）后端 + UI。
- **M4**：分段（sequential）后端 + UI。
- **M5**：多照合一（build_reference_image + 上传 UI）。
- **M6**：时间轴桥接（ingest_material + 跳转）。

## 9. 非目标（YAGNI）

- 不引入新驱动引擎（不做学习式多参考身份）。
- 不在数字人面板内重造时间轴级编排（复杂编排一律跳现有时间轴）。
- 不动现有单形象预设的既有行为与数据。
