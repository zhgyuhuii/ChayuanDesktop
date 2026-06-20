"""用户画像 AI 分析(框架无关)。port 自 config_panel 的 _pick_chat_model/_call_llm/
_build_persona_prompt;React admin REST 消费。LLM 调用留后端,前端不持 key。
"""
from __future__ import annotations

import collections
import logging
import time
from typing import Any, Optional, Tuple

logger = logging.getLogger("chayuan.admin.persona")


def pick_chat_model() -> Optional[Tuple[str, str, str]]:
    """返回 (model_name, api_base, api_key);无可用 LLM 平台返回 None。"""
    from chayuan.settings import Settings

    ms = Settings.model_settings
    platforms = list(getattr(ms, "MODEL_PLATFORMS", []) or [])
    default = str(getattr(ms, "DEFAULT_LLM_MODEL", "") or "")

    def _get(p: Any, k: str, dv: Any = None) -> Any:
        return p.get(k, dv) if isinstance(p, dict) else getattr(p, k, dv)

    if default:
        for p in platforms:
            if default in list(_get(p, "llm_models", []) or []):
                return default, str(_get(p, "api_base_url", "")), str(_get(p, "api_key", "EMPTY") or "EMPTY")
    for p in platforms:
        models = list(_get(p, "llm_models", []) or [])
        if models:
            return models[0], str(_get(p, "api_base_url", "")), str(_get(p, "api_key", "EMPTY") or "EMPTY")
    return None


def call_llm(model: str, api_base: str, api_key: str, prompt: str) -> str:
    """OpenAI 兼容同步调用。"""
    try:
        import openai  # type: ignore
    except ImportError:
        return "未安装 openai 客户端包：pip install 'openai>=1.0'"
    if not api_base:
        return "模型平台未配置 api_base_url"
    base = api_base.rstrip("/")
    if not base.endswith("/v1"):
        base = base + "/v1"
    try:
        client = openai.OpenAI(api_key=api_key or "EMPTY", base_url=base, timeout=120.0)
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "你是一名面向 RAG 平台的用户运营分析师，中文回复。"},
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
            max_tokens=1200,
        )
        return (resp.choices[0].message.content or "").strip()
    except Exception as e:  # noqa: BLE001
        logger.exception("persona LLM call failed")
        return f"LLM 调用失败：{type(e).__name__}: {e}"


def _top(d: dict, n: int) -> str:
    return ", ".join(f"{k}({v})" for k, v in collections.Counter(d or {}).most_common(n)) or "—"


def build_persona_prompt(u: dict) -> str:
    """用 build_users_snapshot 的单用户 dict 构造 prompt。"""
    recent = "\n".join(
        f"  - [{(rq.get('time') or '')[:16]}] ({rq.get('chat_type') or '—'}) {rq.get('query') or ''}"
        for rq in (u.get("recent_queries") or [])[:8]
    ) or "  （无）"
    return f"""你是一名面向 RAG 平台的**用户运营分析师**。基于下方单个用户的使用画像，请输出：

1. **一句话总结**：这个用户大概是什么角色；
2. **兴趣偏好**：最常问什么、最爱用哪些模型/工具/KB；
3. **使用模式**：活跃时段/频次、是否重度用户；
4. **潜在风险**：tokens 异常/刷屏/误用；
5. **运营建议**：推荐功能/模型/KB、成本优化、挽回激活；
6. **一行画像标签**：3-5 个中文 hashtag。

以 Markdown 输出，每节加粗小标题，不要再抄原始数据。

## 用户快照
- 用户：{u.get('username')} (#{u.get('id')}) · 角色 {u.get('role')} · {'启用' if u.get('is_active') else '停用'}
- 邮箱：{u.get('email') or '—'} · 注册：{(u.get('created_at') or '—')[:10]} · 最近登录：{(u.get('last_login_at') or '—')[:16]}

### 使用强度
- 消息数：{u.get('msg_count')} · 估算 tokens：{u.get('est_tokens')}（≈ {u.get('total_chars')} 字符）
- 反馈：{u.get('feedback_count')} 条，均分 {u.get('avg_feedback') if u.get('avg_feedback') is not None else '—'}
- 首次活跃：{(u.get('first_active') or '—')[:16]} · 最近活跃：{(u.get('last_active') or '—')[:16]}

### 行为偏好
- 模型：{_top(u.get('model_usage'), 8)}
- 工具：{_top(u.get('tool_usage'), 8)}
- 知识库：{_top(u.get('kb_usage'), 8)}
- 对话类型：{_top(u.get('chat_type_usage'), 5)}

### 最近提问样本
{recent}
"""


def generate_persona_analysis(user_id: int) -> dict:
    """编排:快照→定位用户→选模型→调 LLM。返回 {ok, model?, analysis?, reason?, generated_at}。"""
    from chayuan.server.admin.users_analytics import build_users_snapshot

    snap = build_users_snapshot()
    user = next((u for u in snap["users"] if int(u["id"]) == int(user_id)), None)
    if user is None:
        return {"ok": False, "reason": "user-not-found"}
    picked = pick_chat_model()
    if picked is None:
        return {"ok": False, "reason": "no-llm-platform"}
    model_name, api_base, api_key = picked
    analysis = call_llm(model_name, api_base, api_key, build_persona_prompt(user))
    return {"ok": True, "model": model_name, "analysis": analysis, "generated_at": time.time()}
