"""快手 Kling 可灵 文生/图生视频 Connector — JWT(ak/sk) 鉴权，异步轮询。

api_key 字段约定填 "<AccessKey>:<SecretKey>"（英文冒号分隔）。
有图片附件时自动走图生视频(I2V)，否则走文生视频(T2V)。

# 实测验证(2026-06-07,用真 ak/sk 打 api-beijing.klingai.com):
#   ✅ host=api-beijing.klingai.com(国内站;国际密钥用 api.klingai.com)
#   ✅ JWT 鉴权(HS256, iss=ak, exp/nbf, Authorization: Bearer)—— 鉴权通过(返回 429 余额不足而非 Auth failed)
#   ✅ 提交 endpoint /v1/videos/text2video 与 /v1/videos/image2video(返回 429 计费,非 404 → 路径对)
#   ✅ 轮询 endpoint GET /v1/videos/{kind}/{task_id}(返回 1201 "Task not found by id" → 路径对)
#   ⏳ 成功响应字段(data.task_id / data.task_status / task_result.videos[].url / 状态串 succeed)
#      因账户余额不足跑不出真实成功任务,暂按官方 spec 实现,待充值后跑通一条确认。
"""

from __future__ import annotations

import base64
import time
from typing import Dict, Tuple

import jwt

from chayuan.server.modality.router.artifacts import find_by_filename
from chayuan.server.modality.router.connectors.base import register
from chayuan.server.modality.router.connectors.video_gen.base_async import (
    AsyncPollVideoConnector,
    PollResult,
    PollStatus,
)
from chayuan.server.modality.router.protocol import Capability, GenerateReq

# 国内站 host(实测 2026-06-07):中国大陆申请的 ak/sk 属于北京站 api-beijing.klingai.com;
# 国际站 api.klingai.com 会对国内密钥报 "Auth failed"(签名其实是对的,只是 host 不匹配)。
# 国际用户可在厂商配置里把 api_base 改成 https://api.klingai.com 或 api-singapore.klingai.com。
_DEFAULT_BASE = "https://api-beijing.klingai.com"
# 旧默认值(国际站):已存的配置里若是这些,自愈成 _DEFAULT_BASE(见 _base)。
_STALE_DEFAULT_BASES = {
    "https://api.klingai.com",
    "http://api.klingai.com",
    "api.klingai.com",
}

# TODO(P2-verify): 确认 KlingAI 官方状态字符串（submitted/processing/pending/succeed/failed）
_RUNNING_STATUSES = {"submitted", "processing", "pending"}


# ──────────────────────────────────────────────────────────────
# JWT 鉴权工具（PyJWT 2.8，HS256）
# ──────────────────────────────────────────────────────────────


def _kling_jwt(ak: str, sk: str) -> str:
    """用 AccessKey/SecretKey 生成 KlingAI JWT token。

    payload: iss=ak, exp=now+1800, nbf=now-5
    算法: HS256，有效期 30 分钟，提前 5 秒生效（容时钟漂移）。
    """
    now = int(time.time())
    payload = {
        "iss": ak,
        "exp": now + 1800,
        "nbf": now - 5,
    }
    # PyJWT 2.x encode() 返回 str
    return jwt.encode(
        payload,
        sk,
        algorithm="HS256",
        headers={"alg": "HS256", "typ": "JWT"},
    )


def _split_keys(api_key: str) -> Tuple[str, str]:
    """从 "<AccessKey>:<SecretKey>" 格式拆出 (ak, sk)。

    如果 api_key 中无冒号，则整体当作 ak，sk 为空字符串。
    """
    key = api_key or ""
    if ":" in key:
        ak, sk = key.split(":", 1)
        return ak.strip(), sk.strip()
    return key.strip(), ""


