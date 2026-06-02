# 数字人生成 → 高级合成(时间轴) — 设计

> 状态:设计已与用户逐节确认(2026-06-02)。下一步 writing-plans。
> 仓库 /work/chayuan-desktop(root,sudo)。分支 main→origin/main。沙箱 py3.6 跑不了测试→靠用户 py312+重建。
> 依赖:已有 timeline_bridge / to-timeline / DhProgressCard「在时间轴编辑」雏形;VG 时间轴(TimelineTrack/SrtCue/PIP)、materials_store、compose_multi。

## 目标
数字人生成结果加「去编辑合成」按钮 → 进入 VG 时间轴编辑器,按合成模式建不同轨道:
single=视频轨+字幕轨;coframe=主轨(空)+每角色一轨(PIP)+合并字幕;sequential=主轨(空)+每角色一轨(全屏)+合并字幕。

## 已确认决策
1. 同框 = **主轨(空) + 每角色一轨**(PIP 按各角色 x/y/scale 定位)→ 需后端导出各角色素材。
2. 多人字幕 = **一条合并字幕轨**(按说话时间顺序,可加「昵称: 」前缀)。
3. 角色轨内容 = **只放该角色说话片段**(复用已生成 seg,放各自累计时间偏移,其余时段空可手动延展)。

## 已核实现状
- VG 模型 `.../video_generation/schemas.py`:`Timeline{version,duration_ms,tracks[]}`、`TimelineTrack{id,kind(video/audio/subtitle),clips[],cues[],removable,label}`、`TimelineClip{id,source{material_id|path|url},track_start_ms,in_ms,out_ms,transition,volume,x,y,scale,z}`、`SrtCue{index,start_ms,end_ms,text}`。前端 `packages/api/src/videoGeneration.ts` `Vg*` 对应。
- `.../digital_human/timeline_bridge.py`:`build_cues_from_script(script,total_ms)`、`build_timeline(video_path,cues,total_ms)`(现仅单视频轨+字幕轨,不分模式)。
- `.../api_server/digital_human_routes.py` `POST /tasks/{tid}/to-timeline`:注册成片 material + build_timeline,返 `{material,timeline}`。
- `.../digital_human/jobs.py` `_gen_slot_clips`→`(clips=seg{i}.mp4, unit_roles)`;coframe→render_coframe_turntaking、sequential→render_sequential;seg 留 task_dir(td)**未清理**、未注册、无元数据。
- `store/materials.py` `create_material(*,source,name,path,owner_id,mime,size,duration_ms,width,height,thumbnail_path,tags)`。
- VG 渲染 `steps/compose.py`:主轨(track0) concat;其余轨按 x/y/scale/z 做 PIP 叠加(主轨空+叠加轨=同框合成)。
- 前端 `VgTimelineEditorPage.tsx`(多轨/PIP/加删轨/字幕/素材拖拽,`params.timeline` 优先渲染);`DhProgressCard.tsx`(taskToTimeline→patchParams({timeline})→导航 /video-generation/timeline);`store/vgComposer.ts`。

---

## ① 产物导出 + 数据流(关键新增)
- **jobs.py 记录分段元数据**:coframe/sequential 生成时,把每段记成 `segments: List[{role_index:int, path:str, text:str, duration_ms:int}]`(text=该 unit 台词;duration_ms=ffprobe seg 或合成时已知),写进 `DhTaskStatus`(新增 `segments` 字段,持久化 tasks.json)。single 不产生 segments(用整片)。td 不清理,seg 路径稳定。
- **to-timeline 路由**:
  - 仍注册最终成片为 material(保留)。
  - **新增**:对每个 segment `create_material(source="digital_human_role", path=seg.path, duration_ms=seg.duration_ms, tags=[f"dh_task_{tid}", f"role_{seg.role_index}"], mime="video/mp4", ...)` → material_id。
  - 调 `build_timeline_for_mode(mode, result_material_id, segments_with_material_ids, slots, total_ms, script)`(见②)。
  - 返回 `{ materials: [成片+各段], timeline }`。

