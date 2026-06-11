/**
 * 反馈 API 客户端 — 直连 aidooo.com（买站后端），不经过本地 chayuan-server。
 *
 * 签名算法：HMAC-SHA256，canonical = `mid\napp\nts\nsha256hex(content)`
 * ts = Date.now() ms，window ±300000ms。
 * 请求头：x-cy-ts, x-cy-sig（lowercase hex）。
 *
 * 合规提示：本模块会向 aidooo.com 上报设备指纹（mid）、OS 信息、
 * 应用版本和用户输入内容；须在《隐私政策》中向用户告知。
 */

// ── 混淆的共享密钥（base64，运行时 atob 还原）──────────────────────────────
// 原文: cy-fb-sign-2026-7Qx9Kp2Vw8Lm4Zr
// 混淆：btoa("cy-fb-sign-2026-7Qx9Kp2Vw8Lm4Zr")
const _SK = 'Y3ktZmItc2lnbi0yMDI2LTdReDlLcDJWdzhMbTRacg==';

function _getSecret(): string {
  try {
    return atob(_SK);
  } catch {
    return '';
  }
}

// ── aidooo.com base（XOR 混淆，与 runtimeSync 风格一致）──────────────────
// 原文: aidooo.com，XOR 0x5a + base64
// node: Buffer.from('aidooo.com'.split('').map(c=>c.charCodeAt(0)^0x5a)).toString('base64')
// => OzM+NTU1dDk1Nw==（与 runtimeSync._H 相同域名，同一常量）
const _B = 'OzM+NTU1dDk1Nw==';
function _getAidoooBase(): string {
  try {
    const raw = atob(_B);
    let h = '';
    for (let i = 0; i < raw.length; i++) {
      h += String.fromCharCode(raw.charCodeAt(i) ^ 0x5a);
    }
    return `https://${h}`;
  } catch {
    return 'https://aidooo.com';
  }
}

// ── 工具函数 ────────────────────────────────────────────────────────────────

function hexEncode(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Hex(text: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return hexEncode(buf);
}

async function hmacSha256Hex(keyStr: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(keyStr),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', keyMaterial, enc.encode(message));
  return hexEncode(sig);
}

// ── 公共类型 ────────────────────────────────────────────────────────────────

export interface FeedbackAttachment {
  name: string;
  url: string;
  kind: 'image' | 'file';
  size: number;
}

export interface FeedbackGrant {
  serial: string;
  module: string;
  kind: 'count' | 'time';
  value: number;
}

export interface FeedbackItem {
  id: string;
  type: string;
  content: string;
  status: string;
  reply: string;
  repliedAt: string;
  createdAt: string;
  attachments: FeedbackAttachment[];
  grant: FeedbackGrant | null;
}

/** 反馈草稿（含本地 id，用于重试标识） */
export interface FeedbackDraft {
  localId: string;
  content: string;
  attachments?: FeedbackAttachment[];
  type?: string;
  savedAt: number;
}

// ── OS 信息（从 UA 解析，与 runtimeSync.detectSystem 逻辑对齐）──────────

function _detectSystem(): { os: string; osVer: string; arch: string } {
  let os = 'unknown';
  let osVer = '';
  let arch = '';
  try {
    const ua = navigator.userAgent || '';
    const win = ua.match(/Windows NT ([0-9.]+)/);
    const mac = ua.match(/Mac OS X ([0-9_]+)/);
    if (win) {
      os = 'windows';
      osVer = win[1] ?? '';
    } else if (mac) {
      os = 'macos';
      osVer = (mac[1] ?? '').replace(/_/g, '.');
    } else if (/Linux/.test(ua)) {
      os = 'linux';
    }
    if (/arm64|aarch64/i.test(ua)) arch = 'arm64';
    else if (/x64|Win64|WOW64|x86_64|amd64/i.test(ua)) arch = 'x64';
  } catch {
    /* 静默 */
  }
  return { os, osVer, arch };
}

// ── 签名 ────────────────────────────────────────────────────────────────────

/**
 * 生成 HMAC-SHA256 签名。
 * canonical = `mid + "\n" + app + "\n" + ts + "\n" + sha256hex(content)`
 * 返回 lowercase hex。
 */
export async function signFeedback(
  mid: string,
  app: string,
  ts: number,
  content: string,
): Promise<string> {
  const contentHash = await sha256Hex(content);
  const canonical = `${mid}\n${app}\n${ts}\n${contentHash}`;
  return hmacSha256Hex(_getSecret(), canonical);
}

// ── 上下文采集 ──────────────────────────────────────────────────────────────

/**
 * 采集反馈上下文：appVersion、os 信息、logJson。
 *
 * appVersion 来自 Vite define 注入的 __APP_VERSION__（构建时注入）；
 * 若无法访问（SSR / 测试环境）则回落到 '0.1.0'。
 *
 * logJson 尝试从本地诊断接口（diagnose.run）获取摘要；
 * 若请求失败（sidecar 未就绪 / 网络超时）静默降级为 UA + version。
 */
export async function collectFeedbackContext(): Promise<{
  appVersion: string;
  os: string;
  osVer: string;
  arch: string;
  logJson: string;
}> {
  // 版本：Vite define 注入；类型已在 apps/desktop 声明，此处用 any 兼容 packages 层
  const appVersion: string =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    typeof (globalThis as any).__APP_VERSION__ === 'string'
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).__APP_VERSION__
      : '0.1.0';

  const { os, osVer, arch } = _detectSystem();

  let logJson = '';
  try {
    // 动态 import 避免循环依赖（diagnose 也在同一 package）
    const { diagnose } = await import('./diagnose');
    const report = await diagnose.run();
    // 只摘要，不把完整大报告放到 feedback 里
    const summary = {
      timestamp: report.timestamp,
      platform: report.platform,
      python_version: report.python_version,
      chayuan_server_version: report.chayuan_server_version,
      summary: report.summary,
      failChecks: report.checks
        .filter((c) => c.severity === 'fail')
        .map((c) => ({ name: c.name, detail: c.detail })),
    };
    logJson = JSON.stringify(summary);
  } catch {
    // sidecar 未就绪时静默降级
    logJson = JSON.stringify({
      ua: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      appVersion,
      os,
      osVer,
      arch,
    });
  }

  return { appVersion, os, osVer, arch, logJson };
}

