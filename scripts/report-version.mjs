#!/usr/bin/env node
/**
 * 把本项目(察元AI超级智能体 / chayuan-desktop)的当前版本自动上报给官网。
 * 官网落库到 reportedVersions.desktop,首页据此显示真实版本(无需手填、无需写死)。
 *
 * 用法(发布 / CI 时执行):
 *   CHAYUAN_REPORT_URL=https://aidooo.com \
 *   CHAYUAN_REPORT_TOKEN=<与官网服务端 CHAYUAN_REPORT_TOKEN 一致的密钥> \
 *   node scripts/report-version.mjs
 *
 * 版本来源:apps/desktop/src-tauri/tauri.conf.json 的 version 字段。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const tauriConfPath = join(__dirname, '..', 'chayuan-client', 'apps', 'desktop', 'src-tauri', 'tauri.conf.json')
const conf = JSON.parse(readFileSync(tauriConfPath, 'utf8'))
const version = conf.version || (conf.package && conf.package.version)
if (!version) { console.error('[report-version] 未能从 tauri.conf.json 读到 version,跳过'); process.exit(0) }

const base = (process.env.CHAYUAN_REPORT_URL || 'https://aidooo.com').replace(/\/+$/, '')
const token = process.env.CHAYUAN_REPORT_TOKEN
if (!token) { console.error('[report-version] 缺少 CHAYUAN_REPORT_TOKEN 环境变量,跳过上报'); process.exit(0) }

const url = `${base}/api/version/report`
try {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Report-Token': token },
    body: JSON.stringify({ product: 'desktop', version })
  })
  const data = await res.json().catch(() => ({}))
  if (res.ok) console.log(`[report-version] OK desktop v${version} -> ${base}`)
  else { console.error(`[report-version] FAIL ${res.status}:`, data); process.exitCode = 1 }
} catch (e) { console.error('[report-version] ERROR:', e.message); process.exitCode = 1 }
