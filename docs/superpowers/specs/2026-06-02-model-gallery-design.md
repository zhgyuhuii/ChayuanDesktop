# 模型广场(在线模型库)设计 — Model Gallery

> 状态：设计已与用户逐节确认(2026-06-02)。下一步：writing-plans 出实现计划。
> 仓库：/work/chayuan-desktop(root 所有,提交用 sudo)。分支 main→origin/main。
> 沙箱仅 py3.6(跑不了 pytest)、无前端 toolchain → 真验证靠用户 py312 + 联网实测。

## 目标(一句话)

把「模型广场」改名为「模型厂商」,并新增一个独立的「模型广场」页面:在线检索
ModelScope / HuggingFace 官方模型库(列表式、类型过滤+搜索 AND 联合、底部页码分页、
显示参数大小与文件大小),一键调用既有下载器安装(带进度),显示已安装清单与卸载,
安装后的模型自动经 sidecar 挂载,在对应模型服务(对话/嵌入/重排/ASR/TTS/VLM/图嵌)
下拉中出现并可用。

## 范围与已定决策

1. 现「模型广场」(`/marketplace`,实为厂商配置页 ProviderCard 网格)→ 改名「模型厂商」
   (仅改 i18n 文案,页面与路由不动)。
2. 新「模型广场」数据 = **实时调各 hub 官方 JSON 接口**(HF `/api/models`、ModelScope
   模型列表 API),非本地维护目录。默认「仅可运行」过滤(只显示本地 sidecar 能跑的格式),
   可切换看全部并标灰「本地不可运行」。
3. 覆盖**全部本地 sidecar 能跑的能力**:chat / text-embedding / rerank / speech-to-text /
   text-to-audio / image-embedding / image-to-text(other 兜底)。
4. 源 tab = **ModelScope + HuggingFace + 已安装**;HuggingFace tab 内带「线路:hf-mirror
   (国内默认)/官方」切换(同一库,仅域名不同)。
5. 下载**复用现有 `chayuan-modelmgr`**(进度事件总线 + 取消 + 断点续传)与文件解析;
   安装态关联靠 `local_index`/manifest;装完经 sidecar 自动挂载 → `/v1/models`。
6. 展示形态 = **列表行**(非卡片网格);顶部类型过滤+搜索 AND 联合;底部经典页码分页。

## 架构(方案 A:归一化适配器层)

唯一新建的后端层 = **hub 目录连接器**,把各源官方 JSON 归一成统一契约给前端。
前端只认归一格式,不感知各源差异(符合项目「统一查询入口、路由文件不承载分发」原则)。

```
前端 ModelGalleryPage
  -> GET /v1/model-hub/search   (归一列表 + 安装态)
  -> GET /v1/model-hub/detail   (文件列表含大小,选 quant)
  -> POST /admin/models/install_model      [复用既有下载器 job]
  -> GET  /admin/models/install_model/{id} [复用既有轮询]
  -> POST /admin/models/uninstall          [新增]
  -> GET  /runtime/models                  [复用,已安装清单 tab]

后端 model_registry/hub_catalog/
  base.py        归一契约 NormalizedModelCard / HubFile / 统一接口
  huggingface.py adapter(HF /api/models + tree API;线路 hf-mirror/官方)
  modelscope.py  adapter(ModelScope 模型列表 + repo/files)
  capability.py  复用 identifier.py 的 pipeline_tag/task -> capability 映射
  installed.py   扫 manifest origin -> installed_repos 集合,填 card.installed
```

### 归一数据模型

```python
@dataclass
class NormalizedModelCard:
    source: str            # 'modelscope' | 'huggingface'
    model_id: str          # owner/name(各源原始 id)
    display_name: str
    owner: str
    capability: str        # chat/text-embedding/rerank/speech-to-text/
                           # text-to-audio/image-embedding/image-to-text/other
    param_size: str | None # "7B"/"0.6B";尽力解析(见下),取不到 None
    file_size_bytes: int | None  # 可下载文件总大小(详情页/懒加载填)
    format: str | None     # gguf/onnx/safetensors/ggml/...
    runnable: bool         # 本地 sidecar 能否跑(过滤依据)
    downloads: int
    likes: int
    updated_at: str | None
    tags: list[str]
    installed: bool        # local_index/manifest 交叉比对填充

@dataclass
class HubFile:
    rfilename: str
    size_bytes: int | None
    runnable: bool         # 该文件是否本地可跑(如 .gguf)
```

### 字段来源(诚实说明)

- **capability**:HF 用 `pipeline_tag`(text-generation→chat、feature-extraction/
  sentence-similarity→text-embedding、automatic-speech-recognition→speech-to-text、
  text-to-speech→text-to-audio、image-feature-extraction→image-embedding、
  image-to-text/visual-question-answering→image-to-text);ModelScope 用 `Tasks`。
  两者映射到现有能力枚举,**复用 `identifier.py` 的映射表**,扩不足项。
- **file_size_bytes**:准确。HF `GET /api/models/{id}/tree/main?recursive=true`(每文件
  `size`/`lfs.size`);ModelScope `/api/v1/models/{owner}/{name}/repo/files`(`Size`)。
  列表页懒加载(行展开/安装时再取详情)以省请求。
- **param_size**:尽力而为。优先 HF `modelInfo.safetensors.total`;否则从 model 名正则
  解析(`\d+(\.\d+)?\s*[BbMm]`);解析不到显示 `—`。不保证 100%。
- **format/runnable**:HF `filter=gguf` 或 tag 判定;runnable = GGUF(chat/embedding/
  rerank/TTS via llama-server/sherpa)、onnx(部分 TTS/embedding)、whisper ggml(ASR)等。
  默认只留 runnable=true。
