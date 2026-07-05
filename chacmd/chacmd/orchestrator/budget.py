from __future__ import annotations


class BudgetGuard:
    """per-job token 硬预算（NFR-C1）。

    charge() 累计 token 并返回是否仍在预算内；返回 False = 超预算，调用方应 kill。
    budget=0 表示不限（永不 kill）。
    """

    def __init__(self, jobs: object) -> None:
        self._jobs = jobs

    async def charge(self, job_id: str, tokens: int) -> bool:
        budget = await self._jobs.get_budget(job_id)
        used = await self._jobs.add_tokens(job_id, tokens)
        if budget and used > budget:
            return False
        return True
