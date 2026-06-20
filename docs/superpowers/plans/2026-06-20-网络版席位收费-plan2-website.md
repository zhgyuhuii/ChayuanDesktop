# 网络版席位收费 — Plan 2：发码端（/work/website）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 website 新增「网络版」商品 + 席位档位，并用现有 Ed25519 私钥签发**部署席位令牌**（payload `{kind:'seat', maxUsers, fp, exp, durDays, oid}`），供 chayuan-server `verify_token` 离线验签。

**Architecture:** 新增独立 `server/license/seat.js`（`signSeatToken`，复用现有 `token.sign`），与短码体系平行。seat 令牌 payload 的 `fp` 字段 = 客户上报的部署指纹（与 server Plan 1 `activate_deployment_token` 的 `payload.fp` 校验对应）。pricing 新增 `kind:'seat'` 档（`_norm` 已透传，无需改核心）。发货时检测 seat 订单行 → 签部署令牌。

**Tech Stack:** Node.js (ESM), `node:crypto` (Ed25519), `node:test` + `node:assert/strict`。

**契约（与 Plan 1 server 对齐，务必一致）：** seat 令牌 payload = `{ v, kind:'seat', maxUsers:<int>, fp:<hex>, durDays:<int>, iat:<unix>, exp:<unix>, oid, src }`。server `activate_deployment_token` 校验 `kind==='seat'`、`fp===deployment_fingerprint`、`exp>now`、读 `maxUsers`。

**测试命令：** `cd /work/website && npm test`（跑 `server/__tests__/*.test.mjs`）。

---

## 文件结构

- **Create** `server/license/seat.js` — `signSeatToken()`，唯一职责：按部署指纹签 seat 令牌。
- **Create** `server/payment/seatFulfill.js` — `issueSeatTokenForOrder(order, cfg)`，从已支付订单签发部署令牌（自包含、可单测）。
- **Create** `server/__tests__/license-seat.test.mjs`、`server/__tests__/seat-fulfill.test.mjs`。
- **Modify** `server/data/license-pricing.json` — 加 `module:'web-seat'` 的 8 档席位定价。
- **Modify** `server/data/products.json` — 加「察元 AI 网络版」产品。
- **Modify** `server/payment/orderFlow.js:beginOrder` — 接受 `deployment_fp`（与 mid 互斥）。
- **Modify** `server/payment/fulfill.js:fulfillPaidOrder` — seat 订单分支调 `issueSeatTokenForOrder`。

---

## Task 1: seat.js — 签发部署令牌

**Files:**
- Create: `server/license/seat.js`
- Test: `server/__tests__/license-seat.test.mjs`

- [ ] **Step 1: 写失败测试**（roundtrip：自己签、用现有 `token.verify` 验，断言 payload 与 server 契约一致）

```javascript
// server/__tests__/license-seat.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { sign as signToken, verify as verifyToken } from '../license/token.js'
import { signSeatToken } from '../license/seat.js'

function genKeys() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
  return {
    priv: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    pub: publicKey.export({ type: 'spki', format: 'pem' }),
  }
}

test('signSeatToken 产出可被 token.verify 验通的 seat 令牌', () => {
  const { priv, pub } = genKeys()
  const now = new Date('2026-06-20T00:00:00Z')
  const token = signSeatToken(
    { maxUsers: 100, fp: 'a'.repeat(32), durDays: 365, orderId: 'o1', now, activeKeyId: 1 },
    priv,
  )
  const r = verifyToken(token, pub)
  assert.equal(r.valid, true)
  assert.equal(r.payload.kind, 'seat')
  assert.equal(r.payload.maxUsers, 100)
  assert.equal(r.payload.fp, 'a'.repeat(32))
  assert.equal(r.payload.durDays, 365)
  // exp = iat + durDays*86400
  assert.equal(r.payload.exp, r.payload.iat + 365 * 86400)
})

test('signSeatToken 拒绝非法 maxUsers', () => {
  const { priv } = genKeys()
  assert.throws(() =>
    signSeatToken({ maxUsers: 0, fp: 'a'.repeat(32), durDays: 365, orderId: 'o', now: new Date() }, priv),
  )
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /work/website && npm test`
Expected: FAIL（`Cannot find module '../license/seat.js'`）

- [ ] **Step 3: 写实现**

