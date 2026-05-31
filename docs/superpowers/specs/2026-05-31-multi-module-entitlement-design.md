# 多模块授权:次数制 + 每日配额 + 促销卡 + 多模块购买 设计

- 日期：2026-05-31
- 状态：设计待评审
- 涉及：`/work/website`(收款 + 签发 + 后台配置)、`/work/chayuan-desktop`(chayuan-server 验证/状态机 + chayuan-client 门控)
- 关联既有：时间制单机授权(serial/token,见 `2026-05-30-python-license-verification-design.md`)、referral 分享、pricing/buy 页

## 1. 目标

把现有"单一模块(video)+ 纯时间制"的授权,扩展成**全模块 + 时间制/次数制双维度 + 每日免费配额 + 促销卡 + 多模块购买**的体系。架构要求:模块化、代码复用(一套权益引擎)、高性能、多并发安全、跨平台、离线可用。

6 个可门控模块(app key):`kb`(知识库)、`chat`(聊天)、`img2txt`(图转文)、`audio2txt`(音转文)、`video`(视频生成)、`avatar`(数字人)。

## 2. 核心模型:权益引擎(chayuan-server,有状态)

> 关键认知:时间制是**无状态**(码里编到期日,纯函数验签);次数制是**有状态**(次数随用减少),必须本地维护可变余额并扣减。本设计新增"有状态"维度。

每台机器(指纹 fp)× 每模块 app,本地状态(落 `chayuan_root/license/entitlements/<app>.json`,tmp+rename 原子写):
```json
{
  "app": "video",
  "timeExpireAt": "2026-07-01T00:00:00.000Z",  // 时间制到期(续费叠加;无则 null)
  "counts": 0,                                   // 购买/赠送的次数余额
  "freeUsedToday": 0,                            // 今日已用免费次数
  "freeDate": "2026-05-31",                      // 今日日期(跨零点清零)
  "redeemedIds": ["<id>", ...],                  // 已核销码/卡 id(防同机重复输)
  "seenMax": 0                                   // 防回拨(epoch ms)
}
```

### 2.1 放行判定(consume,三级优先级)
用功能时调 `consume(app)`:
0. **免费模块**(后台定价="免费",`app ∈ free_modules`)→ **无条件放行,不门控/不扣**(短路,不读写状态)
1. `now < timeExpireAt` → **放行,不扣**(时间制有效=不限次)
2. 否则 `freeUsedToday < dailyFreeQuota[app]` → **放行,freeUsedToday += 1**
3. 否则 `counts > 0` → **放行,counts -= 1**
4. 否则 → **拦截**,返回 `{allowed:false, remainingFree:0, counts:0, timeExpireAt}` → 前端弹「买次数/续费/分享/输码」

每次 consume 前先做:跨零点重置(`freeDate != today` → `freeUsedToday=0, freeDate=today`)、防回拨(`now < seenMax - 1天` → 拒绝并标记)。

### 2.2 并发安全
chayuan-server 是单机 sidecar,但 consume 是读改写 → 用**进程内 app 级互斥锁**(`asyncio.Lock` per app)串行化同一 app 的 consume/redeem,避免并发下少扣/超发。状态文件原子写。高并发下锁粒度按 app 分,互不阻塞。

## 3. 统一「权益码」格式(代码复用核心)

三种码,**同一套引擎**,靠 `src` 区分来源:

| 码 | 形态 | 绑定 | 给什么 | 单次 |
|---|---|---|---|---|
| 时间制购买序列号(既有) | 25 位手输,HMAC 截断弱签名 | 购买机器指纹 | 时间(叠加) | 同机幂等(码定到期,重输无害) |
| **统一权益码**(新) | 较长串,**粘贴/扫码/导入**,Ed25519 强签名 | 购买码=绑指纹;促销卡=不绑 | 多 grant:次数 和/或 时间,可多模块 | 本机 id 去重 + 卡过期日 |

