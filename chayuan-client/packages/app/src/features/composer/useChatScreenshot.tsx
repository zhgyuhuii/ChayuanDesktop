/**
 * 截图 → 弹窗拖框选区 → 裁剪 → 自动附到聊天输入框 的编排 hook。
 *
 * **架构定位**:
 * 唯一封装"截图按钮点击后到底发生什么"的编排层 —— 截屏能力(`platform.capture`)
 * 在 platform-tauri / platform-web 各自实现;附件管线(`useAttachments`)在 chat 域
 * 内;选区裁剪 UI 是独立的 ``ScreenshotRegionDialog``。本 hook 把三者粘起来,谁
 * 也不依赖谁。
 *
 * **流程**(2026-05-17 重做):
 *   1. 用户点剪刀 icon
 *   2. 抓全屏(不 minimize 主窗;察元自己也会进画面,但用户能看到完整截图)
 *   3. setState capturedBlob → dialog 自动渲染
 *   4. 用户在 dialog 里鼠标拖矩形选区,Enter 或点确认
 *   5. canvas 按原图分辨率裁剪 → Blob → `addImages([File])`
 *   6. 关 dialog,清理 state
 *   Esc / 点蒙版 = 取消,不入附件。
 *
 * 早期方案是"minimize 主窗 → 截整屏 → 直接当附件"。用户反馈"窗口隐藏了,不
 * 知道截了什么 + 截的就是整屏,要的是窗内拖选"。这版改成所见即所得。
 *
 * **复用**:consumer 把 `dialog` 节点放进 render tree,`onScreenshot` 接给
 * ChatComposer.onScreenshot 即可:
 *
 *   const screenshot = useChatScreenshot(attachments.addImages);
 *   return (
 *     <>
 *       <ChatComposer onScreenshot={screenshot.onScreenshot} ... />
 *       {screenshot.dialog}
 *     </>
 *   );
 */
import * as React from 'react';
import { getPlatform } from '@chayuan/platform-shared';
import { reportError } from '../../store/errorDialog';
import { ScreenshotRegionDialog } from './ScreenshotRegionDialog';

export interface ChatScreenshotApi {
  /** 截图能力是否可用(Tauri 端总是 true;web 端要求 https + getDisplayMedia) */
  available: boolean;
  /** in-flight 标记(抓屏 + 用户拖框期间都是 true)。UI 可拿来禁用按钮 */
  busy: boolean;
  /** 触发截图;成功后通过传入的 addImages 注入附件 */
  onScreenshot: () => void;
  /** 选区对话框 — consumer 放到 render tree 任意位置(走 fixed 定位,挂哪都行) */
  dialog: React.ReactNode;
}

export function useChatScreenshot(
  addImages: (files: File[]) => Promise<void>,
): ChatScreenshotApi {
  const pal = getPlatform();
  const available = typeof pal.capture?.screenshot === 'function'
    && (pal.kind === 'desktop' || (typeof navigator !== 'undefined'
        && !!navigator.mediaDevices?.getDisplayMedia));

  // 当前抓屏到的全屏 PNG;非 null 时 dialog 显示
  const [captured, setCaptured] = React.useState<Blob | null>(null);
  // capturing = "正在调 platform.capture",userPicking = "dialog 开着等用户选区"
  // 两个状态都算 busy,避免连点
  const [capturing, setCapturing] = React.useState(false);
  const inFlightRef = React.useRef(false);

  const onScreenshot = React.useCallback(() => {
    if (!available) {
      reportError(new Error('当前环境不支持截图'),
        '截图不可用 — 桌面版请确认已正确启动,Web 版需 HTTPS + 现代浏览器');
      return;
    }
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setCapturing(true);

    (async () => {
      try {
        const blob = await pal.capture!.screenshot();
        setCaptured(blob);  // dialog 显示
      } catch (e) {
        // web 端用户取消选屏 dialog → NotAllowedError / AbortError,静默
        const name = (e instanceof DOMException) ? e.name : '';
        if (name !== 'NotAllowedError' && name !== 'AbortError') {
          reportError(e, '截图失败');
        }
        inFlightRef.current = false;  // 失败时立刻释放
      } finally {
        setCapturing(false);
      }
    })();
  }, [available, pal]);

  const handleConfirm = React.useCallback((cropped: Blob) => {
    setCaptured(null);  // 关 dialog
    inFlightRef.current = false;
    const ts = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const name = `screenshot-${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}.png`;
    const file = new File([cropped], name, { type: cropped.type || 'image/png' });
    void addImages([file]);
  }, [addImages]);

  const handleCancel = React.useCallback(() => {
    setCaptured(null);
    inFlightRef.current = false;
  }, []);

  const dialog = captured ? (
    <ScreenshotRegionDialog
      blob={captured}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  ) : null;

  return {
    available,
    busy: capturing || !!captured,
    onScreenshot,
    dialog,
  };
}
