from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from chacmd.config import Settings
from chacmd.domain.repository import AuditRepository, ContainerRepository, JobRepository
from chacmd.interfaces.agent_adapter import FakeAgentAdapter
from chacmd.interfaces.auth import ChayuanAuthProvider, FakeAuthProvider
from chacmd.interfaces.chayuan_client import FakeChayuanClient, HttpChayuanClient
from chacmd.interfaces.crypto import StdCrypto
from chacmd.interfaces.db import Database
from chacmd.interfaces.eventbus import InMemoryEventBus
from chacmd.interfaces.registry import InProcessConfigSource, InProcessServiceRegistry
from chacmd.interfaces.sandbox import FakeSandbox
from chacmd.interfaces.transport import InProcessTransport
from chacmd.orchestrator.dispatcher import Dispatcher
from chacmd.orchestrator.ingest import EventIngest
from chacmd.orchestrator.provisioner import Provisioner
from chacmd.workspace import Workspace


@dataclass
class Container:
    settings: Settings
    db: Database
    chayuan: Any
    crypto: Any
    registry: Any
    config: Any
    bus: Any
    transport: Any
    adapter: Any
    sandbox: Any
    auth: Any
    jobs: JobRepository
    containers: ContainerRepository
    audit: AuditRepository
    ingest: EventIngest
    dispatcher: Dispatcher
    provisioner: Provisioner
    workspace: Workspace


async def build_container(settings: Settings, use_fakes: bool = False) -> Container:
    from chacmd.observability.otel import init_tracing

    init_tracing()
    db = Database(url=settings.db_url)
    await db.create_all()

    if use_fakes:
        chayuan = FakeChayuanClient(web_url=settings.chayuan_web_url)
        adapter = FakeAgentAdapter(steps=["step-1", "step-2"])
        auth = FakeAuthProvider()
    else:
        chayuan = HttpChayuanClient(base_url=settings.chayuan_base_url, web_url=settings.chayuan_web_url)
        if settings.agent_adapter == "openhands":
            from chacmd.adapters.openhands_adapter import OpenHandsAdapter

            adapter = OpenHandsAdapter()
        else:
            adapter = FakeAgentAdapter(steps=["step-1"])
        auth = ChayuanAuthProvider(chayuan)

    if settings.sandbox == "docker" and not use_fakes:
        from chacmd.interfaces.docker_sandbox import DockerSandbox

        sandbox: Any = DockerSandbox()
    else:
        sandbox = FakeSandbox()

    jobs = JobRepository(db)
    containers = ContainerRepository(db)
    audit = AuditRepository(db)
    if settings.event_bus == "nats" and not use_fakes:
        from chacmd.interfaces.nats_bus import NatsEventBus

        bus: Any = NatsEventBus(url=settings.nats_url)
    else:
        bus = InMemoryEventBus()
    ingest = EventIngest(bus, jobs, audit)
    from chacmd.orchestrator.budget import BudgetGuard

    dispatcher = Dispatcher(jobs, containers, chayuan, adapter, ingest, budget=BudgetGuard(jobs))
    provisioner = Provisioner(sandbox, containers, image=settings.sandbox_image)

    return Container(
        settings=settings, db=db, chayuan=chayuan, crypto=StdCrypto(secret=b"dev"),
        registry=InProcessServiceRegistry(), config=InProcessConfigSource({}),
        bus=bus, transport=InProcessTransport(), adapter=adapter, sandbox=sandbox,
        auth=auth, jobs=jobs, containers=containers, audit=audit, ingest=ingest,
        dispatcher=dispatcher, provisioner=provisioner,
        workspace=Workspace(root=Path(settings.workspace_root)),
    )
