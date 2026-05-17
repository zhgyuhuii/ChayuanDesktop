import argparse
import os
from typing import Literal

import uvicorn
from fastapi import Body, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.responses import RedirectResponse

from chayuan import __version__
from chayuan.settings import Settings
from chayuan.server.api_server.admin_routes import admin_router
from chayuan.server.api_server.debug_routes import debug_router
from chayuan.server.api_server.annotation_routes import annotation_router
from chayuan.server.api_server.data_mount_routes import data_mount_router
from chayuan.server.api_server.chat_routes import chat_router
from chayuan.server.api_server.health_routes import health_router
from chayuan.server.api_server.governance_routes import governance_router
from chayuan.server.api_server.image_routes import image_model_router, image_router
from chayuan.server.api_server.kb_query_routes import kb_query_router
from chayuan.server.api_server.kb_routes import kb_router
from chayuan.server.api_server.kb_remote_sync_routes import remote_sync_router
from chayuan.server.api_server.knowledge_source_routes import ks_router
from chayuan.server.api_server.knowledge_universe_routes import ku_router
from chayuan.server.api_server.mcp_routes import mcp_router
from chayuan.server.api_server.modality_routes import modality_router
from chayuan.server.api_server.provider_routes import provider_router
from chayuan.server.api_server.runtime_routes import runtime_router
from chayuan.server.api_server.storage_routes import storage_router
from chayuan.server.api_server.middleware import (
    DBReadinessMiddleware,
    RequestIDMiddleware,
    TokenBucketRateLimiter,
)
from chayuan.server.api_server.openapi_routes import (
    AppAuthMiddleware,
    openapi_router,
)
from chayuan.server.api_server.openapi_ws import ws_router as openapi_ws_router
from chayuan.server.api_server.auth_routes import auth_router
from chayuan.server.api_server.cli_routes import cli_router
from chayuan.server.api_server.openai_routes import openai_router
from chayuan.server.api_server.server_routes import server_router
from chayuan.server.api_server.tool_routes import tool_router
from chayuan.server.auth.middleware import AuthMiddleware
from chayuan.server.chat.completion import completion
from chayuan.server.observability import (
    PrometheusMetricsMiddleware,
    setup_observability,
)
from chayuan.server.utils import MakeFastAPIOffline


