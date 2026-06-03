# 数字人工作台(DhStudio)重设计:三区布局 + 画布可交互 + 任务列表(删/下载/去编辑)

- 日期:2026-06-03
- 状态:已通过 brainstorming,待用户复审
- 影响:`chayuan-client`(DhStudio/CanvasStage/任务列表/API)、`chayuan-server`(删除任务路由 + 商品图按坐标摆位)

## 1. 背景

当前 DhStudio = 左预览(CanvasStage,readOnly)+ 右设置(GeneratePanel,内含任务列表),无可拖拽分隔,画布不可编辑,商品图仅作后端参数无可视化,任务无删除。用户要求重设计成「左设置 / 右预览 / 中间可拖拽 / 底部全宽任务列表」并让画布可拖拽数字人+商品图。

## 2. 目标(逐条)

1. **左右互换**:左=设置(GeneratePanel 主体),右=预览(CanvasStage)。
2. **可拖拽分隔条**:上区两栏中间,拖拽调宽,复用 `useLaneResizer`(纯 pointer,无新依赖),宽度本地持久。
3. **底部全宽任务列表**:横跨两栏;每条 缩略图/状态 + 下载 + **删除(新)** + 去编辑合成(已有);从 GeneratePanel 内移出到底部区。
4. **生成乐观插入**:点「生成」立即在列表插入一条"正在生成"条目,不等 3s 轮询。
5. **画布数字人可拖拽缩放**:解锁 CanvasStage `readOnly`;写 `AvatarSlot.x/y/scale`,松手 `updatePreset` 持久化(复用 PresetEditor onChange 逻辑)。
6. **画布商品图/视频可拖拽缩放**:CanvasStage 新增商品图层;新增 `product_x/y/scale` 字段持久化;**后端合成按归一坐标摆位**,取代现有 corner/bg/side template。
7. **下载/去编辑合成**:已实现(`DhProgressCard` 的 `<a download>` + `taskToTimeline`),搬进底部列表复用。

## 3. 非目标
- 长文案单形象后半段嘴不动 = 独立 Wav2Lip bug,走 systematic-debugging,不在本 spec。
- 不重写 GeneratePanel 的文案/AI 生成/引擎逻辑,仅把"任务列表"移出 + 布局重排。
- 不改 `taskToTimeline`/`timeline_bridge`(已完善)。

## 4. 现状事实(已探索)
- `DhStudio.tsx`:左 CanvasStage(`readOnly`)+ 右 GeneratePanel(`w-[380px]`)。
- 任务列表在 `GeneratePanel`(:800-808),`useQuery(['dh.tasks'], refetchInterval:3000)`,渲染 `DhProgressCard`(含下载 `taskFileUrl` + 去编辑合成 `taskToTimeline`)。
- 无删除:前端无 `dhDeleteTask`,后端无 `DELETE /tasks/{tid}`;VG 有现成模式(`vgDeleteTask` + `DELETE /api/v1/video-generation/tasks/{id}`)。
- `CanvasStage`:`{width,height,roles,onChange,readOnly}`,拖拽/缩放写 `x/y/scale`(归一);PresetEditor 用它编辑并 `updatePreset` 持久化;**不渲染商品图层**。
- 商品图:`GeneratePanel` 上传得 `productRef`,生成时传 `product_image+template+matte`;preset/schema **无 product_x/y/scale**。
- 可复用:`model-arena/useLaneDnD.ts:useLaneResizer`(拖拽调宽,纯 pointer)。

## 5. 设计

### 5.1 DhStudio 三区布局
```
flex flex-col:
  ├─ 上区 flex-row(flex-1):
  │    [设置 left, width=leftW] [拖拽分隔 8px] [预览 right, flex-1]
  └─ 下区(固定高/可滚, full width):任务列表
```
- `leftW` 用 React state + `useLaneResizer` 同款 pointer 拖拽(min 320 / max 720),存 localStorage 键 `dh.studio.leftW`。
- 左 = `<GeneratePanel embedded />`(去掉其内部任务列表,见 5.3);右 = `<CanvasStage ... readOnly={false} onChange=...>`。
- 预览仍按 5.x 比例(已修的 surface-2 背景 + ring)。

