# 视频生成「完成最后配置」弹框(MaterialsBgmOutputDialog)重设计 — Design

**日期**:2026-05-29
**范围**:chayuan-client(弹框 UI)+ chayuan-server(素材/BGM 后端)
**前置**:`2026-05-28-video-generation-chat-redesign`(对话模式 + toolbar 已落地)

---

## 1. 背景与问题

对话模式视频生成的「完成最后配置」弹框(`MaterialsBgmOutputDialog`)目前由三段组成:
`MaterialsSection` + `BgmSection` + `OutputSection`。用户报了 7 个问题:

1. 弹框里**重复**配置在线源 API Key —— toolbar 的「素材设置」已经有了。
2. 选了「在线搜索」却没真从 pexels 搜,退回本地素材。
3. 「我的素材」区无缩略图、无预览、无删除按钮(只有 `(无缩略图)` 占位)。
4. 背景音乐没从原项目 `chayuan-video-generation` 移植(`vendor/bundled_bgm/` 只有空 `.gitkeep`)。
5. 弹框里**重复**配置字幕样式 + 渲染参数 —— toolbar 已经有了。
6. 布局/功能/界面美观需全方位优化。
7. 需支持「从一个链接提取多个视频或图像」。

### 原项目素材搜索机制(深度对比结论)

上游 `chayuan-video-generation`(MoneyPrinterTurbo 1.2.7)的素材搜索链路:

```
task.py:267  if params.video_source != "local":              # 仅在线源才生成 terms
task.py:269    video_terms = generate_terms(task_id, params, video_script)
  └─ llm.py:529  generate_terms(video_subject, video_script, amount=5)
        prompt 强制:1-3 词/项、含主主题、"reply with english search terms only"
        → JSON array,如 ["city night","urban skyline",...]
task.py:164  get_video_materials:
        video_source=="local" → preprocess_video(本地素材)
        否则 → material.download_videos(search_terms=video_terms, source=...)
materials.py:264  逐 term 调 search_videos_pexels/pixabay → 去重 → 下载到累计时长够
```

**关键事实**:Pexels/Pixabay stock 库是**英文标签**索引的,中文 query 命中率近 0。
上游用 LLM 把中文主题翻成英文关键词再搜,这是搜得到素材的根本原因。

**本项目两条搜索路径的现状**:

| 路径 | 入口 | term 来源 | 状态 |
|---|---|---|---|
| A. 全自动合成下载 | 提交生成 → `runner.py:167` | `_script_step.generate_terms`(LLM 英文化) | ✅ 已修对(e6e252d) |
| B. 交互式在线搜索 | 弹框「在线搜索」框 → `/materials/search?q=` | **用户原始输入,未英文化** | ⚠️ 中文输入搜不到 |

附带修复:`_config_shim._VgConfig` 缺 `proxy` 属性导致 `/materials/search` 500 —— 已补
`proxy` property(默认 None,`requests` 回退环境变量代理;可选 `CHAYUAN_VG_HTTP_PROXY`)。

---

## 2. 设计目标

把弹框从「三段含大量重复配置」收敛为「素材 + BGM 两段」,素材区做成三 tab
(我的素材 / 在线搜索 / 从链接),补齐缩略图/预览/删除,在线搜索自动英文化,
新增网页多媒体抓取,BGM 从上游移植(转码压缩)。toolbar 已有的设置一律不在弹框重复。

---

## 3. 弹框整体结构

```
完成最后配置                                       [×]
┌───────────────────────────────────────────────────┐
│ ① 素材                                             │
│   来源 tab: [我的素材] [在线搜索] [从链接]          │
│   ┌──────────────────────────────────────────────┐ │
│   │ (按选中 tab 切内容区,见 §4)                  │ │
│   └──────────────────────────────────────────────┘ │
│   已选 N 个 · 预计可覆盖 ~Xs   ← 实时汇总条          │
│───────────────────────────────────────────────────│
│ ② 背景音乐                                          │
│   ○ 无   ○ 随机   ○ 指定 [下拉▾] [▶试听] [上传]     │
│───────────────────────────────────────────────────│
│                            [取消]   [✨ 提交生成]   │
└───────────────────────────────────────────────────┘
```

**删除项**(全部已在 toolbar):
- 在线源 API Key 配置块(原 `MaterialsSection` 内)
- 字幕样式 + 渲染参数(整个 `OutputSection`)

提交栏固定在弹框底部。提交时把已选素材(本地 material_id 列表 / 在线已下载路径)
写入 `vgComposer.params.video_materials` + `video_source`,以及 BGM 选择。

---

## 4. 素材区(三 tab)

### Tab 1「我的素材」— 卡片 grid

- 复用现有 `GET /api/v1/video-generation/materials/{id}/file` endpoint 取媒体。
- 每张卡:
  - **缩略图**:图像直接 `<img>`;视频用 `<video preload=metadata>` 首帧;音频用波形/音符图标。
  - 角标:类型(图/视/音)+ 时长(若有)。
  - hover/常驻:[预览] [🗑 删除] + 选中态勾选框。
- **预览**:视频/音频内嵌播放;图像 lightbox 大图。
- **删除**:调 `DELETE /materials/{id}?drop_file=true`,经 `confirmDialog`(Tauri 禁用原生 confirm)。
- 选中 → 累加进底部汇总条 + `video_materials`。

