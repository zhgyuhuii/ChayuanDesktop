"""在线数字人发布 + 限流 + presence 回归测试。"""
from chayuan.server.video_generation import _helpers
from chayuan.server.video_generation.digital_human import online_presence, published_store
from chayuan.server.video_generation.digital_human.schemas import AvatarSlot, DigitalHumanPreset


def _preset(**kw) -> DigitalHumanPreset:
    base = dict(
        id="p1", name="主播A", avatar_ref="bundled:f1", avatar_kind="video",
        model="deepseek", ku_ids=["doc:kb1"], video_width=720, video_height=1280,
        voice_provider="edge", voice_name="zh-CN-XiaoxiaoNeural",
    )
    base.update(kw)
    return DigitalHumanPreset(**base)


def test_publish_snapshot_and_crud(monkeypatch, tmp_path):
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    rec = published_store.publish(_preset(), owner_id="7")
    assert rec.token and rec.preset_id == "p1" and rec.owner_id == "7"
    assert rec.name == "主播A" and rec.model == "deepseek" and rec.ku_ids == ["doc:kb1"]
    assert rec.enabled is True and rec.chat_enabled is True and rec.rate_per_min == 10
    assert [r.token for r in published_store.list_published()] == [rec.token]
    assert published_store.get_by_token(rec.token).name == "主播A"
    # owner 过滤
    assert published_store.list_published(owner_id="999") == []
    # 开关
    r2 = published_store.set_flags(rec.token, enabled=False, chat_enabled=False)
    assert r2.enabled is False and r2.chat_enabled is False
    # 删除
    assert published_store.delete(rec.token) is True
    assert published_store.get_by_token(rec.token) is None


def test_republish_same_preset_overwrites_keeps_token(monkeypatch, tmp_path):
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    rec1 = published_store.publish(_preset(name="旧名"), owner_id="7")
    published_store.set_flags(rec1.token, chat_enabled=False)
    rec2 = published_store.publish(_preset(name="新名"), owner_id="7")
    assert rec2.token == rec1.token        # 同 preset_id 复用 token
    assert rec2.name == "新名"              # 快照已更新
    assert rec2.chat_enabled is False       # 控制位保留
    assert len(published_store.list_published()) == 1


def test_persona_collected_from_avatars(monkeypatch, tmp_path):
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    p = _preset(avatars=[AvatarSlot(ref="bundled:f1", kind="video", persona="耐心导购")])
    rec = published_store.publish(p)
    assert "耐心导购" in rec.persona


def test_rate_limiter_per_minute():
    from chayuan.server.api_server.digital_human_public_routes import _BUCKETS, _DAILY, _rate_ok
    tok, ip = "ratetok", "1.2.3.4"
    _BUCKETS.pop((tok, ip), None); _DAILY.pop(tok, None)
    allowed = sum(1 for _ in range(5) if _rate_ok(tok, ip, rate_per_min=3, daily_cap=100))
    assert allowed == 3   # 令牌桶容量 3 → 前 3 通过,后 2 被挡


def test_rate_limiter_daily_cap():
    from chayuan.server.api_server.digital_human_public_routes import _BUCKETS, _DAILY, _rate_ok
    tok, ip = "daytok", "9.9.9.9"
    _BUCKETS.pop((tok, ip), None); _DAILY.pop(tok, None)
    allowed = sum(1 for _ in range(10) if _rate_ok(tok, ip, rate_per_min=1000, daily_cap=4))
    assert allowed == 4


def test_presence_count_default_zero():
    assert online_presence.count("never-seen-token") == 0
