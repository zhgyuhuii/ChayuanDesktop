# 基准评测中心

> 任何"我们到底跑得多快/多准"的问题,都在这里找答案。
> 透明 > 完美:即使指标未达目标,也先发布出来,让团队/用户能跟踪改进。

## 当前已有评测

| 名称 | 数据集 | 入口 | 频率 | 当前结果 |
|---|---|---|---|---|
| KB 准召率 | `tests/data/kb_golden/` | `python scripts/bench/kb_recall.py` | 手动 + nightly | 见 `kb_recall.md` |
| OCR 字段命中率 | `tests/data/ocr/` | `pytest tests/test_ocr_golden.py` | 每 PR | 见 `ocr_golden.md` |
| 网关吞吐 (locust) | `tests/perf/locustfile.py` | `locust -f tests/perf/locustfile.py` | 手动 | 见 `gateway_throughput.md` |
| ComfyUI t2i smoke | n/a | `.github/workflows/smoke-comfyui.yml` (manual_dispatch) | 手动 | 见 workflow runs |
| Ollama 真启 smoke | n/a | `.github/workflows/smoke-ollama.yml` | 手动 | 见 workflow runs |

## 文件约定

* `tests/perf/baseline.json` —— 所有评测结果的归档(SSOT,schema 见 `scripts/bench/baseline.py`)
* `docs/benchmarks/<name>.md` —— 单个评测的对外可见报告(由脚本自动生成 markdown 段落,人工补充上下文)
* `tests/data/<name>/` —— 数据集 fixture(进 git 的小规模 golden set)

## 生命周期

1. **新基准上线**: 创建 fixture → 写脚本 → 跑一次 → `append_run` 进 baseline.json → 生成 `<name>.md` → 进 git。
2. **回归发现**: PR 跑同名脚本 → 与 baseline 最近一条对比 → delta 写到 PR 评论。
3. **目标改进**: 用户/产品提出"想从 X% 到 Y%" → 在评测 md 顶部写 challenge & 期限 → 跟踪到达。

## 如何加新评测

1. 在 `scripts/bench/<your_bench>.py` 写脚本;调 `baseline.append_run` 落库。
2. 在 `docs/benchmarks/<your_bench>.md` 写"是什么、量什么、怎么解读"。
3. 在本 README 表格里加一行。
4. 如果是高价值评测,加 nightly workflow;否则保留 manual。
