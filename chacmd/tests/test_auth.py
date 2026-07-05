import pytest

from chacmd.interfaces.auth import AuthProvider, FakeAuthProvider


@pytest.mark.asyncio
async def test_fake_auth_issue_and_verify():
    a: AuthProvider = FakeAuthProvider()
    token = await a.issue_token(subject="u1", dept="d1")
    claims = await a.verify(token)
    assert claims["subject"] == "u1"
    assert claims["dept"] == "d1"


@pytest.mark.asyncio
async def test_fake_auth_rejects_bad_token():
    a = FakeAuthProvider()
    with pytest.raises(ValueError):
        await a.verify("not-a-real-token")
