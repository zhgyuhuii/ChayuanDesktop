# 网关吞吐基线 (locust)

_workflow: `.github/workflows/perf-locust.yml` (manual_dispatch)_

## 是什么

* 在 GitHub Hosted Runner (ubuntu-22.04, 4 vCPU, 16 GB RAM, 无 GPU) 上启
  ollama + qwen2:0.5b → chayuan-gateway → locust 跑 OpenAI 兼容 SSE chat。
* 阈值: chat p95 < 1500 ms。
* 输出: `perf-out_stats.csv`(artifact),手动 commit 到 `tests/perf/baseline.json`。

## 当前结果

> 首次跑分前留空。在 Action Tab 触发 `perf-locust` workflow → 下载 artifact →
> `python scripts/bench/append_locust.py perf-out_stats.csv` 写入 baseline。

## 升级路径

* **基础**: 当前 ubuntu-hosted runner ≈ "不卡顿"基线
* **真实**: 自托管 GPU runner (RTX 4090) 跑 qwen2.5:7b,目标 p95 < 800ms
* **极致**: 4×A100 跑 qwen2.5:72b,目标 p95 < 600ms,QPS > 30

## 如何运行

```bash
# GitHub Action: 手动 dispatch
# 本地:
cd /path/to/chayuan-server
locust -f scripts/perf/locustfile.py --host http://127.0.0.1:8088 \
  --headless -u 10 -r 10 -t 5m --csv perf-out --only-summary
```
