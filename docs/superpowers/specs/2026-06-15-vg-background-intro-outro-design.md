# VG 背景色 + 片头/片尾(全局默认+项目覆盖,付费门控)— 设计文档

- 日期:2026-06-15
- 范围:`chayuan-server`(compose 背景色 + outro.py 扩展 + 路由/默认存储)+ `chayuan-client`(参数/上传/UI/门控)
- 前置:非会员强制 `video_end.mp4` 已实现(`outro.py:maybe_append_outro` + `license.engine.is_paid_member` + VG `runner._persist_vg_videos` / DH `jobs._set`,commit 3466f860)。本设计在其上加:用户背景色 + 付费用户自定义片头/片尾。

## 决策汇总(已与用户确认)
- 背景色:全局默认 + 项目覆盖;作用于所有「空白处」(letterbox 补边 / 片段间隙 / 缩小移位片段背后 / 合成底);**人人可用**,不付费锁。
- 片头/片尾:全局默认 + 项目覆盖;用户选视频或图片;**仅付费会员可设**(`is_paid_member`)。
- 非付费:片头/片尾 UI 置灰锁定 + 升级提示;成片仍自动强制拼 `video_end.mp4`(现状)。付费:可设片头/片尾,不强制 video_end(`maybe_append_outro` 已对付费跳过)。
- 接入方式 = 方案 A:成片级 ffmpeg prepend/append,复用 outro.py 的缩放/补边/统一/拼接;**片头/片尾不进实时预览**(同 video_end),背景色进预览。

## ① 数据模型
**后端** `chayuan/server/video_generation/schemas.py` `VideoParams` 增:
```python
background_color: str = "#000000"      # 画面空白处背景色(letterbox/间隙/合成底)
intro_clip: Optional[str] = None       # 项目覆盖:片头文件名/路径(None=用全局默认)
outro_clip: Optional[str] = None       # 项目覆盖:片尾文件名/路径
```
**全局默认**:持久化 `<chayuan_root>/data/vg_output_defaults.json`:`{background_color, intro_clip, outro_clip}`。读写经新 helper `vg_output_defaults.py`(load/save,缺省 `{"background_color":"#000000","intro_clip":null,"outro_clip":null}`)。
**片头/片尾文件**:存用户资产目录(仿 BGM:`get_bgm_dir` 旁加 `get_intro_outro_dir`);列举合并(暂无 bundled,仅用户上传)。

**生效解析**(渲染入口,服务端):
```
bg     = params.background_color or global.background_color or "#000000"
paid   = is_paid_member(root, cfg, ["video","video_edit"])
intro  = (params.intro_clip or global.intro_clip) if paid else None
outro  = (params.outro_clip or global.outro_clip) if paid else None
```

## ② 后端应用
**背景色(compose.py)**:新 helper `_bg_rgb(params) -> tuple[int,int,int]`(hex→RGB,失败回退黑)。把写死的 `ColorClip(..., color=(0,0,0))` 三处(`_render_main_segment` 合成底 / 片段间隙 gap / letterbox 合成 ~914)改用 `_bg_rgb`。预览画布底色见 ③。
**片头/片尾(outro.py 扩展)**:
- 复用现有缩放/补边/统一 fps·sar·pixfmt·音频的 ffmpeg filter_complex,抽 `_concat_clip(base, extra, position, workdir, bg)`(position=head|tail)。
- 新 `maybe_prepend_intro(path, intro_file, workdir, *, bg)` 与 `append_user_outro(path, outro_file, workdir, *, bg)`;补边色用 `bg`。幂等标记 `.intro.done` / `.useroutro.done`。失败只 warning 返回原视频。
- 接入点:VG `runner._persist_vg_videos`、DH `jobs._set`(与 video_end 同处),顺序:**先 prepend intro → 再 append 用户 outro(付费) 或 video_end(非付费)**。
**服务端门控**:解析处对非付费把 intro/outro 置 None(即使前端误传);video_end 逻辑不变。

