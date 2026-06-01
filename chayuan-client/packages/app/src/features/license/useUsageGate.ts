/**
 * useUsageGate — 按次使用门控 hook。
 *
 * 每个能力执行入口调用 guard(run)，流程：
 *   1. 调 consume(app) 扣减一次额度。
 *   2. allowed=false → 弹购买对话框（LicenseDialog），不执行 run。
 *   3. allowed=true, source='free' → 执行 run，同时弹分享对话框（ShareDialog）—
 *      但同一 app 同一天只弹一次（localStorage key: usagegate:<app>:<YYYY-MM-DD>）。
 *   4. allowed=true, source!='free'（购买额度）→ 直接执行，不弹任何窗口。
 *   5. consume 网络异常 → fail-open：直接执行 run，门控仅尽力。
 *
 * 用法:
 *   const { guard, dialogs } = useUsageGate('chat');
 *   // 在 JSX 里放 {dialogs}，在 submit 里调 guard(() => sendMessage(text))
 *
 * 或者拆开用 props 自控:
 *   const { guard, shareOpen, setShareOpen, buyOpen, setBuyOpen, remaining } = useUsageGate('video');
 */

import * as React from 'react';
import { useLicenseStore } from './licenseStore';
import type { ConsumeResult } from './licenseStore';

// 每天同 app 只弹一次分享对话框。
function getShareShownKey(app: string): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `usagegate:${app}:${ymd}`;
}

function wasShareShownToday(app: string): boolean {
  try {
    return localStorage.getItem(getShareShownKey(app)) === '1';
  } catch {
    return false;
  }
}

function markShareShownToday(app: string): void {
  try {
    localStorage.setItem(getShareShownKey(app), '1');
  } catch {
    // localStorage 不可用时静默
  }
}

export interface UseUsageGateReturn {
  /**
   * 执行门控。调用 consume，按结果决定是否执行 run 及弹哪个对话框。
   * run 可以是同步或异步函数。
   */
  guard(run: () => void | Promise<void>): Promise<void>;
  /** 分享对话框是否打开。 */
  shareOpen: boolean;
  setShareOpen: (open: boolean) => void;
  /** 购买对话框是否打开。 */
  buyOpen: boolean;
  setBuyOpen: (open: boolean) => void;
  /** 今日剩余免费次数（最近一次 consume 返回值）。 */
  remaining: number;
  /** 最近一次 consume 的完整结果（可为 null）。 */
  lastConsumeResult: ConsumeResult | null;
}

export function useUsageGate(app: string): UseUsageGateReturn {
  const consume = useLicenseStore((s) => s.consume);
  const [shareOpen, setShareOpen] = React.useState(false);
  const [buyOpen, setBuyOpen] = React.useState(false);
  const [remaining, setRemaining] = React.useState(0);
  const [lastConsumeResult, setLastConsumeResult] = React.useState<ConsumeResult | null>(null);

  const guard = React.useCallback(
    async (run: () => void | Promise<void>): Promise<void> => {
      let result: ConsumeResult;
      try {
        result = await consume(app);
      } catch {
        // fail-open：网络异常时直接执行任务，门控仅尽力。
        await run();
        return;
      }

      setLastConsumeResult(result);

      if (!result.allowed) {
        // 额度耗尽 → 弹购买对话框，不执行。
        setBuyOpen(true);
        return;
      }

      // 有额度 → 执行任务。
      await run();

      if (result.source === 'free') {
        setRemaining(result.remainingFree);
        // 每天首次免费执行 → 弹分享对话框（同 app 同日只弹一次）。
        if (!wasShareShownToday(app)) {
          markShareShownToday(app);
          setShareOpen(true);
        }
      }
    },
    [app, consume],
  );

  return {
    guard,
    shareOpen,
    setShareOpen,
    buyOpen,
    setBuyOpen,
    remaining,
    lastConsumeResult,
  };
}
