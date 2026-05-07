# OCR 黄金 fixture 评测

_首次发布: 2026-05-02_

## 是什么

最小回归测试。每条 fixture = 一张图像 + 期望出现/不该出现的关键字 + 最小文本长度。
测试用 RapidOCR / PaddleOCR (二选一,纯 ONNX 跨平台) 提取文本,逐条断言。

* fixture 真实图像 **不进 git**(避免敏感证件信息)。
* CI 看到 fixture 缺失 = `pytest.skip`,不会假阳性绿。

## 数据集

`tests/data/ocr/expected.json`:

| 文件 | 期望关键字 | 最少长度 |
|---|---|---|
| `id_card.png` | 姓名 / 性别 / 民族 | 30 |
| `invoice.png` | 发票 / 金额 | 50 |
| `handwriting.png` | (无关键字, 只验非空) | 5 |

## 如何运行

```bash
# 1) 把对应图像放到 tests/data/ocr/
# 2) 跑测试
pytest tests/test_ocr_golden.py -v
```

## 期望演进

* v6.1: 加 invoice OCR fixture (跨多家发票样式)
* v7  : 引入英文 fixture + 自动评分(Levenshtein 距离 < 阈值)
