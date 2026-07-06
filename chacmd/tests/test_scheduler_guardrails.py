"""调度器·成本护栏（work-model 主文档 模型预算(二)：三级熔断硬编码 + 回炉 + 连败隔离）。

三级：单任务 $8→挂起；单晚 $200→停派；月度触顶→暂停上报。护栏做在系统里不依赖自觉。
"""

from chacmd.scheduler.guardrails import (
    BudgetLimits,
    global_circuit,
    recycle_or_block,
    should_isolate,
    task_over_budget,
)

L = BudgetLimits()


def test_task_over_8_dollars_suspends():
    assert task_over_budget(8.5, L) is True
    assert task_over_budget(7.9, L) is False


def test_night_over_200_halts_dispatch():
    d = global_circuit(night_spend=210, month_spend=100, limits=L)
    assert d.allow_dispatch is False
    assert d.reason == "night_halt"


def test_month_cap_pauses_and_reports():
    d = global_circuit(night_spend=10, month_spend=99999, limits=L)
    assert d.allow_dispatch is False
    assert d.reason == "month_cap"  # 月度最严，优先


def test_under_all_budgets_allows():
    d = global_circuit(night_spend=50, month_spend=1000, limits=L)
    assert d.allow_dispatch is True
    assert d.reason is None


def test_recycle_under_three_rounds():
    assert recycle_or_block(0) == "recycle"
    assert recycle_or_block(2) == "recycle"
    # 达到上限 3 轮 → 等人
    assert recycle_or_block(3) == "block"


def test_isolate_on_fail_streak():
    assert should_isolate(3, threshold=3) is True
    assert should_isolate(2, threshold=3) is False
