// 桌面/网页授权功能（门控 + 激活窗口 + 后端驱动的反应式态）。
export { LicenseGate, type LicenseGateProps } from './LicenseGate';
export { LicenseDialog, type LicenseDialogProps } from './LicenseDialog';
export { ShareDialog, type ShareDialogProps } from './ShareDialog';
export { useUsageGate, type UseUsageGateReturn } from './useUsageGate';
export { UsageGateDialogs, type UsageGateDialogsProps } from './UsageGateDialogs';
export {
  useLicenseStore,
  useIsLicensed,
  useLicenseReady,
  type LicenseStatus,
  type ConsumeResult,
} from './licenseStore';
export { MyEntitlementsSection } from './MyEntitlementsSection';
