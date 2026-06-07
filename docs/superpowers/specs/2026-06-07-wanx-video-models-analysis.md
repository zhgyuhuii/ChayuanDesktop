# 百炼 Wanx 视频模型未出现在清单 — 根因分析报告

- 日期：2026-06-07
- 触发：用户反馈百炼(阿里云 DashScope)的图生/文生/参考生视频/视频编辑模型全都没出现在模型清单
- 方法：用用户提供的百炼 API key 实测 `/v1/models` + 抓官方 API 文档核对真实 model id

## 一、现象

模型厂商页(百炼)只显示极少数视频模型；用户在控制台看到的全套视频模型（4 类约 25 个）都不在清单里。

## 二、根因（已实测确认）

1. **视频模型不在 OpenAI 兼容模型列表里**。用 key 实测 `GET https://dashscope.aliyuncs.com/compatible-mode/v1/models` → 返回 **212 个模型，没有一个视频模型**（唯一带 `wan` 的是 `wan2.7-image` / `wan2.7-image-pro`，是图像模型）。
2. **视频走原生异步接口**。文生/图生视频用的是 `POST https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis`（带 `X-DashScope-Async: enable`），**不在** compat-mode 的 `/v1/models` 里。
3. **自动检测拉不到**。系统的「自动检测模型」(`auto_detect_model`) 就是拉 `/v1/models` 归类 → 对视频模型永远是空。
4. **只剩硬编码默认**。所以清单里只有 `config_panel/model_config.py` 里 bailian 的 `text2video_models` 默认 3 个：`wan2.7-t2v` / `wanx2.1-t2v-turbo` / `wan2.6-i2v`。其余全没有。

> 结论：这不是 bug，是**架构现实** —— 视频模型必须靠「硬编码默认清单」或「用户手动添加」，无法自动检测。

## 三、你列的 4 类 vs 系统支持现状

| 类目 | 系统是否支持 | 说明 |
|---|---|---|
| 文生视频 T2V | ✅ 有 `text2video_models` + DashScope 连接器 | 扩默认清单即可 |
| 图生视频 I2V | ✅ 也归 `text2video_models`（连接器按是否带首帧图分流） | 扩默认清单即可 |
| 参考生视频 R2V | ❌ 无类目、无连接器 | R2V 传参考图/视频，参数与 T2V/I2V 不同，需新建 capability + 连接器 |
| 视频编辑 VideoEdit | ❌ 无类目、无连接器 | 传源视频，需新建 capability + 连接器 |

## 四、展示名 → 真实 API id 映射（官方文档核实）

控制台展示名 ≠ API 调用 id。实测官方文档（text-to-video / image-to-video API reference）：

**图生视频 I2V（文档已列，真实 id）：**
| 控制台展示名 | 真实 API id | 核实 |
|---|---|---|
| Wan2.6-I2V-flash | `wan2.6-i2v-flash` | ✅文档 |
| Wan2.6-I2V | `wan2.6-i2v` | ✅文档 |
| Wan2.5-I2V-Preview | `wan2.5-i2v-preview` | ✅文档 |
| Wan2.2-I2V-Plus | `wan2.2-i2v-plus` | ✅文档 |
| Wan2.2-I2V-Flash | `wan2.2-i2v-flash` | ✅文档 |
| Wan2.1-I2V-Plus | `wanx2.1-i2v-plus` | ✅文档（注意 2.1=`wanx2.1`） |
| Wan2.1-I2V-Turbo | `wanx2.1-i2v-turbo` | ✅文档 |
| Wan2.7-I2V / -2026-04-25 | `wan2.7-i2v` / `wan2.7-i2v-2026-04-25` | ⚠️文档未列(可能更新于缓存后)，待实测 |
| HappyHorse-1.0-I2V | 未知 | ⚠️文档无，疑似新模型，id 待查 |
| (文档另有 `wan2.6-i2v-us` 海外节点) | `wan2.6-i2v-us` | ✅文档 |

**文生视频 T2V（2.7 文档页只列了 wan2.7-t2v，其余按命名规律+既有默认推断，需逐个实测）：**
| 控制台展示名 | 推断 API id | 核实 |
|---|---|---|
| Wan2.7-T2V / -2026-04-25 | `wan2.7-t2v` / `wan2.7-t2v-2026-04-25` | ✅`wan2.7-t2v` 文档；快照待实测 |
| Wan2.6-T2V | `wan2.6-t2v` | ⚠️待实测 |
| Wan2.5-T2V-Preview | `wan2.5-t2v-preview` | ⚠️待实测 |
| Wan2.2-T2V-Plus | `wan2.2-t2v-plus` | ⚠️待实测（既有默认含同族） |
| Wan2.1-T2V-Plus | `wanx2.1-t2v-plus` | ⚠️待实测 |
| Wan2.1-T2V-Turbo | `wanx2.1-t2v-turbo` | ✅已在默认 |
| HappyHorse-1.0-T2V | 未知 | ⚠️待查 |

**命名规律**：2.1 版前缀是 `wanx2.1-`，2.2 及以上是 `wan2.x-`。

## 五、隐藏分类 bug（一并指出）

`protocol.py` 的 `_PREFIX_TO_CAP` 里 `("wanx", T2I)` 是贪婪前缀，会把 `wanx2.1-i2v-turbo` / `wanx2.1-t2v-turbo` 误判成**文生图(T2I)**（因为它们 `startswith("wanx")` 但不 `startswith("wanx-t2v")`）。
- **缓解**：P2a 已加「能力按配置路由」——只要模型配在 `text2video_models` 列表里，就按 T2V 路由，不再看前缀。所以**配进默认清单的 wanx2.1 视频模型能正常工作**。
- **彻底修**（可选）：给 `_PREFIX_TO_CAP` 加 `("wanx2.1-i2v", T2V)`/`("wanx2.1-t2v", T2V)` 精确前缀放在 `("wanx", T2I)` 之前。

## 六、修复方案（分级，工作量）

**A. 扩 T2V+I2V 全系默认（小，推荐先做）**
- 把 bailian `text2video_models` 默认从 3 个扩到全套 T2V+I2V（用上表真实 id，逐个对文档实测核对；HappyHorse 等查不到的先不放）。
- 可选：补 `wanx2.1-*` 视频精确前缀根治分类 bug。
- 改动：`model_config.py` 一处 + protocol.py 可选。前端无改动（已有「视频生成」栏）。

**B. 新增「参考生视频 R2V」+「视频编辑」类目（大，各一个 mini-P1）**
- 每个要：新 `Capability`（如 `R2V`/`VIDEO_EDIT`）+ `*_models` 配置字段全链路 + 前端 `ModelType` + DashScope 对应连接器（R2V 传参考图、VideoEdit 传源视频，提交体/参数不同）+ 使用入口的输入控件（上传参考图/源视频）。
- 工作量与 P1 给 video 开类目相当，建议各自独立 spec→plan。

## 七、建议路线

1. 先做 **A**：扩 T2V+I2V 默认 + 修 wanx2.1 前缀 → 你列的「文生视频/图生视频」两类基本都能出现可用。
2. 用真 key 端到端验证若干 id（提交一个 video-synthesis 任务看是否 200 / "model not exist"）后再定稿默认清单。
3. **R2V + 视频编辑** 作为后续 P2c/P2d，需要时再开（属于 P2b 之后的扩展）。