### Tab 2「在线搜索」(pexels / pixabay)

- 输入框 + 源选择(pexels/pixabay)+ 搜索按钮。
- **自动英文化**(决策:复用 `generate_terms`):
  - 用户输入(任意语言)→ 后端用 `generate_terms` 取英文关键词 → 调 `/materials/search`。
  - UI 回显「已转换为英文:`<英文词>`」让用户可见。
- 结果 grid:缩略图(pexels 返回的预览图)+ 时长 + [加入素材库] 按钮。
- [加入素材库] → 下载落地到 `storage_dir("materials")` + `create_material(tags=["online",source])`,
  随后该项也出现在 Tab 1。

### Tab 3「从链接」(决策:网页媒体抓取 + 视频平台)

- 粘 URL → 调新 endpoint `GET /materials/extract-media?url=` →
  返回该页**所有可提取媒体**列表:
  - 网页:解析 `<img>` / `<video>` / `<source>` / `og:image` / `og:video` → 媒体 URL + kind。
  - 视频平台(YouTube/B站等):走已有 `sources/ytdlp_source.py` 探测(可含 playlist 多条)。
- 列表 grid:缩略图 + 类型(图/视频)+ 勾选框。
- [批量加入素材库] → 逐项下载落地 + `create_material(tags=["url",host])`。

---

## 5. BGM 区(从上游移植)

- **seed**:新脚本 `scripts/seed_bgm.py` 把上游 `resource/songs/*.mp3`(29 首/56MB)
  **转码为 96kbps mp3**(决策:全部但压缩,目标 ~20MB)落 `vendor/bundled_bgm/`。
  - 转码用 ffmpeg(项目已带);ffmpeg 不可用时回退直接拷贝并打印告警。
- `list_bgm`(已存在)扫 `vendor/bundled_bgm/` + 用户上传目录 → 下拉自动有内容。
- **试听**:确认/补 `GET /bgm/{name}/file`(FileResponse inline),前端内嵌 `<audio>`。
- **上传**:用户自带 BGM(已有上传 endpoint 则复用,否则补)。
- `bgm_type`:`none` / `random`(后端从可用 BGM 随机) / `file`(下拉选定一首)。

---

## 6. 后端改动清单

1. **`_config_shim`**:补 `proxy` property(已完成,本次附带修复)。
2. **网页媒体抓取**:`url_extractor.py` 加 `extract_media(url) -> list[{kind,url,thumb,title}]`
   (HTML 解析 img/video/source/og + yt-dlp 探测);新 endpoint
   `GET /materials/extract-media?url=`。
3. **在线搜索英文化**:`GET /materials/search` 加 `auto_translate: bool = True`,
   内部对非 ASCII / 含中文的 query 走 `_script_step.generate_terms(q, q, amount=1)`
   取首个英文词;返回里带 `translated_query` 供 UI 回显。
4. **BGM 试听**:确认 `GET /bgm/{name}/file` 存在,缺则补 FileResponse(inline)。
5. **BGM seed**:新 `scripts/seed_bgm.py`(ffmpeg 转码 96kbps)。
6. **批量加入素材库**:在线搜索 / 链接抽取的结果下载落地复用现有
   `materials_store.create_material` + `_persist_online_materials` 模式。

---

## 7. 前端改动清单

- `MaterialsBgmOutputDialog.tsx`:三段 → 两段(删 `OutputSection` 引用)。
- `MaterialsSection`(或重写为 `MaterialsTabs`):三 tab(我的素材 / 在线搜索 / 从链接),
  删在线源 key 输入块。
- 新增 `MaterialCard`(缩略图/预览/删除/选中)复用组件,Tab 1/2/3 共用。
- 在线搜索结果 + 链接抽取结果共用同一 `MediaResultGrid`。
- BGM:`BgmSection` 加试听 `<audio>` + 上传。
- `OutputSection`:从弹框移除(字幕/渲染已在 toolbar);组件本身保留以防 wizard 模式仍用,
  或确认 wizard 模式不再引用后删除。

---

## 8. 数据流

```
弹框提交
  → vgComposer.patchParams({
       video_materials: [已选本地 material 文件路径 / 已下载在线路径],
       video_source: 'local'(已下载素材统一当本地用) | 'pexels' | ...,
       bgm_type, bgm_file,
    })
  → 触发「去生成」→ runner 按 params 合成
```

注:在线搜索 / 链接抽取的素材**下载后即落本地素材库**,提交时统一以本地路径进
`video_materials`,`video_source` 仍可保留来源标记用于诊断。全自动下载路径(A)不受影响。

---

## 9. 不做(YAGNI)

- 不在弹框重复 toolbar 已有的任何设置(语音/字幕/画幅/在线源 key)。
- 不做素材编辑(裁剪/调序)——超出本次范围。
- 不做链接抽取的登录态/反爬绕过——仅公开可直取媒体。
- BGM 不做在线曲库,仅 bundled + 用户上传。

---

## 10. 验证

- 后端:`py_compile` 改动文件 + 针对 `extract_media` / 英文化 / bgm 列表加单测。
- 前端:`pnpm --filter @chayuan/app typecheck`。
- 手动:三 tab 切换、缩略图/预览/删除、中文在线搜索回显英文并出结果、
  链接抽取多媒体勾选入库、BGM 试听 + 随机/指定。