def _resolve_image_field(a) -> str:
    """把图片附件解析成 Kling I2V 的 ``image`` 字段值(纯 base64 或公网 URL)。

    Kling 的 image 字段只接受【纯 base64 编码】或【可公网访问的 URL】。桌面流里
    附件被 openai_routes 存成本地 artifact,``a.url`` = ``/v1/artifacts/<文件名>``
    —— 既不是公网 URL(Kling 访问不到 localhost),直接当字符串发又会被当 base64
    解码失败(报 "File is not in a valid base64 format")。这里读本地文件转纯 base64。
    """
    # 1) 内存 bytes 兜底(当前 openai_routes 走 artifact,保留以防未来直传)
    raw = getattr(a, "data", None)
    if raw:
        return base64.b64encode(raw).decode("ascii")
    url = (getattr(a, "url", "") or "").strip()
    # 2) data URI:data:image/png;base64,XXXX → 取逗号后的纯 base64
    if url.startswith("data:"):
        return url.split(",", 1)[-1]
    # 3) /v1/artifacts/<filename> 本地 artifact → 读盘转纯 base64
    if "/v1/artifacts/" in url:
        fn = url.rsplit("/", 1)[-1].split("?", 1)[0]
        p = find_by_filename(fn)
        if p and p.exists():
            return base64.b64encode(p.read_bytes()).decode("ascii")
    # 4) 公网 http(s) URL → Kling 支持直接传 URL,原样给
    # 5) 其它(可能已是裸 base64)→ 原样
    return url


# ──────────────────────────────────────────────────────────────
# Connector
# ──────────────────────────────────────────────────────────────


