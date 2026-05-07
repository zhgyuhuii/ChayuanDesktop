# KB 准召率基准

_首次发布: 2026-05-02 · golden set v1 (30 条 query)_

## 当前指标

> 跑分入口: `python scripts/bench/kb_recall.py --update-baseline`
> 真实数字会在脚本首次运行后写入此文件 + `tests/perf/baseline.json`。
> 透明 > 完美:即使 < 95% 也先发布出来,跟踪改进。

* Recall@5 = (待首次跑分填充)
* MRR     = (待首次跑分填充)

## Targets

| 阶段 | Recall@5 目标 | MRR 目标 | 备注 |
|---|---|---|---|
| 当前基线 | ≥ 0.70 | ≥ 0.50 | 透明发布 |
| v6.1     | ≥ 0.85 | ≥ 0.65 | HyDE + 重排参数调优 |
| v7       | ≥ 0.95 | ≥ 0.80 | 引入跨段 reasoning + LLM 重排 |

## Golden set 设计

`tests/data/kb_golden/v1.jsonl` 包含 30 条覆盖以下场景的 query:

* 概念性问题(什么是 X) × 7
* API 调用类(怎么用 X) × 4
* 故障排查类(X 失败怎么办) × 7
* 模型选型类(X 推荐用什么) × 4
* 部署运维类(端口/环境/集群) × 5
* 自指元问题 × 3

每条 query 标注 2 个 expected doc id。Recall 算法:

```
Recall@K = |retrieved[:K] ∩ expected| / |expected|     (per query, 平均)
MRR      = 1 / rank_of_first_hit                       (per query, 平均;无命中视 0)
```

## 已知偏差

1. golden set 假设 KB 中已有以 `mirror-source` / `framework-wiring` 等稳定 ID 命名的文档。
   若调用者的 KB 用不同 ID,Recall 会被低估。建议在执行评测前先 `--check-coverage`(待加)。
2. 中文分词目前用 jieba;长尾名词(如 "GGUF") 切词不准会拖低 BM25 通道。

## 如何让数字变好

按收益排序:

1. **HyDE 改写命中率不达标的 query** —— `file_rag/hybrid_progress.py::_maybe_hyde_rewrite`
2. **rerank 阈值调整** —— `file_rag/hybrid_service.py::_rerank` 默认 0.0;对长尾问题改 -2.0
3. **title/section 通道权重** —— `file_rag/retrieval_pipeline/fuser.py` 默认 1.5/1.2,可针对短 query 提升
4. **chunk 大小** —— 默认 512;短 query 用 384,长 query 用 768

## 如何复现

```bash
python scripts/bench/kb_recall.py --kb <你的 KB 名> --top-k 5 --update-baseline
```

完成后 `docs/benchmarks/kb_recall.md` 与 `tests/perf/baseline.json` 都会更新。
