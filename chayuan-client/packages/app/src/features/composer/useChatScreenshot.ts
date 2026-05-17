/**
 * 截图 → 自动附到聊天输入框 的编排 hook。
 *
 * **架构定位**:
 * 唯一封装"截图按钮点击后到底发生什么"的编排层 —— 截屏能力(`platform.capture`)
 * 在 platform-tauri / platform-web 各自实现;附件管线(`useAttachments`)在 chat 域
 * 内;本 hook 是把这两条独立模块**只在 UI 触发那一刻**粘起来,谁也不依赖谁。
 *
 * **设计要点**:
 *   1. **单一职责**:本 hook 只做截图编排,不维护附件状态(交给 useAttachments)
 *      也不维护截图原生实现(交给 platform.capture)。
 *   2. **复用**:每个 composer 调用站(ConversationView / KbBoard / 文档助手…)只需
 *      `const shot = useChatScreenshot(attachments.addImages); <ChatComposer
 *      onScreenshot={shot.onScreenshot} />`,代码完全相同。
 *   3. **窗口让位**:Tauri 桌面端默认在截图前 minimize 主窗口 + 300ms 延迟,避
 *      免把察元自己截进去;截图完恢复焦点。可用 ``minimizeBefore: false`` 关掉。
 *   4. **并发护栏**:用 ref 守一个 in-flight 标记,用户连点不会触发多次截图;
 *      也提供 ``busy`` state 给 UI 显示 spinner。
 *   5. **能力探测**:`available` 表示当前 platform 是否支持截图;web 端 https
 *      + getDisplayMedia 可用时也 true。
 *   6. **错误兜底**:用户在 web 端取消"选屏"对话框 → DOMException AbortError /
 *      NotAllowedError,这两种情况静默(用户主动取消不是错);其它走 reportError。
 */
import * as React from 'react';
import { getPlatform } from '@chayuan/platform-shared';
import { reportError } from '../../store/errorDialog';

export interface UseChatScreenshotOptions {
  /** Tauri 端截图前是否先 minimize 主窗口避免自指。默认 true。 */
  minimizeBefore?: boolean;
  /** minimize 与截屏之间的等待毫秒数。Windows 任务栏动画约 250ms,300 安全。 */
  minimizeDelayMs?: number;
}

export interface ChatScreenshotApi {
  /** 截图能力是否可用(Tauri 端总是 true;web 端要求 https + getDisplayMedia) */
  available: boolean;
  /** in-flight 标记。UI 可拿来禁用按钮 / 显示 loading */
  busy: boolean;
  /** 触发截图;成功后通过传入的 addImages 注入附件 */
  onScreenshot: () => void;
}

const DEFAULT_MIN_DELAY_MS = 300;

export function useChatScreenshot(
  addImages: (files: File[]) => Promise<void>,
  opts: UseChatScreenshotOptions = {},
): ChatScreenshotApi {
  const minimizeBefore = opts.minimizeBefore ?? true;
  const minimizeDelayMs = opts.minimizeDelayMs ?? DEFAULT_MIN_DELAY_MS;

  // platform 在 module load 时初始化好;直接读
  const pal = getPlatform();
  // capture 是可选 API — Tauri 全提供,web 在 https + 浏览器支持时提供
  const available = typeof pal.capture?.screenshot === 'function'
    && (pal.kind === 'desktop' || (typeof navigator !== 'undefined'
        && !!navigator.mediaDevices?.getDisplayMedia));

  const [busy, setBusy] = React.useState(false);
  // 用 ref 兜底并发:setBusy 是异步的,连点两次时 state 还没刷新就进第二次
  const inFlightRef = React.useRef(false);

  const onScreenshot = React.useCallback(() => {
    if (!available) {
      reportError(new Error('当前环境不支持截图'),
        '截图不可用 — 桌面版请确认已正确启动,Web 版需 HTTPS + 现代浏览器');
      return;
    }
    if (inFlightRef.current) return;  // 并发守护
    inFlightRef.current = true;
    setBusy(true);

    // IIFE 异步:不让 onClick handler 返回 Promise(React 报警),也不阻塞渲染
    (async () => {
      // Tauri 端 minimize 让位,避免自指(把察元窗口截进去)
      const win = pal.window;
      const canMinimize = minimizeBefore && pal.kind === 'desktop' && typeof win?.minimize === 'function';
      try {
        if (canMinimize) {
          try { await win.minimize?.(); } catch { /* minimize 失败别阻塞,继续截 */ }
          await new Promise((r) => setTimeout(r, minimizeDelayMs));
        }
        // 不传 region — Tauri 实现固定走 fullscreen;web 让用户选
        const blob = await pal.capture!.screenshot();
        // 拼时间戳文件名(纯数字便于按时间排序)
        const ts = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const name = `screenshot-${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}.png`;
        const file = new File([blob], name, { type: blob.type || 'image/png' });
        await addImages([file]);
      } catch (e) {
        // 用户主动取消 web 端选屏对话框时浏览器抛 NotAllowedError / AbortError —
        // 这两种是"取消",不是 error,静默处理
        const name = (e instanceof DOMException) ? e.name : '';
        if (name !== 'NotAllowedError' && name !== 'AbortError') {
          reportError(e, '截图失败');
        }
      } finally {
        inFlightRef.current = false;
        setBusy(false);
        // Tauri 端 minimize 之后,截完不主动 unminimize —— 让用户看到"截图已注入"
        // 提示后自己点任务栏图标回来。原因:很多用户的工作流是"截完别的窗口再
        // 回来继续编辑",硬恢复反而打扰。如果用户反馈想自动恢复,改这里加
        // win.unminimize() 即可。
      }
    })();
  }, [available, addImages, minimizeBefore, minimizeDelayMs, pal]);

  return { available, busy, onScreenshot };
}