```javascript
// server/license/seat.js — 网络版部署席位令牌(Ed25519)。与短码体系平行。
import { sign as signToken } from './token.js'

const DAY_SEC = 86400

/**
 * 签发部署席位令牌。
 * @param {{maxUsers:number, fp:string, durDays:number, orderId:string, now?:Date|number, activeKeyId?:number}} o
 * @param {string} ed25519PrivateKeyPem
 * @returns {string} base64url(payload).base64url(sig)
 */
export function signSeatToken(o, ed25519PrivateKeyPem) {
  const maxUsers = Number(o.maxUsers)
  if (!Number.isInteger(maxUsers) || maxUsers <= 0) throw new Error(`bad maxUsers: ${o.maxUsers}`)
  if (!/^[0-9a-f]{16,64}$/i.test(o.fp || '')) throw new Error(`bad deployment fp: ${o.fp}`)
  const durDays = Number(o.durDays)
  if (!Number.isInteger(durDays) || durDays <= 0) throw new Error(`bad durDays: ${o.durDays}`)
  const nowMs = (o.now instanceof Date ? o.now : new Date(o.now ?? Date.now())).getTime()
  const iat = Math.floor(nowMs / 1000)
  const exp = iat + durDays * DAY_SEC
  const payload = {
    v: o.activeKeyId ?? 1, kind: 'seat', maxUsers, fp: o.fp,
    durDays, iat, exp, oid: o.orderId, src: 'purchase',
  }
  return signToken(payload, ed25519PrivateKeyPem)
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd /work/website && npm test`
Expected: PASS（license-seat.test.mjs 2 tests pass）

- [ ] **Step 5: 提交**（website 是独立仓，admin 可写则无需 sudo）

```bash
cd /work/website
git add server/license/seat.js server/__tests__/license-seat.test.mjs
git commit -m "feat(license): 网络版部署席位令牌 signSeatToken(Ed25519)"
```

---

## Task 2: 席位定价档（license-pricing.json）

**Files:**
- Modify: `server/data/license-pricing.json`
- Test: `server/__tests__/license-seat.test.mjs`（追加）

- [ ] **Step 1: 追加失败测试**（用 tmp `ADMIN_DATA_DIR` 隔离，断言 listTiers 透传 kind=seat + maxUsers）

```javascript
// 追加到 server/__tests__/license-seat.test.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

test('listTiers 返回 web-seat 档并保留 kind=seat / maxUsers', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cy-pricing-'))
  fs.writeFileSync(path.join(dir, 'license-pricing.json'), JSON.stringify({
    schemaVersion: 1,
    tiers: [
      { id: 'web-seat-100', module: 'web-seat', name: '100 用户/年', kind: 'seat',
        maxUsers: 100, days: 365, priceFen: 1980000, enabled: true, order: 3 },
    ],
  }))
  process.env.ADMIN_DATA_DIR = dir
  // 动态 import 保证读到新 env（pricing 模块在 import 时算 dataDir）
  const pricing = await import(`../payment/pricing.js?seat=${Date.now()}`)
  const tiers = pricing.listTiers('web-seat')
  assert.equal(tiers.length, 1)
  assert.equal(tiers[0].kind, 'seat')
  assert.equal(tiers[0].maxUsers, 100)
  delete process.env.ADMIN_DATA_DIR
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /work/website && npm test`
Expected: FAIL（若 pricing.js 在顶层固化 dataDir 导致 env 不生效，则改测试为直接构造 tier 数组验证 `_norm` 透传；以实际为准）

- [ ] **Step 3: 写实现** — 在 `server/data/license-pricing.json` 的 `tiers` 数组追加 8 档（默认 10 不售卖，从 20 起）

```json
{ "id": "web-seat-20",   "module": "web-seat", "name": "20 用户/年",   "desc": "网络版 20 用户授权(1年)",   "kind": "seat", "maxUsers": 20,   "days": 365, "priceFen": 398000,   "enabled": true, "order": 1 },
{ "id": "web-seat-50",   "module": "web-seat", "name": "50 用户/年",   "desc": "网络版 50 用户授权(1年)",   "kind": "seat", "maxUsers": 50,   "days": 365, "priceFen": 980000,   "enabled": true, "order": 2 },
{ "id": "web-seat-100",  "module": "web-seat", "name": "100 用户/年",  "desc": "网络版 100 用户授权(1年)",  "kind": "seat", "maxUsers": 100,  "days": 365, "priceFen": 1980000,  "enabled": true, "order": 3 },
{ "id": "web-seat-300",  "module": "web-seat", "name": "300 用户/年",  "desc": "网络版 300 用户授权(1年)",  "kind": "seat", "maxUsers": 300,  "days": 365, "priceFen": 5580000,  "enabled": true, "order": 4 },
{ "id": "web-seat-500",  "module": "web-seat", "name": "500 用户/年",  "desc": "网络版 500 用户授权(1年)",  "kind": "seat", "maxUsers": 500,  "days": 365, "priceFen": 8800000,  "enabled": true, "order": 5 },
{ "id": "web-seat-1000", "module": "web-seat", "name": "1000 用户/年", "desc": "网络版 1000 用户授权(1年)", "kind": "seat", "maxUsers": 1000, "days": 365, "priceFen": 16800000, "enabled": true, "order": 6 },
{ "id": "web-seat-3000", "module": "web-seat", "name": "3000 用户/年", "desc": "网络版 3000 用户授权(1年)", "kind": "seat", "maxUsers": 3000, "days": 365, "priceFen": 46800000, "enabled": true, "order": 7 },
{ "id": "web-seat-5000", "module": "web-seat", "name": "5000 用户/年", "desc": "网络版 5000 用户授权(1年)", "kind": "seat", "maxUsers": 5000, "days": 365, "priceFen": 75000000, "enabled": true, "order": 8 }
```