// ── 草稿（localStorage） ────────────────────────────────────────────────────

const DRAFT_KEY = 'cy_feedback_drafts';

export function saveFeedbackDraft(d: Omit<FeedbackDraft, 'localId' | 'savedAt'> & { localId?: string; savedAt?: number }): void {
  try {
    const drafts = loadFeedbackDrafts();
    const localId = d.localId ?? `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const entry: FeedbackDraft = { ...d, localId, savedAt: d.savedAt ?? Date.now() };
    const idx = drafts.findIndex((x) => x.localId === localId);
    if (idx >= 0) drafts[idx] = entry;
    else drafts.push(entry);
    localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts));
  } catch {
    /* localStorage 不可用时静默 */
  }
}

export function loadFeedbackDrafts(): FeedbackDraft[] {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as FeedbackDraft[]) : [];
  } catch {
    return [];
  }
}

export function clearFeedbackDraft(localId: string): void {
  try {
    const drafts = loadFeedbackDrafts().filter((d) => d.localId !== localId);
    localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts));
  } catch {
    /* 静默 */
  }
}

// ── 内部 fetch 封装（直连 aidooo，不走本地 client） ────────────────────────

async function _aidoooFetch(
  path: string,
  init: RequestInit,
  timeoutMs = 15_000,
): Promise<Response> {
  const base = _getAidoooBase();
  const url = `${base}${path}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException('timeout', 'TimeoutError')), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ── 指纹获取 ────────────────────────────────────────────────────────────────

/**
 * 获取设备指纹 mid。
 * 从本地 chayuan-server（/api/v1/license/fingerprint）获取。
 *
 * 注意：fingerprint 来自本地 sidecar 返回；格式由服务端决定。
 * 服务端当前实现为 16 位 hex（^[0-9a-fA-F]{16}$）。
 * 若格式不符，会在 submitFeedback 中记录日志但不阻塞提交。
 */
async function _getMid(): Promise<string> {
  try {
    const { licenseFingerprint } = await import('./license');
    const { fingerprint } = await licenseFingerprint();
    return fingerprint;
  } catch {
    // sidecar 未启动 / 超时，返回空串（服务端会校验）
    return '';
  }
}

// ── 主 API ──────────────────────────────────────────────────────────────────

/**
 * 提交用户反馈至 aidooo.com。
 *
 * 流程：
 *  1. 获取 mid（本地 sidecar 指纹）
 *  2. 采集系统上下文
 *  3. HMAC-SHA256 签名
 *  4. POST https://aidooo.com/api/feedback
 *
 * 离线失败时：自动 saveFeedbackDraft，并 throw Error（err.offline = true）。
 */
export async function submitFeedback(input: {
  content: string;
  attachments?: FeedbackAttachment[];
  type?: string;
}): Promise<{ ok: boolean; id: string; status: string }> {
  const mid = await _getMid();

  // 指纹格式警告（不阻塞）
  if (mid && !/^[0-9a-fA-F]{16}$/.test(mid)) {
    console.warn(
      `[feedback] fingerprint "${mid}" does not match ^[0-9a-fA-F]{16}$ — ` +
        'server may reject or accept with different validation rules.',
    );
  }

  const ctx = await collectFeedbackContext();
  const ts = Date.now();
  const app = 'desktop';
  const sig = await signFeedback(mid, app, ts, input.content);

  const body = JSON.stringify({
    mid,
    app,
    appName: '察元超级智能体',
    appVersion: ctx.appVersion,
    os: ctx.os,
    osVer: ctx.osVer,
    arch: ctx.arch,
    type: input.type ?? 'suggestion',
    content: input.content,
    attachments: input.attachments ?? [],
    logJson: ctx.logJson,
  });

  let res: Response;
  try {
    res = await _aidoooFetch('/api/feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'x-cy-ts': String(ts),
        'x-cy-sig': sig,
      },
      body,
    });
  } catch (e: unknown) {
    // 网络失败：保存草稿
    saveFeedbackDraft({ content: input.content, attachments: input.attachments, type: input.type });
    const err = new Error('反馈提交失败：网络不可用');
    (err as Error & { offline: boolean }).offline = true;
    throw err;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`反馈提交失败：HTTP ${res.status} — ${text}`);
  }

  return res.json() as Promise<{ ok: boolean; id: string; status: string }>;
}

