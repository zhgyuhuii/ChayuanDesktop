// 桌面/网页授权功能（门控 + 激活窗口 + 后端驱动的反应式态）。
export { LicenseGate, type LicenseGateProps } from './LicenseGate';
export { LicenseDialog, type LicenseDialogProps } from './LicenseDialog';
export {
  useLicenseStore,
  useIsLicensed,
  useLicenseReady,
  type LicenseStatus,
} from './licenseStore';
export { MyEntitlementsSection } from './MyEntitlementsSection';