- **分页**:adapter 内部归一成 `{page, page_size, total?}`。ModelScope 原生页码;
  HF 是 limit/offset,用累计 offset 模拟「跳第 N 页」。

## 安装态关联 + 卸载

- **provenance**:下载器写的 `.chayuan-manifest.json` **增加 `origin:{source,repo_id}`**。
  后端扫所有 manifest 得 `installed_repos` 集合,`search` 返回时精确置 `card.installed`。
  无 origin 的老模型回退用 `repo_id.replace('/','--')` 匹配目录名兜底。
- **安装进度**:复用 `/admin/models/install_model` job + 轮询;done 后自动 scan_and_mount
  → installed=true + 经 sidecar 进 `/v1/models`。
- **卸载**(新增 `POST /admin/models/uninstall`,入参 source+repo_id 或 local model_id):
  1. confirmDialog 确认(显示将释放磁盘大小)。
  2. 删 `local_index` 记录的**真实 path**(不反推)。
  3. 重扫 local_index → SSE 增量 → 前端回「未安装」。
  4. 从各 platform enabled 模型移除 → `/v1/models` 不再列。
- **边界**:
  - 正在被 sidecar 加载:confirm 警告「正在使用,卸载会停止该模型服务」→ 先停对应
    capability 的 sidecar 再删。
  - 是默认模型(`DEFAULT_LLM_MODEL`/capability_router):删后回退下一个可用并提示。
  - 内置模型(`vendor/runtimes`,tag bundled,只读):标已安装但禁用卸载,tooltip
    「内置模型不可卸载」。

## 前端(列表式 + 复用)

- **菜单/路由**:`i18n/zh-CN.ts` `nav.modelMarket` 文案改「模型厂商」+ 新增
  `nav.modelGallery:'模型广场'`;`Sidebar.tsx` NAV_ITEMS 新增 `/model-gallery`(icon Store);
  `router/index.tsx` 注册 `/model-gallery`。
- **新页面 `features/modelGallery/ModelGalleryPage.tsx`**(列表式):
  - 顶部过滤区:源 tab(ModelScope/HuggingFace[线路切换]/已安装)+ 能力类型 chips
    (**复用 ModelMenuList 的 capability chip 组件/样式**)+ 搜索框(防抖)+ `仅可运行` 开关。
    **类型过滤与查询 AND 联合**,任一变化回第 1 页重查。
  - 列表行 `ModelHubRow.tsx`:名/owner · 能力徽标 · 参数大小 · 文件大小 · 下载量 ·
    操作(安装/已安装/卸载,安装中行内进度条);表头可排序(下载量/更新时间)。
  - 底部经典页码分页(上一页/下一页 + 当前/总页 + 跳页)。
  - `HubFilePickerDialog.tsx`:repo 有多个可运行文件(多 quant)时,点安装弹此选 quant
    (文件名+大小);单文件一键装。
- **真复用(CLAUDE.md 硬规则,不造阉割版)**:把 `InstallModelDialog` 的安装 job
  轮询+进度+取消**抽成共享 hook `useInstallJob`**,老对话框与新画廊行都用;进度条/
  confirmDialog/能力 chips 全用现成。
- **API 客户端 `packages/api/src/modelHub.ts`**:`search`(分页)/`detail`/`installed`;
  install 复用 `serverModelsInstallModel`;uninstall 调 `/admin/models/uninstall`。
- **状态联动**:安装完成/卸载后 invalidate react-query `['v1.models']`+`['runtime.models']`
  → 对话下拉自动出现/消失(装完即用,无需重启前端);可选订阅 `/runtime/models/events`。

## 错误处理(按源隔离)

- hub 不可达:每请求超时~10s;单源失败只在该 tab 显示「源不可达,重试/切线路」,不崩页。
  HF 默认 hf-mirror(用户环境官方不可达)。
- 搜索无结果/详情取大小失败:空态;大小显 `—`,不阻断安装。
- 安装失败:复用 job `log_tail` 展示原因,可重试;下载器支持断点续传。
- 卸载失败(占用):先停 sidecar 再删;仍失败则报错且不半删(全删或不动)。
- param/能力识别不到:param 显 `—`;capability 落 other 仍可装。
- hub 限流:搜索防抖 + react-query 短 staleTime 缓存。
- 后端 adapter 失败按源隔离,一源挂不拖垮整页。

## 测试

- **后端单测(纯函数、离线、py312)**:用**实测录下的真实 JSON 固定样本**喂 adapter,
  断言 capability 映射、文件大小求和、param 正则解析、runnable 判定;安装态匹配
  (manifest origin → installed 集合);卸载路径解析(删记录 path 而非反推)。HTTP 层 mock。
- **前端**:`npm run typecheck`;有组件测试基建则补轻量测试。
- **集成冒烟(用户 py312+联网)**:ModelScope 搜索出列表 → 装小 GGUF → 对话下拉出现可用
  → 卸载后消失。

## 实施约束与首步

- **实现首步先实测接口**(memory 教训:接口/下载链接写前必实测):对 hf-mirror
  `/api/models` + tree、ModelScope 模型列表 + repo/files 各跑一次,录响应做 adapter fixture
  与字段映射,再落代码。用户环境:ModelScope 可达、HF 官方不可达、hf-mirror 可达。
- 所有改动沙箱只能 py_compile/读检,真验证靠用户 py312 + 联网。

## 未做(YAGNI / 后续)

- 文生图/文生视频模型(text-to-image/video)的安装与运行(本地推理重,首期不接)。
- 模型版本/分支(revision)选择(默认 main/master)。
- 远程私有库鉴权(token)——首期只公开模型。