def create_app(run_mode: str = None):
    # P2：日志 / tracing 在最早阶段初始化；缺依赖会自动降级为 no-op。
    setup_observability()

    app = FastAPI(title="察元AI助手", version=__version__)
    MakeFastAPIOffline(app)

    # 中间件挂载顺序（Starlette 语义：后加的在外层执行）：
    #   1) CORS（最外层，先处理跨域预检）
    #   2) RateLimit（次外层，尽早拒绝超额请求，避免无意义下游消耗）
    #   3) Metrics（技术指标，处于业务外层但拿到最终 status）
    #   4) DBReadinessGate（DB 不可达时统一 503，避免 Auth / 业务路由抛 SQL 堆栈）
    #   5) Auth（解析 JWT，供限流 / 日志 / metrics 按 user_id 归类）
    #   6) RequestID（最内层，保证业务日志里一定有 rid）
    # add_middleware 的加入顺序决定外层 → 内层；这里按"最内→最外"反向加。
    app.add_middleware(
        RequestIDMiddleware,
        header=getattr(Settings.basic_settings, "REQUEST_ID_HEADER", "X-Request-ID"),
    )
    # 租户上下文：紧挨 RequestID；必须在 Auth 之后，这样能读 request.state.user
    from chayuan.server.shared.tenant_context import TenantContextMiddleware
    app.add_middleware(TenantContextMiddleware)
    app.add_middleware(AuthMiddleware)
    app.add_middleware(DBReadinessMiddleware)
    # /openapi/v1/* 的 App 签名校验：比 Auth 靠内，这样正常用户路径不受影响，
    # 仅 /openapi/v1/ 前缀才会被检查三件套（X-App-Id / X-Timestamp / X-Sign）。
    app.add_middleware(AppAuthMiddleware)
    app.add_middleware(PrometheusMetricsMiddleware)
    app.add_middleware(TokenBucketRateLimiter)

    if Settings.basic_settings.OPEN_CROSS_DOMAIN:
        # 注意：`allow_origins=["*"] + allow_credentials=True` 按 CORS 规范浏览器会忽略。
        # 生产部署请把 allow_origins 明确列出（详见 docker/prod/nginx.conf）。
        app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    @app.get("/", summary="swagger 文档", include_in_schema=False)
    async def document():
        return RedirectResponse(url="/docs")

    # 健康检查尽量前置注册，纯独立 router 不依赖其它路由
    app.include_router(health_router)
    # 鉴权相关；登录 / 注册接口必须在 AUTH_REQUIRED=true 的时候也能访问
    app.include_router(auth_router)
    # CLI chachat：/cli/device/* 的 device code 流；本身就是未登录态使用的端点
    app.include_router(cli_router)
    app.include_router(chat_router)
    app.include_router(kb_router)
    app.include_router(kb_query_router)
    app.include_router(remote_sync_router)
    app.include_router(ks_router)
    app.include_router(ku_router)
    app.include_router(governance_router)
    app.include_router(admin_router)
    # 72 题诊断:/api/debug/dump_platforms — 排查 deepseek 等厂商在哪一层卡住
    app.include_router(debug_router)
    app.include_router(image_router)
    app.include_router(image_model_router)
    app.include_router(storage_router)
    app.include_router(tool_router)
    app.include_router(openai_router)
    app.include_router(server_router)
    app.include_router(mcp_router)
    app.include_router(modality_router)
    # 模型厂商公开 API（/v1/providers/*）—— 单机版「模型广场」前端入口；
    # 鉴权放宽为 optional，全局共享配置，详见 provider_routes.py 模块 docstring。
    app.include_router(provider_router)
    app.include_router(provider_router, prefix="/api")
    # 运行时端点 / vendor / 本地模型 —— 给"系统服务"页面 + chayuan service info 用
    app.include_router(runtime_router)
    app.include_router(runtime_router, prefix="/api")
    app.include_router(annotation_router)
    app.include_router(data_mount_router)
    # 开放平台路由（需要 App 签名鉴权，见 AppAuthMiddleware）
    app.include_router(openapi_router)
    # 开放平台 WebSocket 路由；鉴权走查询串签名，在 endpoint 内部自行校验
    # （AppAuthMiddleware 是 HTTP-only，scope.type=="websocket" 时直接放行）
    app.include_router(openapi_ws_router)

    # ────────────────────────────────────────────────────────────────────
    # 察元 AI 一体化平台桥接：把 chayuan_gateway 的 9 类 OpenAI 协议路由
    # （/v1/chat/completions 等）挂到本 ASGI app；缺包时优雅跳过，不阻塞启动。
    # 详见 chayuan/server/ai_platform/__init__.py。
    # ────────────────────────────────────────────────────────────────────
    try:
        from chayuan.server.ai_platform import register_ai_platform_routes
        register_ai_platform_routes(app)
    except Exception:  # noqa: BLE001
        import logging
        logging.getLogger("chayuan.ai_platform").exception(
            "register_ai_platform_routes failed; /v1/* 路由不可用，但主服务继续启动"
        )

    @app.on_event("startup")
    async def _db_migrations_and_auth_bootstrap() -> None:
        """启动时补齐增量表结构,避免 prod 配置切库后业务路由遇到空库 500。"""
        import logging
        log = logging.getLogger("chayuan.startup")
        try:
            from chayuan.server.db.migrations import run_migrations
            run_migrations()
        except Exception:  # noqa: BLE001
            log.exception("run_migrations failed")
        try:
            from chayuan.server.auth.service import bootstrap_default_admin
            seed = bootstrap_default_admin()
            if seed:
                username, password = seed
                log.warning("seeded default admin username=%s password=%s", username, password)
        except Exception:  # noqa: BLE001
            log.exception("bootstrap_default_admin failed")

    @app.on_event("startup")
    async def _model_first_launch() -> None:
        """装机即用钩子:scan_once + 默认模型自动指派 + 部署用户手册。

        集成版(standard/pro)装机自带模型,但 capability defaults yaml 是空的;
        本钩子运行后用户不用进任何配置页就能直接开聊天 / 跑 RAG / 检索。

        失败仅记日志,不阻塞启动。
        """
        import logging
        log = logging.getLogger("chayuan.startup")
        try:
            from chayuan.server.model_registry.first_launch import (
                run_first_launch_hooks,
            )
            r = run_first_launch_hooks()
            if r.promoted:
                log.info("[first_launch] auto-promoted defaults: %s", r.promoted)
            if r.manuals_md or r.manuals_docx:
                log.info(
                    "[first_launch] deployed manuals: md=%s docx=%s",
                    r.manuals_md, r.manuals_docx,
                )
        except Exception:  # noqa: BLE001
            log.exception("run_first_launch_hooks failed")

    # WS hub 与事件循环绑定，并注册关停钩子
    @app.on_event("startup")
    async def _ws_hub_attach() -> None:
        from chayuan.server.shared.ws_hub import get_hub
        get_hub().attach_loop()

    # 模型生命周期: framework_wiring 注入到 modelmgr.lifecycle 的 WIRE 阶段
    # 这样 "下载完一个模型 → Ollama / vLLM / ComfyUI 等运行时立刻可见" 成为默认行为
    @app.on_event("startup")
    async def _lifecycle_install_wiring() -> None:
        try:
            from chayuan_runtime.framework_wiring import install_into_lifecycle
            install_into_lifecycle()
        except Exception:  # noqa: BLE001
            import logging as _logging
            _logging.getLogger("chayuan.startup").exception(
                "install framework_wiring into lifecycle failed"
            )

    @app.on_event("shutdown")
    async def _ws_hub_close() -> None:
        from chayuan.server.shared.ws_hub import get_hub
        await get_hub().close_all()

    # 配置中心：启动后台 Redis 订阅 task（多副本一致性）
    # + 注册三个 store 的本地热更新回调（收到变更 → 清本地内存缓存 + 触发工具重注册）
    @app.on_event("startup")
    async def _config_center_attach() -> None:
        try:
            from chayuan.server.config_center import (
                register_callback, start_background_subscriber,
            )
        except Exception as _e:  # noqa: BLE001
            import logging
            logging.getLogger("chayuan.config_center").warning(
                "启动订阅失败：%r", _e,
            )
            return

        # 自定义工具 / WS 端点变更时，让 tools_factory 动态重注册
        def _reload_custom_tools(_evt):
            try:
                from chayuan.server.agent.tools_factory import (
                    custom_tools_runtime,
                )
                custom_tools_runtime.load_and_register()
            except Exception:  # noqa: BLE001
                pass

        def _reload_ws_endpoints(_evt):
            try:
                from chayuan.server.agent.tools_factory import (
                    websocket_tools_runtime,
                )
                websocket_tools_runtime.load_and_register()
            except Exception:  # noqa: BLE001
                pass

        register_callback("custom_tools", _reload_custom_tools)
        register_callback("ws_endpoints", _reload_ws_endpoints)
        # apps_store 本身是每次查询都读 yaml/DB，不需要进程内缓存；但留个钩子便于扩展
        register_callback("apps", lambda _e: None)

        # P1 迁移：tool_settings / prompt_settings 收到 DB 变更事件时，把最新值
        # 反向同步到本地 yaml 文件，让 Pydantic Settings 的 set_auto_reload(True)
        # 吃到，从而实现多副本热更新不重启。
        try:
            from chayuan.server.config_center import make_yaml_sync_callback
            from chayuan.settings import CHAYUAN_ROOT as _R
            from pathlib import Path as _P

            register_callback(
                "tool_settings",
                make_yaml_sync_callback("tool_settings",
                                         _P(_R) / "tool_settings.yaml"),
            )
            register_callback(
                "prompt_settings",
                make_yaml_sync_callback("prompt_settings",
                                         _P(_R) / "prompt_settings.yaml"),
            )
            # P2 / P3
            register_callback(
                "kb_settings",
                make_yaml_sync_callback("kb_settings",
                                         _P(_R) / "kb_settings.yaml"),
            )
            register_callback(
                "model_settings",
                make_yaml_sync_callback("model_settings",
                                         _P(_R) / "model_settings.yaml"),
            )
        except Exception as _e:  # noqa: BLE001
            import logging
            logging.getLogger("chayuan.config_center").warning(
                "P1 迁移反向同步注册失败：%r", _e,
            )

        start_background_subscriber()

    @app.on_event("shutdown")
    async def _config_center_detach() -> None:
        try:
            from chayuan.server.config_center import stop_background_subscriber
            stop_background_subscriber()
        except Exception:  # noqa: BLE001
            pass

    # RapidOCR sidecar 自动拉起 — 此前 OCR 必须用户手动在 UI 点启动,导致首次
    # 上传图就拿 503 "OCR sidecar not ready"。chayuan-server 起来时一并拉起,
    # 用户感知一致 — 装了就能用,跟 chat/embedding 等 5 个 capability 一样。
    # 用户可在「设置 → 本地模型服务」关闭 auto_start 开关,关闭后跳过此 hook;
    # spawn 是 daemon 模式 + 日志重定向到 _bg_log_path,主进程不阻塞。
    #
    # 用户反馈:`服务启动后 OCR 没有自动启动`。可见性是首要问题 —— 默认 True、
    # 代码链路无 bug,但用户根本看不到 hook 跑没跑。这里改成 `print` 直接到
    # stdout,Tauri sidecar / 直接 uvicorn run 都可见;同时把 settings 文件路径 +
    # 当前值 + 启动结果 + log_path 一起打,任何状态都好排查。
    @app.on_event("startup")
    async def _auto_start_rapidocr() -> None:
        import logging as _logging
        import sys as _sys
        log = _logging.getLogger("chayuan.startup")

        def _say(msg: str) -> None:
            """同时走 logger 和 stdout —— 避免依赖 logging handler 配置。"""
            log.info("[auto-start-rapidocr] %s", msg)
            try:
                print(f"[auto-start-rapidocr] {msg}", flush=True, file=_sys.stdout)
            except Exception:  # noqa: BLE001
                pass

        try:
            import asyncio as _asyncio
            from chayuan.server.modality.rapidocr_lifecycle import (
                get_auto_start, start_ocr_sidecar,
            )
            from chayuan.server.runtime.auto_start_store import _settings_path

            try:
                cfg_p = _settings_path()
                cfg_exists = cfg_p.is_file()
                _say(f"settings={cfg_p} exists={cfg_exists}")
            except Exception as _e:  # noqa: BLE001
                _say(f"settings 路径解析失败:{_e!r}")

            flag = get_auto_start()
            _say(f"hook 触发 auto_start=rapidocr → {flag}")
            if not flag:
                _say(
                    "已被用户显式关闭,跳过 — 在「设置 → 本地模型服务」可手动"
                    "重新打开,或删除 sidecar_settings.json 让默认 True 生效"
                )
                return
            # 放到线程池跑,避免 spawn + TCP probe 阻塞 startup event loop
            status = await _asyncio.to_thread(start_ocr_sidecar)
            _say(
                f"完成 state={status.get('state')} pid={status.get('pid')} "
                f"port={status.get('port')} listening={status.get('listening')} "
                f"log={status.get('log_path')}"
            )
            if status.get("state") != "ready":
                _say(
                    f"启动后状态非 ready — 看 {status.get('log_path')} 排查;"
                    f"也可在「设置 → 本地模型服务」点 OCR『重新启动』"
                )
        except Exception as e:  # noqa: BLE001
            log.exception(
                "[auto-start-rapidocr] failed (OCR 功能将不可用)"
            )
            try:
                print(
                    f"[auto-start-rapidocr] FAILED: {type(e).__name__}: {e}",
                    flush=True, file=_sys.stderr,
                )
            except Exception:  # noqa: BLE001
                pass

    @app.on_event("shutdown")
    async def _auto_stop_rapidocr() -> None:
        try:
            import asyncio as _asyncio
            from chayuan.server.modality.rapidocr_lifecycle import stop_ocr_sidecar
            await _asyncio.to_thread(stop_ocr_sidecar)
        except Exception:  # noqa: BLE001
            pass

    # 5 个 capability sidecar 自动拉起 — 默认 False(老用户原本就手动起),
    # 用户在「设置 → 本地模型服务」打开 Switch 才在下次 startup 自动起。
    # 失败仅 log,不阻塞其它 capability(单 capability 装不全是常态)。
    @app.on_event("startup")
    async def _auto_start_capabilities() -> None:
        try:
            from chayuan.server.runtime.auto_start_store import get as get_auto
            from chayuan.server.model_registry.local_runtime_registry import (
                LocalRuntimeRegistry, get_registry,
            )
        except Exception:  # noqa: BLE001
            import logging as _logging
            _logging.getLogger("chayuan.startup").exception(
                "[auto-start] import 失败,跳过 5 capability 自动拉起"
            )
            return
        import logging as _logging
        log = _logging.getLogger("chayuan.startup")
        reg = get_registry()
        for cap in LocalRuntimeRegistry.CAPABILITIES:
            if not get_auto(cap):
                continue
            try:
                log.info("[auto-start] %s auto_start=true,拉起", cap)
                await reg.get(cap).start()
            except Exception:  # noqa: BLE001
                log.exception("[auto-start] %s start failed (其它 capability 继续)", cap)

    # 其它接口
    app.post(
        "/other/completion",
        tags=["Other"],
        summary="要求llm模型补全(通过LLMChain)",
    )(completion)

    # 媒体文件
    app.mount("/media", StaticFiles(directory=Settings.basic_settings.MEDIA_PATH), name="media")

    # 项目相关图片
    img_dir = str(Settings.basic_settings.IMG_DIR)
    app.mount("/img", StaticFiles(directory=img_dir), name="img")

    # FastAPI instrument 必须在路由都注册后调用，否则部分 router 的 span 会漏
    try:
        from chayuan.server.observability import init_tracing
        init_tracing(app)
    except Exception:  # noqa: BLE001
        pass

    # NLTK 资源预下载(unstructured 解析 .rtf / .eml / .epub 等需要 punkt 等);
    # 失败只 warning,不影响启动 —— 纯 .txt / .md / .csv / .pdf 路径根本不依赖 NLTK
    try:
        from chayuan.server.file_rag.nltk_bootstrap import ensure_nltk_data
        ensure_nltk_data()
    except Exception:  # noqa: BLE001
        pass

    # N-1：注册内置检索插件（ColBERT 等）；import 失败不影响主服务启动
    try:
        from chayuan.server.file_rag.plugins import register_builtin_plugins
        register_builtin_plugins()
    except Exception:  # noqa: BLE001
        pass

    return app


def run_api(host, port, **kwargs):
    if kwargs.get("ssl_keyfile") and kwargs.get("ssl_certfile"):
        uvicorn.run(
            app,
            host=host,
            port=port,
            ssl_keyfile=kwargs.get("ssl_keyfile"),
            ssl_certfile=kwargs.get("ssl_certfile"),
        )
    else:
        uvicorn.run(app, host=host, port=port)


app = create_app()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        prog="langchain-ChatGLM",
        description="About langchain-ChatGLM, local knowledge based ChatGLM with langchain"
        " ｜ 基于本地知识库的 ChatGLM 问答",
    )
    parser.add_argument("--host", type=str, default="0.0.0.0")
    parser.add_argument("--port", type=int, default=62581)
    parser.add_argument("--ssl_keyfile", type=str)
    parser.add_argument("--ssl_certfile", type=str)
    # 初始化消息
    args = parser.parse_args()
    args_dict = vars(args)

    run_api(
        host=args.host,
        port=args.port,
        ssl_keyfile=args.ssl_keyfile,
        ssl_certfile=args.ssl_certfile,
    )