## ③ 前端
**API**(`packages/api/src/videoGeneration.ts`):`VgVideoParams` 加 `background_color/intro_clip/outro_clip`;新 `uploadIntroOutro(file,kind)` / `listIntroOutro()` / `introOutroFileUrl(name)`;`getVgOutputDefaults()` / `setVgOutputDefaults(d)`。
**UI**:输出/画幅设置区(`VgComposerToolbar` 展开区或 `BgmOutputStep` 同级)加「背景 / 片头片尾」面板:
- 背景色:`<input type="color">` + 预设色块,写 `params.background_color`(人人可用)。
- 片头 / 片尾:各一个选择器(已上传列表 + 上传按钮 + 清除);非付费整组 `disabled + opacity-50`,旁注「会员可用」点击引导升级(复用项目升级入口)。
- 全局默认:面板顶「设为默认(记住)」开关/按钮 → `setVgOutputDefaults`;项目值留空则用全局默认(UI 显示「跟随默认」)。
- 付费态:读 license status(`is_paid_member` 对应的前端判断,复用现有 license store;注意不能用含每日免费的 licensed)。
**预览**:`LivePreviewCanvas` 画布底 `bg-black` 改用 `style={{ background: bgColor }}`(从 params 传入 PreviewPlayer→canvas)。片头/片尾不渲染,面板内一行小字说明「片头/片尾在导出成片体现,预览不含」。

## ④ 文件改动清单
- 后端:`schemas.py`(3 字段)、`steps/compose.py`(`_bg_rgb` + 三处 ColorClip)、`steps/outro.py`(`_concat_clip`/`maybe_prepend_intro`/`append_user_outro`)、新 `steps/vg_output_defaults.py`、`api_server/video_generation_routes.py`(intro-outro 上传/列举/流式 + defaults GET/PUT)、`runner._persist_vg_videos` + DH `jobs._set`(解析 effective + 调用顺序)、`runtime/binaries` 加 `get_intro_outro_dir`。
- 前端:`packages/api/src/videoGeneration.ts`(类型 + 端点)、输出设置 UI 组件(背景色 + 片头片尾面板 + 门控)、`PreviewPlayer`/`LivePreviewCanvas`(背景色)、license 付费态读取接线。

## ⑤ 数据流
```
设置面板 背景色 → params.background_color(实时预览底色)
设置面板 片头/片尾(付费)→ params.intro_clip/outro_clip(或「设为默认」→ vg_output_defaults.json)
上传片头/片尾 → POST intro-outro → 存用户资产目录 → 列举刷新
渲染:runner/jobs 解析 effective(bg/intro/outro,非付费置空 intro/outro)
  → compose 用 bg 补边/合成 → outro.py prepend intro → append (付费 outro | 非付费 video_end)
```

## ⑥ 边界 / 风险
- 门控必须服务端强制(前端禁用仅 UX);非付费即使构造请求带 intro/outro 也被忽略。
- 片头/片尾与 video_end 互斥:付费用户走自定义、不拼 video_end(沿用 is_paid_member 跳过);非付费拼 video_end、无自定义。
- 幂等:三个拼接(intro/useroutro/video_end)各自 `.done` 标记,避免重复触发(成片覆盖场景)。
- 背景色 hex 解析失败回退黑;预览与成片同色(都来自 background_color)。
- 图片做片头/片尾:需给定时长(默认 3s,沿用图像 clip 约定);ffmpeg 用 loop+t 生成。
- ⚠ 后端 pytest 本机跑不了([[reference_py312_test_env]]):ast 语法自检 + 单元测(default 解析/门控置空/hex 解析),真跑 + 真机成片在构建机。

## ⑦ 验证
- 后端:`_bg_rgb` hex 解析、effective 解析(付费/非付费置空)、defaults load/save 单测(本机 ast 自检,真跑构建机)。
- 前端:tsc;背景色实时预览;非付费片头片尾置灰;付费可设 + 设为默认持久。
- 手动(重建+重启 sidecar):非付费成片自动 video_end 不变;付费设片头片尾→成片首尾正确、补边用背景色;背景色改→空白处变色。