/**
 * 上传反馈附件至 aidooo.com。
 * 返回可用于 FeedbackAttachment 的 { url, kind, size } 等信息。
 */
export async function uploadFeedbackAttachment(
  file: File | Blob,
  name: string,
  mime: string,
): Promise<FeedbackAttachment> {
  const mid = await _getMid();
  const ts = Date.now();
  const sig = await signFeedback(mid, 'desktop', ts, name);

  let res: Response;
  try {
    res = await _aidoooFetch('/api/feedback/upload', {
      method: 'POST',
      headers: {
        'Content-Type': mime,
        'x-filename': name,
        'x-cy-ts': String(ts),
        'x-cy-sig': sig,
      },
      body: file,
    });
  } catch (e: unknown) {
    throw new Error(`附件上传失败：网络不可用`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`附件上传失败：HTTP ${res.status} — ${text}`);
  }

  const result = (await res.json()) as { id: string; url: string; kind: 'image' | 'file'; size: number };
  return { name, url: result.url, kind: result.kind, size: result.size };
}

/**
 * 查询当前设备的历史反馈列表。
 * 失败时静默返回空数组。
 */
export async function listMyFeedback(): Promise<FeedbackItem[]> {
  try {
    const mid = await _getMid();
    if (!mid) return [];
    const ts = Date.now();
    const sig = await signFeedback(mid, 'desktop', ts, mid);
    const res = await _aidoooFetch(
      `/api/feedback?mid=${encodeURIComponent(mid)}`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'x-cy-ts': String(ts),
          'x-cy-sig': sig,
        },
      },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: FeedbackItem[] };
    return Array.isArray(data.items) ? data.items : [];
  } catch {
    return [];
  }
}

/**
 * 重试所有本地草稿。返回成功提交数量。
 */
export async function retryFeedbackDrafts(): Promise<number> {
  const drafts = loadFeedbackDrafts();
  if (drafts.length === 0) return 0;
  let count = 0;
  for (const draft of drafts) {
    try {
      await submitFeedback({
        content: draft.content,
        attachments: draft.attachments,
        type: draft.type,
      });
      clearFeedbackDraft(draft.localId);
      count++;
    } catch {
      /* 仍然离线，保留草稿 */
    }
  }
  return count;
}