### 5.2 CanvasStage 商品图层 + studio 可编辑
- props 加可选 `product?: {ref, kind, x, y, scale}` + `onProductChange?(pos)`。
- 渲染:roles 之上叠一个商品图层(img/video by kind),用与角色同款的拖拽(move)+ 四角缩放(resize),位置/大小归一。
- studio 传 `readOnly={false}` + `onChange`(数字人)+ `onProductChange`(商品)。
- 拖拽 onChange/onProductChange → DhStudio 收集 → debounce/松手调 `updatePreset(pid, {avatars, product_x, product_y, product_scale})` 持久化。

### 5.3 任务列表移到底部全宽
- 新组件 `DhTaskList`(从 GeneratePanel 抽出任务列表 + DhProgressCard 复用),渲染在 DhStudio 下区,全宽横向网格/横滚。
- GeneratePanel 加 `embedded?:boolean` prop;embedded 时**不渲染**自带任务列表(由 DhStudio 下区统一渲染),避免两处重复。
- 每条:缩略图/状态、下载(`taskFileUrl`)、**删除**(新)、去编辑合成(`taskToTimeline`)。
- **乐观插入**:GeneratePanel `doGen` 成功拿到 task_id 后,`queryClient.setQueryData(['dh.tasks'], ...)` 立即插入该条(或 invalidate 立即 refetch),DhProgressCard 自查状态。

### 5.4 删除任务(镜像 VG)
- 后端 `digital_human_routes.py` 加 `DELETE /api/v1/digital-human/tasks/{tid}`(可选 `drop_file`),删任务记录 + 产物文件,镜像 VG 实现。
- 前端 `digitalHuman.ts` 加 `dhDeleteTask(tid, {drop_file?})`;DhTaskList 删除按钮 → 调用 + invalidate `['dh.tasks']`。

### 5.5 商品图后端按坐标摆位
- schema 加 `product_x/product_y/product_scale`(归一,默认居中/角落兼容)。
- 合成放商品图的代码(`compose`/overlay 处理 product_image 的环节)改为:有 product_x/y/scale 时按归一坐标×画幅摆放;无则回退原 template(corner/bg/side)保持兼容。
- 生成请求把 product_x/y/scale 透传(或后端从 preset 读)。

## 6. 数据流
- 画布拖拽 → AvatarSlot.x/y/scale & product_x/y/scale → updatePreset 持久化 → 生成时后端按这些坐标摆位。
- 生成 → 乐观插入任务条 → 3s 轮询/自查状态 → 完成显示下载/删除/去编辑合成。

## 7. 错误处理/兼容
- 商品图无 product_* 时回退 template,旧 preset 不破。
- 删除失败 toast,不阻断列表。
- 分隔宽度越界 clamp(320–720)。
- CanvasStage 商品图层 props 可选,PresetEditor 不传 product 时行为不变。

## 8. 测试
- 后端:`DELETE /tasks/{tid}` 单测(删记录+文件);product 摆位归一→像素单测。
- 前端:`pnpm -w typecheck`;拖拽分隔/数字人/商品、删除、乐观插入手动验。
- 沙箱无 node/py312 → ast/静态校验 + 用户机器跑;后端改动需 pull+重启 sidecar;前端 dev 热更。

## 9. 风险
- 商品图后端摆位取代 template:需找准 compose 里放 product 的环节,改坐标摆位别破坏绿幕/模板老路径(保留回退)。
- CanvasStage 解锁编辑 + 商品层:拖拽逻辑复用现有 move/resize,注意 readOnly 既有调用方(PresetEditor 仍按需)。
- DhStudio 布局重排 + 任务列表外移:GeneratePanel embedded 分支别影响 /generate tab 的独立使用。
