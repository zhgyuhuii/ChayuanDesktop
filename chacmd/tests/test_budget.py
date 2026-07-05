import pytest

from chacmd.orchestrator.budget import BudgetGuard


class _FakeJobs:
    def __init__(self, budget: int, used: int = 0) -> None:
        self._budget, self._used = budget, used

    async def add_tokens(self, job_id: str, n: int) -> int:
        self._used += n
        return self._used

    async def get_budget(self, job_id: str) -> int:
        return self._budget


@pytest.mark.asyncio
async def test_under_budget_ok():
    g = BudgetGuard(_FakeJobs(budget=100))
    assert await g.charge("j", 50) is True


@pytest.mark.asyncio
async def test_over_budget_signals_kill():
    g = BudgetGuard(_FakeJobs(budget=100))
    await g.charge("j", 60)
    assert await g.charge("j", 60) is False  # 累计 120 > 100 → kill 信号


@pytest.mark.asyncio
async def test_zero_budget_never_kills():
    g = BudgetGuard(_FakeJobs(budget=0))
    assert await g.charge("j", 10_000_000) is True