**统一权益码负载**(canonical JSON → base64url(payload).base64url(sig)):
```json
{
  "v": 1,                                  // 活跃密钥版本
  "id": "<16 hex 唯一>",                    // 防重放 + 在线回报键
  "src": "purchase|promo|share|gift",
  "mid": "<fp>" | null,                    // 购买码绑机器;促销卡为 null(任意机器)
  "cardExpireAt": "2026-12-31T...",        // 卡本身过期日(必须在此前核销)
  "grants": [
    {"app": "video", "kind": "time", "days": 30},
    {"app": "chat",  "kind": "count", "n": 100}
  ]
}
```
- 核销 redeem:验签 → 校 `cardExpireAt > now` → 校 `mid` 为 null 或等于本机 fp → 校 `id ∉ redeemedIds` → 逐 grant 入账(time 叠加到 timeExpireAt;count 累加 counts)→ 记 `id`。
- **离线可验**(Ed25519 仅公钥);**联网时**best-effort POST 回报(见 §6)。

> 时间制 25 位短码保留给"散户手输兜底";多模块/次数/促销卡一律走统一权益码(强签名、粘贴/扫码/导入)。

## 4. 购买入口(双路径)+ 商品清单(多模块)

桌面激活弹框(每个模块的门控都能打开)同时给:
1. **二维码**:内嵌本机指纹 → 手机扫 → 买页(`aidooo.com/buy?mid=<fp>`)。
2. **本机序列号(指纹)文本** + **购买地址 `aidooo.com/buy`**:任意设备打开买页 → **手输本机序列号(指纹)** → 进商品清单。

**买页 `/buy`**:
- 有 `?mid=`(扫码)→ 直接用;无 → 显示"输入本机序列号"输入框,校验 16-hex 后进清单。
- **商品清单**:后台配置的模块 × 档位,分两类:**时长档**(1天/月…)+ **次数档**(1次/5次/10次)。
- **购物车多选**:可单模块单档,也可多模块/多档加购 → 一笔订单。
- 支付成功 → 签发**一个统一权益码**(把购物车每项变成一个 grant)→ 页面展示码 + 复制 → 回桌面粘贴核销。(单档时间制可附带 25 位短码兼容路径。)

## 5. 后台(4 个配置区,均在 `/update`)

1. **产品/模块**:管理 6 模块(名称/图标/启用/**定价模式**/**每日免费次数** dailyFree;`chat` 的"次"=每日对话条数)。定价模式含 **免费**(整模块不门控,`free_modules`)/ 付费(走配额+次数+时间)。支持新增模块(app key + 元数据)。
2. **定价**:每模块两类档并存 —— 时长档(既有)+ **次数档(n 次,灵活价/原价折扣/推荐/图标/强调色)**。买页清单据此渲染。
3. **促销卡**(独立模块/tab):新建卡 → 多选模块 + 类型(次数/时间)+ 值 + **卡过期日** + 数量 → 批量生成统一权益码序列号 → 列表展示每张卡的**使用情况**(在线回报聚合:被几台机器核销、消耗多少)+ 作废开关。
4. **外观**:购买页外观(品牌/Logo/背景/强调色/副标题/页脚)从定价页内联**挪到右上角「外观设置」弹窗**。

## 6. 分享得次数 / 赠送 / 在线使用回报

- **分享得次数**:扩展现有 referral —— 分享链接被新机器首次激活 → 给分享者(或被邀人,按后台配置)发**次数**而非天数;单机累计封顶可配。产出统一权益码(src=share)。
- **赠送**:后台可对指定机器指纹直接赠次数/时间(入账或发一张统一权益码,src=gift)。
- **在线使用回报**(best-effort,仅可见性不做强校验):chayuan-server 联网时 POST `aidooo.com/api/promo/usage {id, mid, app, consumed, balance, ts}`;website 聚合到促销卡/订单后台。断网不影响本地核销与消耗。

## 7. 前端门控(泛化 + 6 模块接入)

- **模块注册表**:把现有只门控 video 的 `LicenseGate` 泛化 —— 每模块一个 `app` + 门控点;6 模块统一接入。
- **门控/状态条**:显示「今日剩余免费 X / 购买次数 Y / 到期 Z」+ 按钮(买次数 / 续费 / 分享 / 输码 / 导入卡)。
- **聊天框**:每发一条消息前 `consume('chat')`,顶部显示今日剩余;超额拦截。
- **激活弹框**(在既有基础上增强):二维码 + **本机序列号(指纹)** + **购买地址** + 码输入(25 位短码 或 粘贴长权益码)+ 导入卡文件 + 微信/支付宝官方 logo(已做)。
- 门控判定走本地 `consume`/`status`,跨平台(桌面 sidecar / 网页远程同一套 API)。

## 8. chayuan-server / website API