> 注：`license-pricing.json` 缺失时由 `loadAll()` 用 SEED 重建——若仓库无此文件，改为在 `pricing.js` 的 `DEFAULT_TIERS` 增加 `'web-seat'` 条目（与现有产品同款）。价格为占位，由运营在 `pricing-admin-routes` 后台调整。

- [ ] **Step 4: 运行确认通过**

Run: `cd /work/website && npm test`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
cd /work/website
git add server/data/license-pricing.json server/__tests__/license-seat.test.mjs
git commit -m "feat(pricing): 网络版 web-seat 8 档席位定价(20…5000 用户/年)"
```

---

## Task 3: 网络版产品（products.json）

**Files:**
- Modify: `server/data/products.json`
- Test: `server/__tests__/seat-product.test.mjs`

- [ ] **Step 1: 写失败测试**

```javascript
// server/__tests__/seat-product.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

test('products 含 chayuan-web 网络版', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cy-prod-'))
  fs.copyFileSync(
    path.join(process.cwd(), 'server/data/products.json'),
    path.join(dir, 'products.json'),
  )
  process.env.ADMIN_DATA_DIR = dir
  const products = await import(`../server/products.js?p=${Date.now()}`)
  const all = products.getProducts()
  assert.ok(all.some((p) => p.slug === 'chayuan-web'), 'should contain chayuan-web product')
  delete process.env.ADMIN_DATA_DIR
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /work/website && npm test`
Expected: FAIL（无 chayuan-web）

- [ ] **Step 3: 写实现** — 在 `server/data/products.json` 的产品数组追加

```json
{ "slug": "chayuan-web", "displayName": "察元 AI 网络版", "tagline": "多用户协作 · 私有部署 · 按席位授权", "license": "商用许可", "icon": "fas fa-cloud", "isBuiltin": false, "visible": true, "order": 2, "createdAt": "2026-06-20T00:00:00.000Z" }
```

> 若 products.js 路径解析与上面测试不符（agent 报告 `getProducts()` 在 `server/products.js:95`），按实际 import 路径调整测试的 import；产品数据字段以现有条目为准。

- [ ] **Step 4: 运行确认通过**

Run: `cd /work/website && npm test`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
cd /work/website
git add server/data/products.json server/__tests__/seat-product.test.mjs
git commit -m "feat(product): 新增察元 AI 网络版产品"
```

---

## Task 4: 订单收 deployment_fp + 发货签部署令牌

**Files:**
- Create: `server/payment/seatFulfill.js`
- Modify: `server/payment/orderFlow.js`（`beginOrder` 接受 `deployment_fp`）
- Modify: `server/payment/fulfill.js`（`fulfillPaidOrder` seat 分支）
- Test: `server/__tests__/seat-fulfill.test.mjs`

- [ ] **Step 1: 写失败测试**（自包含测 `issueSeatTokenForOrder`）

```javascript
// server/__tests__/seat-fulfill.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { verify as verifyToken } from '../license/token.js'
import { issueSeatTokenForOrder } from '../payment/seatFulfill.js'

test('issueSeatTokenForOrder 对 seat 单签出可验部署令牌', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
  const priv = privateKey.export({ type: 'pkcs8', format: 'pem' })
  const pub = publicKey.export({ type: 'spki', format: 'pem' })
  const order = {
    id: 'order-1', deploymentFp: 'b'.repeat(32),
    lines: [{ module: 'web-seat', tierId: 'web-seat-100' }],
  }
  const cfg = {
    license: { ed25519PrivateKeyPem: priv, activeKeyId: 1 },
    tierResolver: () => ({ kind: 'seat', maxUsers: 100, days: 365 }),
  }
  const res = issueSeatTokenForOrder(order, cfg, new Date('2026-06-20T00:00:00Z'))
  assert.equal(res.kind, 'seat')
  const r = verifyToken(res.token, pub)
  assert.equal(r.valid, true)
  assert.equal(r.payload.kind, 'seat')
  assert.equal(r.payload.maxUsers, 100)
  assert.equal(r.payload.fp, 'b'.repeat(32))
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /work/website && npm test`
Expected: FAIL（`Cannot find module '../payment/seatFulfill.js'`）

- [ ] **Step 3: 写实现**

```javascript
// server/payment/seatFulfill.js — 网络版 seat 订单发货:签部署令牌(不走短码)。
import { signSeatToken } from '../license/seat.js'
import { getTier as defaultGetTier } from './pricing.js'

/**
 * @param {{id:string, deploymentFp:string, lines:Array<{module:string,tierId:string}>}} order
 * @param {{license:{ed25519PrivateKeyPem:string,activeKeyId?:number}, tierResolver?:Function}} cfg
 * @param {Date|number} [now]
 * @returns {{kind:'seat', token:string, maxUsers:number, expireAt:string}}
 */
export function issueSeatTokenForOrder(order, cfg, now = Date.now()) {
  const getTier = cfg.tierResolver || ((module, id) => defaultGetTier(module, id))
  const line = (order.lines || []).find((l) => {
    const t = getTier(l.module, l.tierId)
    return t && t.kind === 'seat'
  })
  if (!line) throw new Error('no seat line in order')
  const tier = getTier(line.module, line.tierId)
  if (!order.deploymentFp) throw new Error('seat order missing deploymentFp')
  const durDays = Number(tier.days) || 365
  const token = signSeatToken(
    { maxUsers: tier.maxUsers, fp: order.deploymentFp, durDays, orderId: order.id, now,
      activeKeyId: cfg.license.activeKeyId ?? 1 },
    cfg.license.ed25519PrivateKeyPem,
  )
  const expMs = (now instanceof Date ? now : new Date(now)).getTime() + durDays * 86400000
  return { kind: 'seat', token, maxUsers: tier.maxUsers, expireAt: new Date(expMs).toISOString() }
}

/** 订单是否为 seat 订单(任一行的档位 kind==='seat')。 */
export function isSeatOrder(order, getTier = defaultGetTier) {
  return (order?.lines || []).some((l) => {
    const t = getTier(l.module, l.tierId)
    return t && t.kind === 'seat'
  })
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd /work/website && npm test`
Expected: PASS

- [ ] **Step 5: 接线（读现有大文件后精确放置）**

在 `server/payment/orderFlow.js:beginOrder`（约 33-64 行，收 mid/devices 处）追加：解析 `req.body.deployment_fp`，校验 `/^[0-9a-f]{16,64}$/i`，与 mid/devices **互斥**；存入 order（字段 `deploymentFp`）。seat 订单金额取所选 seat tier 的 `priceFen`。

在 `server/payment/fulfill.js:fulfillPaidOrder`（13 行）**入口处**加分支：
```javascript
import { isSeatOrder, issueSeatTokenForOrder } from './seatFulfill.js'
// ... 在 markPaid 之后、现有 issueLicense 循环之前:
if (isSeatOrder(order)) {
  const seat = issueSeatTokenForOrder(order, cfg)
  orders.attachLicense(order.id, { deploymentToken: seat.token, kind: 'seat',
    maxUsers: seat.maxUsers, expireAt: seat.expireAt })
  // seat 订单不进 per-device 短码循环
  return { ok: true, kind: 'seat' }
}
```

- [ ] **Step 6: 回归 + 提交**

```bash
cd /work/website && npm test   # 全绿
git add server/payment/seatFulfill.js server/payment/orderFlow.js \
  server/payment/fulfill.js server/__tests__/seat-fulfill.test.mjs
git commit -m "feat(payment): seat 订单收 deployment_fp + 发货签部署令牌(不走短码)"
```

---

## 自检

1. **Spec 覆盖**：§4 商品→Task3；席位档→Task2；令牌签发→Task1；签发编排→Task4；下单收 deployment_fp→Task4。
2. **契约一致**：seat payload `{v,kind:'seat',maxUsers,fp,durDays,iat,exp,oid,src}` 与 Plan 1 server `activate_deployment_token`（校 `kind/fp/exp`、读 `maxUsers`）字段名逐一对应。
3. **占位符**：核心新模块 `seat.js`/`seatFulfill.js` 全代码；Task4 Step5 接线点给真实函数名 + 锚点行号，由执行者读现有大文件后放置。
4. **类型一致**：`signSeatToken`/`issueSeatTokenForOrder`/`isSeatOrder` 跨 Task 命名一致。

## 执行约束

- website 是**独立仓** `/work/website`，分支与提交目标见该仓约定；admin 通常可写（如遇 root 拥有则 sudo）。
- 价格 `priceFen` 为占位，运营在后台 `pricing-admin-routes` 调整，不在本计划。