## ② 模式相关建轨(timeline_bridge)
新增 `build_timeline_for_mode(mode, *, result_material_id, result_path, segments, slots, total_ms, script)` → Timeline:
- **single**:video 轨 `dh-video`(removable=False,label「数字人」,1 clip source={material_id:成片,path:result_path}) + subtitle 轨 `dh-subtitle`(`build_cues_from_script(script,total_ms)`)。
- **coframe**:主视频轨 `dh-main`(kind=video,removable=False,label「主轨(背景)」,**clips=[]**) + 每角色轨 `dh-role-{i}`(removable=True,label=昵称,clips=该角色 seg 放累计偏移,source={material_id,path} 双写,带 **PIP** x/y/scale(取该角色位置,沿用 render_coframe_turntaking 的 positions)、z=i+1) + 合并字幕轨。
- **sequential**:主视频轨 `dh-main` 空 + 每角色轨(clips 放累计偏移,**全屏** x=0/y=0/scale=1) + 合并字幕轨。
- **累计偏移 & 合并字幕**(coframe/sequential 共用):segments 已是全局播放序,`cumOffset[k]=Σ dur[0..k-1]`;seg k → 其 role 轨 track_start_ms=cumOffset[k]、时长 dur[k];字幕逐 seg `SrtCue(index, start=cumOffset[k], end=cumOffset[k]+dur[k], text=(昵称+': ')?+seg.text)` 进**一条** `dh-subtitle`(removable=True)。比 build_cues_from_script 更准(用每段真实时长)。

## ③ 前端「去编辑合成」+ 编辑器消费(改动小)
- **按钮**:DhProgressCard 任务完成态「在时间轴编辑」**改名/明确为「去编辑合成」**;逻辑不变(taskToTimeline→patchParams→导航)。
- **taskToTimeline 客户端**:返回从 `{material,timeline}` 改 `{materials:[...],timeline}`;前端 ① `patchParams({timeline:r.timeline})`;② **invalidate VG 素材库 query**,让编辑器把 clip 的 material_id 解析到刚注册的各段素材文件。
- **编辑器消费**:无需大改——`VgTimelineEditorPage` `params.timeline` 优先渲染,多视频轨/空主轨/PIP/合并字幕/加删轨都已支持。
- **clip source 双写** `{material_id, path}`:material 解析不到时 path 兜底。

## 错误处理(兜底不崩,向后兼容)
- 无 segments(single/旧任务/seg 被清) → 退回**现有单片逻辑**(成片视频轨+build_cues_from_script),不报错。
- seg ffprobe 失败 → 用合成记录时长兜底,再不行跳过该 clip。
- seg create_material 失败 → 跳过该段(或整体退回单片),日志告警。
- coframe 位置缺 → `_resolve_positions` 默认布局兜底。
- 空脚本/cues → 空字幕轨。

## 测试
- 后端单测(纯函数,py312):`build_timeline_for_mode` 喂构造 segments(role_index/text/duration_ms)+slots →
  single=video+subtitle;coframe=主轨空+N 角色轨(PIP+累计偏移)+1 subtitle;sequential=主轨空+N 角色轨(全屏)+1 subtitle;断言累计偏移、合并 cue 顺序/文本(昵称前缀)、缺 segments 退回单片。
- jobs:mock engine/synth,断言完成态 `DhTaskStatus.segments` 被填充。
- 前端:`pnpm -r typecheck`;taskToTimeline 返回 `{materials[],timeline}` 类型。
- 集成冒烟(用户 py312+重建):single→去编辑合成→视频+字幕轨;coframe→主轨空+每角色 PIP 轨+字幕;sequential→每角色轨+字幕;编辑器调位置/删轨/渲染出片。

## 实施约束
- root→sudo;分支 main;沙箱 py3.6 只 ast/py_compile,前端 toolchain 有时可用;真验证靠用户。
- 真复用硬规则:VG Timeline/TimelineTrack/SrtCue、materials_store.create_material、build_cues_from_script、VG 编辑器多轨/PIP 渲染、render_coframe_turntaking 的 positions、DhProgressCard 现有导航。

## 分期(writing-plans 细化)
- P1 jobs 记录 segments 元数据(+ DhTaskStatus.segments 字段)。
- P2 timeline_bridge `build_timeline_for_mode` 三模式建轨 + 合并 cue(纯函数单测)。
- P3 to-timeline 路由:注册各段 material + 调 build_timeline_for_mode + 返 materials[]。
- P4 前端:taskToTimeline 类型改 materials[]、按钮改名、invalidate 素材库。

## 未做(YAGNI)
- 同框「全程待机可见」(每角色全长轨)——本期只放说话片段,需要再说。
- 每角色独立字幕轨/样式。
- 商品图/背景自动铺到空主轨(用户手动加)。