**chayuan-server `/api/v1/license/*`(新增/改):**
- `GET /status?app=` → 含 timeExpireAt/counts/remainingFree/dailyFree
- `POST /consume {app}` → 三级判定,返回 `{allowed, source:time|free|count, remainingFree, counts, timeExpireAt}`
- `POST /redeem {code}` → 统一权益码核销(多 grant);旧 `activate {serial}` 保留给 25 位短码
- `GET /entitlements` → 「我的权限」聚合(各模块状态 + 在线购买记录)
- `GET /buy-url?app=` → url + channels(已做)+ 本机指纹

**website(新增):**
- 产品/模块 config + 次数定价(扩 pricing)
- `/buy` 改造:mid 可选 + 手输指纹 + 商品清单多选购物车
- 签发统一权益码(多 grant);fulfill 叠加
- 促销卡 CRUD + 批量签发 + 使用聚合;`POST /api/promo/usage` 回报端点
- referral 赠 days→赠 counts;赠送端点

## 9. 安全 / 边界(诚实声明)

- 统一权益码用 Ed25519,**离线不可伪造**(只放公钥)。
- "一个序列号一台电脑只能用一次":本机 `redeemedIds` 去重 + 购买码 fp 绑定。
- 促销卡不绑机器(批量发卡场景)→ **跨机器重复使用**是 B(离线)固有边界,靠在线回报可见 + 后台作废兜底,不做离线强阻断。
- 25 位时间短码仍是 HMAC 截断弱签名(散户兜底,价值有限),不变。

## 10. 拆成 5 个实施计划(各自可独立跑/测,按序)

- **Plan A — 权益引擎 + 状态机(chayuan-server)**:状态存储 + 三级 consume + 统一权益码验签/多 grant 核销 + 旧短码兼容 + 每日清零 + 防回拨/防重放 + app 级锁 + API。黄金向量(与 website 签发字节兼容)。
- **Plan B — website 签发 + 商品清单 + 多模块购买**:模块/次数定价、买页改造(扫码 OR 手输指纹 + 多选购物车)、签发统一权益码 + fulfill 叠加。
- **Plan C — 促销卡 + 赠送 + 分享得次数 + 在线使用回报**:后台促销卡 CRUD/批量/使用聚合、referral→counts、赠送、回报端点 + 桌面回报器。
- **Plan D — 后台 UI**:外观设置弹窗(右上角)、产品/模块管理、每日免费配额、次数定价 UI。
- **Plan E — 前端门控泛化 + 6 模块接入 + 状态条 + 弹框增强 + 聊天计数**。

## 11. 非目标

- 不做账号体系/多租户(仍以机器指纹为身份)。
- 不做促销卡的离线跨机器强阻断(B 的固有取舍)。
- 不改既有时间制 25 位短码的格式与离线兼容。

## 12. 黄金向量(Plan A↔B 字节兼容)

统一权益码 canonical = `json.dumps(payload, sort_keys=True, separators=(",",":"))` → `base64url_nopad(json).base64url_nopad(ed25519_sig)`。Plan B(website 签发端)必须对同一 payload + 同一私钥产出**字节一致**的码。

- 测试私钥种子(seed,32B hex,**仅测试用**):`000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f`
- 公钥(hex):`03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8`
- payload:`{"v":1,"id":"a1b2c3d4e5f60718","src":"promo","mid":null,"cardExpireAt":"2026-12-31T00:00:00.000Z","grants":[{"app":"video","kind":"count","n":5},{"app":"chat","kind":"time","days":30}]}`
- 期望码 CODE:
  `eyJjYXJkRXhwaXJlQXQiOiIyMDI2LTEyLTMxVDAwOjAwOjAwLjAwMFoiLCJncmFudHMiOlt7ImFwcCI6InZpZGVvIiwia2luZCI6ImNvdW50IiwibiI6NX0seyJhcHAiOiJjaGF0IiwiZGF5cyI6MzAsImtpbmQiOiJ0aW1lIn1dLCJpZCI6ImExYjJjM2Q0ZTVmNjA3MTgiLCJtaWQiOm51bGwsInNyYyI6InByb21vIiwidiI6MX0._bqbnE6foxiC5JcRMmtn4zi6ZhYPxn82qaCR0JGjc2lpayt_qYmKBKr6HsQ28FKjngPwamqkRv7ojoQthdpnAg`
