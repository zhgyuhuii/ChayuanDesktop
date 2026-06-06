/**
 * UsageGateDialogs — useUsageGate 的伴随组件。
 *
 * 在需要门控的功能页面挂载一次即可：
 *   const gate = useUsageGate('video');
 *   // ...
 *   return (
 *     <>
 *       <UsageGateDialogs gate={gate} app="video" />
 *       <MyFeature onGenerate={() => gate.guard(doGenerate)} />
 *     </>
 *   );
 */

import * as React from 'react';
import { LicenseDialog } from './LicenseDialog';
import { ShareDialog } from './ShareDialog';
import type { UseUsageGateReturn } from './useUsageGate';

export interface UsageGateDialogsProps {
  /** app 键（与 useUsageGate 传入的 app 一致）。 */
  app: string;
  /** useUsageGate 返回值。 */
  gate: UseUsageGateReturn;
}

export function UsageGateDialogs({ app, gate }: UsageGateDialogsProps): React.ReactElement {
  return (
    <>
      <LicenseDialog
        app={app}
        open={gate.buyOpen}
        onOpenChange={gate.setBuyOpen}
      />
      <ShareDialog
        app={app}
        open={gate.shareOpen}
        onOpenChange={gate.setShareOpen}
        remainingFree={gate.remaining}
        onBuy={() => {
          // 从「次数提示」分享弹窗切到购买弹窗（LicenseDialog），复用其购买/激活全套。
          gate.setShareOpen(false);
          gate.setBuyOpen(true);
        }}
      />
    </>
  );
}
