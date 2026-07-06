"""#9 技能与插件体系（SKILL.md 注册 + allowlist + 签名校验 + 绑角色契约）。

生产禁自动装：只装 allowlist 内且签名有效的技能（NFR-SEC3 供应链）。
"""

import pytest

from chacmd.domain.charter import Charter
from chacmd.interfaces.crypto import StdCrypto
from chacmd.orchestrator.skills import SkillManifest, SkillRegistry, manifest_bytes


def _signed(crypto, name, version="1.0", source="clawhub"):
    m = SkillManifest(name=name, version=version, source=source, signature="")
    sig = crypto.sign(manifest_bytes(m)).hex()
    return SkillManifest(name=name, version=version, source=source, signature=sig)


def test_install_allowed_and_signed():
    crypto = StdCrypto(b"k")
    reg = SkillRegistry(crypto, allowlist={"pdf-extract"})
    reg.install(_signed(crypto, "pdf-extract"))
    assert "pdf-extract" in [s.name for s in reg.installed()]


def test_reject_not_in_allowlist():
    crypto = StdCrypto(b"k")
    reg = SkillRegistry(crypto, allowlist={"pdf-extract"})
    with pytest.raises(PermissionError):
        reg.install(_signed(crypto, "evil-skill"))


def test_reject_bad_signature():
    crypto = StdCrypto(b"k")
    reg = SkillRegistry(crypto, allowlist={"pdf-extract"})
    bad = SkillManifest(name="pdf-extract", version="1.0", source="clawhub", signature="deadbeef")
    with pytest.raises(ValueError):
        reg.install(bad)


def test_bind_skill_to_charter():
    crypto = StdCrypto(b"k")
    reg = SkillRegistry(crypto, allowlist={"pdf-extract"})
    reg.install(_signed(crypto, "pdf-extract"))
    c = Charter(identity="dev", goal="g", skills=("code",))
    c2 = reg.bind("pdf-extract", c)
    assert "pdf-extract" in c2.skills
    assert "code" in c2.skills  # 保留原技能


def test_bind_unknown_skill_raises():
    reg = SkillRegistry(StdCrypto(b"k"), allowlist=set())
    with pytest.raises(KeyError):
        reg.bind("ghost", Charter(identity="d", goal="g"))