@register(Capability.T2V, "kling")
class KlingVideoConnector(AsyncPollVideoConnector):
    """KlingAI 文生/图生视频连接器（继承 AsyncPollVideoConnector 基类）。

    使用方：在模型平台配置中：
      - platform_type: kling
      - api_key: <AccessKey>:<SecretKey>（英文冒号连接）
      - api_base: https://api.klingai.com（可留空，用默认值）
      - model: kling-v2-5-turbo 或其它 Kling 视频模型
    """

    poll_interval_s: float = 5.0
    poll_timeout_s: float = 600.0

    # ── 内部工具 ──

    def _base(self, req: GenerateReq) -> str:
        """提取并规范化 api_base，去除尾斜杠，空则用默认值。

        自愈:老配置里 api_base 存的是旧默认 ``api.klingai.com``(国际站,国内 ak/sk 在
        这上面会 401 Auth failed)。实测国内密钥只在 ``api-beijing.klingai.com`` 有效,
        所以把旧的国际站默认值视同"未配置",改用北京站默认 —— 用户不必手动改已存的配置。
        真要用国际站,填 ``api-singapore.klingai.com`` 等非 ``api.klingai.com`` 的值即可。
        """
        base = (req.api_base or "").rstrip("/")
        if not base or base in _STALE_DEFAULT_BASES:
            return _DEFAULT_BASE
        return base

    def _auth_headers(self, req: GenerateReq) -> Dict[str, str]:
        """构造含 JWT Bearer token 的请求头。"""
        ak, sk = _split_keys(req.api_key)
        token = _kling_jwt(ak, sk)
        return {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }

    def _is_i2v(self, req: GenerateReq) -> bool:
        """判断是否图生视频：req.attachments 中有 image/* 附件。"""
        return any(
            (getattr(a, "mime", "") or "").startswith("image/")
            for a in (req.attachments or [])
        )

    def _video_kind(self, req: GenerateReq) -> str:
        """返回 'image2video' 或 'text2video'。"""
        return "image2video" if self._is_i2v(req) else "text2video"

    # ── 4 个钩子 ──

    def build_submit(
        self, req: GenerateReq
    ) -> Tuple[str, Dict[str, str], Dict]:
        """构造提交请求 (url, headers, body)。

        T2V: POST {base}/v1/videos/text2video
        I2V: POST {base}/v1/videos/image2video，body 含 image=附件url

        # TODO(P2-verify): 以 KlingAI 当前官方文档核对 endpoint 路径、body 字段名称
        # TODO(P2-verify): 确认 I2V 是否用 image_url 字段而非 image
        # TODO(P2-verify): 确认 duration 单位（秒 or 毫秒）及合法值范围
        # TODO(P2-verify): 确认 aspect_ratio 合法值（"16:9"/"9:16"/"1:1" 等）
        # TODO(P2-verify): 确认 mode 字段含义（"std"/"pro" 等）
        """
        params = req.params or {}
        kind = self._video_kind(req)
        url = f"{self._base(req)}/v1/videos/{kind}"  # TODO(P2-verify): endpoint 路径

        body: Dict = {
            "model_name": req.model,
            "prompt": req.prompt,
        }

        # I2V：把第一个图片附件解析成 Kling 要的 image 字段(纯 base64 或公网 URL)
        if self._is_i2v(req):
            for a in req.attachments or []:
                if (getattr(a, "mime", "") or "").startswith("image/"):
                    body["image"] = _resolve_image_field(a)
                    break

        # 可选参数 —— Kling 对取值有严格白名单,这里规范化,避免前端传非法值撞 400
        # (如前端时长默认 2 → Kling 报 "duration value '2' is invalid")。
        # 非法/未提供的项一律不传,让 Kling 用自己的默认值。
        dur = params.get("duration")
        if dur is not None:
            try:
                n = int(float(str(dur)))
            except (TypeError, ValueError):
                n = 5
            body["duration"] = "5" if n <= 5 else "10"  # Kling 只接受 5 或 10 秒

        ar = params.get("aspect_ratio")
        if ar in ("16:9", "9:16", "1:1"):
            body["aspect_ratio"] = ar

        mode = params.get("mode")
        if mode in ("std", "pro"):
            body["mode"] = mode

        neg = params.get("negative_prompt")
        if neg:
            body["negative_prompt"] = str(neg)

        headers = self._auth_headers(req)
        return url, headers, body

    def parse_submit(self, resp_json: Dict) -> str:
        """从提交响应中解析 upstream task_id。

        KlingAI 响应格式（参考）:
          {"code": 0, "message": "Success", "data": {"task_id": "...", ...}}

        # TODO(P2-verify): 确认 task_id 字段层级是否为 data.task_id
        """
        return ((resp_json or {}).get("data") or {}).get("task_id") or ""  # TODO(P2-verify)

    def build_poll(
        self, req: GenerateReq, task_id: str
    ) -> Tuple[str, Dict[str, str]]:
        """构造轮询请求 (url, headers)。

        KlingAI 轮询端点（参考）:
          GET {base}/v1/videos/{text2video|image2video}/{task_id}

        # TODO(P2-verify): 确认轮询 endpoint 是否需要区分 text2video vs image2video
        # TODO(P2-verify): 确认轮询无需 body，只 GET + JWT 头
        """
        kind = self._video_kind(req)
        url = f"{self._base(req)}/v1/videos/{kind}/{task_id}"  # TODO(P2-verify)
        return url, self._auth_headers(req)

    def parse_poll(self, resp_json: Dict) -> PollResult:
        """将轮询响应解析为标准化 PollResult。

        KlingAI 响应格式（参考）:
          {
            "code": 0,
            "data": {
              "task_id": "...",
              "task_status": "processing" | "succeed" | "failed" | "submitted" | "pending",
              "task_status_msg": "错误描述（失败时）",
              "task_result": {
                "videos": [{"id": "...", "url": "...", "duration": "5"}]
              }
            }
          }

        状态映射:
          succeed                           → SUCCEEDED（取 data.task_result.videos[].url）
          failed                            → FAILED（错误信息取 data.task_status_msg）
          submitted / processing / pending  → RUNNING
          其它                              → UNKNOWN

        # TODO(P2-verify): 以 KlingAI 当前官方文档核对状态字符串枚举值
        # TODO(P2-verify): 确认 succeed 拼写（非 succeeded）
        # TODO(P2-verify): 确认视频 URL 字段路径（task_result.videos[].url）
        # TODO(P2-verify): 确认失败时错误信息字段名（task_status_msg）
        """
        data = (resp_json or {}).get("data") or {}
        st = (data.get("task_status") or "").lower()  # TODO(P2-verify): 状态字符串

        if st == "succeed":  # TODO(P2-verify): KlingAI 用 "succeed" 非 "succeeded"
            task_result = data.get("task_result") or {}
            videos = task_result.get("videos") or []
            video_urls = [v.get("url") for v in videos if v.get("url")]
            return PollResult(status=PollStatus.SUCCEEDED, video_urls=video_urls)

        if st == "failed":  # TODO(P2-verify): 失败状态字符串
            error_msg = data.get("task_status_msg") or "Kling 视频生成失败"  # TODO(P2-verify)
            return PollResult(status=PollStatus.FAILED, error_message=error_msg)

        if st in _RUNNING_STATUSES:  # TODO(P2-verify): 进行中状态字符串集合
            return PollResult(status=PollStatus.RUNNING)

        return PollResult(status=PollStatus.UNKNOWN)
