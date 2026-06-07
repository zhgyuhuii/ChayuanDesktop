"""内嵌授权验证物料:环境/数据目录缺失时的兜底真源,避免 frozen 打包后因
CHAYUAN_ROOT / license_settings.yaml 路径或 env 缺位导致 unknown-key / no-module。
hmac 为对称密钥,经用户显式同意写入源码;仓库须私有,轮换需同步改此处并重打桌面。
products 必须与服务端 modules.js 当前位图一致。"""

EMBEDDED = {
    "hmac_key_v1": "c639c67cfbc8ceef0efbae305db1ab62d06aecacdc9956a55aa5ab4971b8c471",
    "ed25519_public_key": "c8366a17bc0aa51e4aedc45b61ba213324b821c1580d0139dc74377f01df2715",
    "active_key_id": 1,
    "buy_base_url": "https://aidooo.com",
    "products": {"video": 0, "chat": 1, "kb": 2, "avatar": 3, "ocr": 4, "asr": 5, "note": 6, "wps": 7, "video_edit": 8},
}
