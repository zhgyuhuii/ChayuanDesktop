"""#14 资源级 RBAC 本地判定（主体×资源×动作 + 部门 tenant 隔离 + deny 优先）。

察元无资源级 authz 端点（scope-based）→ container/agent/view/kb 派活鉴权归 ChaCMD 本地域。
"""

import pytest

from chacmd.domain.repository import AuditRepository, ContainerRepository, JobRepository
from chacmd.domain.state import JobState
from chacmd.interfaces.agent_adapter import FakeAgentAdapter
from chacmd.interfaces.chayuan_client import FakeChayuanClient
from chacmd.interfaces.db import Database
from chacmd.interfaces.eventbus import InMemoryEventBus
from chacmd.interfaces.rbac import Grant, RbacPolicy, Resource, Subject
from chacmd.orchestrator.dispatcher import Dispatcher
from chacmd.orchestrator.ingest import EventIngest


def _policy(*grants):
    return RbacPolicy(grants=tuple(grants))


def test_default_deny():
    pol = _policy()
    assert pol.check(Subject("u1"), Resource("container", "dev"), "dispatch") is False


def test_grant_allows_matching():
    pol = _policy(Grant(role="operator", resource_type="container", actions=frozenset({"dispatch"})))
    s = Subject("u1", roles=("operator",))
    assert pol.check(s, Resource("container", "dev"), "dispatch") is True
    # 动作不在授权集 → 拒
    assert pol.check(s, Resource("container", "dev"), "config") is False
    # 资源类型不匹配 → 拒
    assert pol.check(s, Resource("kb", "docs"), "dispatch") is False


def test_wildcard_resource_type_and_action():
    pol = _policy(Grant(role="super", resource_type="*", actions=frozenset({"*"})))
    s = Subject("u1", roles=("super",))
    assert pol.check(s, Resource("view", "dashboard"), "open") is True
    assert pol.check(s, Resource("agent", "x"), "config") is True


def test_resource_id_prefix_match():
    pol = _policy(Grant(role="dev", resource_type="container", resource_id="dev-*", actions=frozenset({"dispatch"})))
    s = Subject("u1", roles=("dev",))
    assert pol.check(s, Resource("container", "dev-1"), "dispatch") is True
    assert pol.check(s, Resource("container", "prod-1"), "dispatch") is False


def test_admin_role_bypasses():
    pol = _policy()
    assert pol.check(Subject("root", roles=("admin",)), Resource("container", "x"), "dispatch") is True


def test_tenant_isolation_cross_department_denied():
    pol = _policy(Grant(role="operator", resource_type="container", actions=frozenset({"dispatch"})))
    # 主体属部门 A，资源属部门 B → 即便有 grant 也拒（NFR-T1 部门隔离）
    s = Subject("u1", roles=("operator",), tenant="deptA")
    assert pol.check(s, Resource("container", "dev", tenant="deptB"), "dispatch") is False
    # 同部门 → 通过
    assert pol.check(s, Resource("container", "dev", tenant="deptA"), "dispatch") is True


def test_admin_crosses_tenant():
    pol = _policy()
    s = Subject("root", roles=("admin",), tenant="deptA")
    assert pol.check(s, Resource("container", "dev", tenant="deptB"), "dispatch") is True


def test_deny_grant_wins_over_allow():
    pol = _policy(
        Grant(role="operator", resource_type="container", actions=frozenset({"dispatch"})),
        Grant(
            role="operator",
            resource_type="container",
            resource_id="prod-*",
            actions=frozenset({"dispatch"}),
            effect="deny",
        ),
    )
    s = Subject("u1", roles=("operator",))
    assert pol.check(s, Resource("container", "dev-1"), "dispatch") is True
    assert pol.check(s, Resource("container", "prod-1"), "dispatch") is False  # deny 优先


def test_deny_beats_admin():
    # 三员分立/SoD：显式 deny 可约束 admin（NFR-GX4）
    pol = _policy(
        Grant(role="admin", resource_type="audit", actions=frozenset({"*"}), effect="deny"),
    )
    s = Subject("root", roles=("admin",))
    assert pol.check(s, Resource("audit", "log"), "config") is False


# --- dispatcher 接入本地 RBAC（替 FakeChayuanClient 恒 allow 盲区）---


@pytest.fixture
async def db():
    d = Database(url="sqlite+aiosqlite:///:memory:")
    await d.create_all()
    yield d
    await d.dispose()


def _disp(db, rbac):
    jobs = JobRepository(db)
    containers = ContainerRepository(db)
    return jobs, containers, Dispatcher(
        jobs=jobs,
        containers=containers,
        chayuan=FakeChayuanClient(),
        adapter=FakeAgentAdapter(steps=["a"]),
        ingest=EventIngest(InMemoryEventBus(), jobs, AuditRepository(db)),
        rbac=rbac,
    )


@pytest.mark.asyncio
async def test_dispatcher_local_rbac_allows_granted_subject(db):
    pol = _policy(Grant(role="operator", resource_type="container", actions=frozenset({"dispatch"})))
    jobs, containers, disp = _disp(db, pol)
    await containers.upsert(nickname="dev", session="s1", dept="deptA")
    job = await jobs.create(code="c", goal="g", dept="deptA")
    subj = Subject("u1", roles=("operator",), tenant="deptA")
    await disp.dispatch(job_id=job.id, nickname="dev", subject=subj, system_prompt="p")
    assert (await jobs.get(job.id)).state == JobState.SUCCEEDED.value


@pytest.mark.asyncio
async def test_dispatcher_local_rbac_denies_unroled_subject(db):
    pol = _policy(Grant(role="operator", resource_type="container", actions=frozenset({"dispatch"})))
    jobs, containers, disp = _disp(db, pol)
    await containers.upsert(nickname="dev", session="s1", dept="deptA")
    job = await jobs.create(code="c", goal="g", dept="deptA")
    subj = Subject("guest", roles=(), tenant="deptA")  # 无角色 → 默认拒
    with pytest.raises(PermissionError):
        await disp.dispatch(job_id=job.id, nickname="dev", subject=subj, system_prompt="p")
    assert (await jobs.get(job.id)).state == JobState.QUEUED.value


@pytest.mark.asyncio
async def test_dispatcher_local_rbac_denies_cross_department(db):
    pol = _policy(Grant(role="operator", resource_type="container", actions=frozenset({"dispatch"})))
    jobs, containers, disp = _disp(db, pol)
    await containers.upsert(nickname="dev", session="s1", dept="deptB")  # 容器属 B
    job = await jobs.create(code="c", goal="g", dept="deptB")
    subj = Subject("u1", roles=("operator",), tenant="deptA")  # 主体属 A → 跨部门拒
    with pytest.raises(PermissionError):
        await disp.dispatch(job_id=job.id, nickname="dev", subject=subj, system_prompt="p")
