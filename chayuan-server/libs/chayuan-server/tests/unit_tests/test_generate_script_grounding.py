"""generate_script kb_context grounding 注入 — 纯函数单测(待 py312 pytest 跑)。

monkeypatch ``script._invoke_llm`` 捕获最终 prompt,断言:
  - 传 kb_context 时 prompt 含「企业知识/参考话术」标题 + 上下文文本;
  - 不传 kb_context 时 prompt 不含「企业知识」字样。
"""

from __future__ import annotations

from chayuan.server.video_generation.steps import script as script_mod


def _patch_capture(monkeypatch):
    captured = {}

    def fake_invoke_llm(prompt, *, model=None):
        captured["prompt"] = prompt
        captured["model"] = model
        return "生成的文案"

    monkeypatch.setattr(script_mod, "_invoke_llm", fake_invoke_llm)
    return captured


def test_kb_context_injected_into_prompt(monkeypatch):
    captured = _patch_capture(monkeypatch)
    kb_ctx = "我们的产品主打省电与静音,质保三年。"
    out = script_mod.generate_script("空调推广", kb_context=kb_ctx)
    assert out == "生成的文案"
    prompt = captured["prompt"]
    assert "企业知识/参考话术" in prompt
    assert kb_ctx in prompt
    # grounding 必须前置(出现在主题提示之前)
    assert prompt.index("企业知识/参考话术") < prompt.index("空调推广")


def test_no_kb_context_no_grounding_header(monkeypatch):
    captured = _patch_capture(monkeypatch)
    out = script_mod.generate_script("空调推广")
    assert out == "生成的文案"
    assert "企业知识" not in captured["prompt"]


def test_empty_kb_context_no_grounding_header(monkeypatch):
    captured = _patch_capture(monkeypatch)
    out = script_mod.generate_script("空调推广", kb_context="   ")
    assert out == "生成的文案"
    assert "企业知识" not in captured["prompt"]
